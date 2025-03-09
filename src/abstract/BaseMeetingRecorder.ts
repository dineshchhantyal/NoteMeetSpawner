import { WebDriver } from "selenium-webdriver";
import * as winston from "winston";
import { IMeetingRecorder } from "../interfaces/IMeetingRecorder";
import { IMeetingConfig } from "../interfaces/IMeetingConfig";
import * as path from "path";
import * as fs from "fs";
import { Readable } from "stream";
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client } from "@aws-sdk/client-s3";

export abstract class BaseMeetingRecorder implements IMeetingRecorder {
  protected driver: WebDriver | null = null;
  protected logger: winston.Logger;
  protected config: IMeetingConfig;
  private s3Client: S3Client | null = null;

  constructor(config: IMeetingConfig) {
    this.validateConfig(config);
    this.config = config;
    this.logger = this.setupLogger();
    this.initializeS3Client();
    this.logger.info("Session started");
  }

  private validateConfig(config: IMeetingConfig): void {
    if (
      (config.storageType === "s3" || config.storageType === "both") &&
      !config.s3Config
    ) {
      throw new Error("S3 configuration is required when using S3 storage");
    }
  }

  protected abstract initializeDriver(): Promise<void>;
  protected abstract joinMeeting(): Promise<void>;
  protected abstract setupRecording(): Promise<void>;
  protected abstract stopRecording(): Promise<void>;
  protected abstract getRecordedVideo(): Promise<string | null>;

  protected initializeS3Client(): void {
    if (
      this.config.storageType === "s3" ||
      this.config.storageType === "both"
    ) {
      this.s3Client = new S3Client({
        region: this.config.s3Config!.region,
        credentials: {
          accessKeyId: this.config.s3Config!.accessKeyId,
          secretAccessKey: this.config.s3Config!.secretAccessKey,
        },
        endpoint: this.config.s3Config!.endpoint,
        forcePathStyle: true,
      });
      this.logger.info("S3 client initialized");
    }
  }

  private setupLogger(): winston.Logger {
    return winston.createLogger({
      level: "debug",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: path.join(
            this.config.outputDirectory,
            "meet-recording.log"
          ),
        }),
      ],
    });
  }

  async saveRecording(): Promise<void> {
    try {
      // Retrieve base64 encoded video
      const base64Data = await this.getRecordedVideo();

      if (!base64Data) {
        this.logger.warn("No video data found after stopping the recording.");
        return;
      }

      // Generate filename
      const filename = `meet-recording-${Date.now()}.webm`;

      switch (this.config.storageType) {
        case "local":
          await this.saveToLocalStorage(base64Data, filename);
          break;
        case "s3":
          await this.saveToS3Storage(base64Data, filename);
          break;
        case "both":
        default:
          await Promise.all([
            this.saveToLocalStorage(base64Data, filename),
            this.saveToS3Storage(base64Data, filename),
          ]);
          break;
      }

      await this.driver?.executeScript("window.recordedVideoBase64 = null;");
    } catch (error) {
      this.logger.error(`Video save failed: ${error}`);
    }
  }

  protected async saveToLocalStorage(
    base64Data: string,
    filename: string
  ): Promise<void> {
    try {
      if (
        !fs.existsSync(path.join(this.config.outputDirectory, "recordings"))
      ) {
        fs.mkdirSync(path.join(this.config.outputDirectory, "recordings"), {
          recursive: true,
        });
      }

      const localPath = path.join(
        this.config.outputDirectory,
        "recordings",
        filename
      );

      // Simple and direct conversion from base64 to binary
      const buffer = Buffer.from(base64Data, "base64");

      // Write the buffer to file in one operation
      fs.writeFileSync(localPath, buffer);

      // Log the saved file details
      const stats = fs.statSync(localPath);
      this.logger.info(
        `Video saved locally: ${localPath} (${stats.size} bytes)`
      );
    } catch (error) {
      this.logger.error(`Local save failed: ${error}`);
      throw error;
    }
  }

  // Add this helper method to verify WebM files
  private verifyWebMFile(filePath: string): boolean {
    try {
      // Read the first 8 bytes of the file to check WebM signature
      const headerBuffer = Buffer.alloc(8);
      const fd = fs.openSync(filePath, "r");
      fs.readSync(fd, headerBuffer, 0, 8, 0);
      fs.closeSync(fd);

      // WebM files should start with 0x1A 0x45 0xDF 0xA3 (EBML header)
      const isValidWebM =
        headerBuffer[0] === 0x1a &&
        headerBuffer[1] === 0x45 &&
        headerBuffer[2] === 0xdf &&
        headerBuffer[3] === 0xa3;

      if (!isValidWebM) {
        this.logger.error(
          `File does not have a valid WebM header: ${filePath}`
        );
        this.logger.error(`Header bytes: ${headerBuffer.toString("hex")}`);
        return false;
      }

      this.logger.info(`WebM file has valid header signature: ${filePath}`);
      return true;
    } catch (error) {
      this.logger.error(`Error verifying WebM file: ${error}`);
      return false;
    }
  }

  protected async saveToS3Storage(
    base64Data: string,
    filename: string
  ): Promise<void> {
    if (!this.s3Client) {
      throw new Error("S3 client not initialized");
    }

    const videoBuffer = Buffer.from(base64Data, "base64");
    const usernameGroup = this.config.outputDirectory.split(path.sep).pop();
    const s3Key = `${usernameGroup}/recordings/${filename}`;
    const videoStream = Readable.from(videoBuffer);

    return new Promise((resolve, reject) => {
      const upload = new Upload({
        client: this.s3Client!,
        params: {
          Bucket: this.config.s3Config!.bucket,
          Key: s3Key,
          Body: videoStream,
          ContentType: "video/webm",
        },
      });

      // Track upload progress
      upload.on("httpUploadProgress", (progress) => {
        this.logger.info(
          `S3 Upload progress: ${progress.loaded} / ${progress.total} bytes`
        );
      });

      upload
        .done()
        .then(() => {
          this.logger.info(
            `Video uploaded to S3: s3://${
              this.config.s3Config!.bucket
            }/${s3Key}`
          );
          resolve();
        })
        .catch((error: any) => {
          this.logger.error(`S3 upload failed: ${error}`);
          reject(error);
        });
    });
  }

  public async recordMeeting(): Promise<void> {
    try {
      await this.initializeDriver();
      await this.joinMeeting();
      await this.setupRecording();

      await new Promise((resolve) =>
        setTimeout(resolve, this.config.durationMinutes * 60 * 1000)
      );

      await this.stopRecording();

      this.logger.info("Recording complete");

      await this.saveRecording();

      this.logger.info(
        "Recording saved to storage: " + this.config.storageType
      );
    } catch (error) {
      // Take screenshot on failure
      try {
        const screenshot = await this.driver?.takeScreenshot();
        if (screenshot) {
          const screenshotPath = path.join(
            this.config.outputDirectory,
            `error-screenshot-${Date.now()}.png`
          );

          if (this.config.storageType === "s3") {
            const screenshotBuffer = Buffer.from(screenshot, "base64");
            const screenshotStream = Readable.from(screenshotBuffer);
            const usernameGroup = this.config.outputDirectory
              .split(path.sep)
              .pop();
            const s3Key = `${usernameGroup}/screenshots/${path.basename(
              screenshotPath
            )}`;
            const upload = new Upload({
              client: this.s3Client!,
              params: {
                Bucket: this.config.s3Config!.bucket,
                Key: s3Key,
                Body: screenshotStream,
                ContentType: "image/png",
              },
            });

            upload.on("httpUploadProgress", (progress) => {
              this.logger.info(
                `S3 Upload progress: ${progress.loaded} / ${progress.total} bytes`
              );
            });

            await upload.done();
            this.logger.info(
              `Error screenshot uploaded to S3: s3://${
                this.config.s3Config!.bucket
              }/${s3Key}`
            );
          } else {
            fs.writeFileSync(screenshotPath, screenshot, "base64");
            this.logger.info(`Error screenshot saved to: ${screenshotPath}`);
          }
          this.logger.error(`Recording failed: ${error}`);
        }
      } catch (screenshotError) {
        this.logger.error(
          `Failed to save error screenshot: ${screenshotError}`
        );
      }
    } finally {
      await this.cleanup();
    }
  }

  public async cleanup(): Promise<void> {
    await this.driver?.quit();
    this.logger.info("Session ended");
  }

  // Add this debug method to check saved files

  protected checkVideoFile(filePath: string): boolean {
    try {
      // Check if file exists and has content
      const fs = require("fs");
      if (!fs.existsSync(filePath)) {
        this.logger.error(`File does not exist: ${filePath}`);
        return false;
      }

      // Get file stats
      const stats = fs.statSync(filePath);

      if (stats.size === 0) {
        this.logger.error(`File is empty: ${filePath}`);
        return false;
      }

      // Check WebM file signature
      // WebM files start with 0x1A 0x45 0xDF 0xA3 (EBML header)
      const buffer = Buffer.alloc(4);
      const fd = fs.openSync(filePath, "r");
      fs.readSync(fd, buffer, 0, 4, 0);
      fs.closeSync(fd);

      // Check WebM signature
      const isValidSignature =
        buffer[0] === 0x1a &&
        buffer[1] === 0x45 &&
        buffer[2] === 0xdf &&
        buffer[3] === 0xa3;

      this.logger.info(
        `File ${filePath} exists with size ${stats.size} bytes, valid WebM signature: ${isValidSignature}`
      );

      if (!isValidSignature) {
        this.logger.warn(
          `File does not have a valid WebM signature! First bytes: ${buffer.toString(
            "hex"
          )}`
        );
      }

      return isValidSignature;
    } catch (error) {
      this.logger.error(`Error checking file: ${error}`);
      return false;
    }
  }
}
