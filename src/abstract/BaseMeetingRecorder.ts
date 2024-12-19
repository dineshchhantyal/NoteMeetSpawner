import { WebDriver } from 'selenium-webdriver';
import * as winston from 'winston';
import { IMeetingRecorder } from '../interfaces/IMeetingRecorder';
import { IMeetingConfig } from '../interfaces/IMeetingConfig';
import * as path from 'path';
import * as fs from 'fs';
import { Readable } from 'stream';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';


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
        this.logger.info('Session started');
    }

    private validateConfig(config: IMeetingConfig): void {
        if ((config.storageType === 's3' || config.storageType === 'both') && !config.s3Config) {
            throw new Error('S3 configuration is required when using S3 storage');
        }
    }

    protected abstract initializeDriver(): Promise<void>;
    protected abstract joinMeeting(): Promise<void>;
    protected abstract setupRecording(): Promise<void>;
    protected abstract stopRecording(): Promise<void>;
    protected abstract getRecordedVideo(): Promise<string | null>;

    
    protected initializeS3Client(): void {
        if (this.config.storageType === 's3' || this.config.storageType === 'both') {
            this.s3Client = new S3Client({
                region: this.config.s3Config!.region,
                credentials: {
                    accessKeyId: this.config.s3Config!.accessKeyId,
                    secretAccessKey: this.config.s3Config!.secretAccessKey
                },
                endpoint: this.config.s3Config!.endpoint,
                forcePathStyle: true
            });
            this.logger.info('S3 client initialized');
        }
    }

    private setupLogger(): winston.Logger {
        return winston.createLogger({
            level: 'debug',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `${timestamp} [${level}]: ${message}`;
                })
            ),
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({
                    filename: path.join(this.config.outputDirectory, 'meet-recording.log')
                })
            ]
        });
    };

    async saveRecording(): Promise<void> {
        try {
            // Retrieve base64 encoded video
            const base64Data = await this.getRecordedVideo();


            if (!base64Data) {
                this.logger.warn('No video data found after stopping the recording.');
                return;
            }

            // Generate filename
            const filename = `meet-recording-${Date.now()}.webm`;

            switch (this.config.storageType) {
                case 'local':
                    await this.saveToLocalStorage(base64Data, filename);
                    break;
                case 's3':
                    await this.saveToS3Storage(base64Data, filename);
                    break;
                case 'both':
                default:
                    await Promise.all([
                        this.saveToLocalStorage(base64Data, filename),
                        this.saveToS3Storage(base64Data, filename),
                    ]);
                    break;
            }

            await this.driver?.executeScript('window.recordedVideoBase64 = null;');

        } catch (error) {
            this.logger.error(`Video save failed: ${error}`);
        }

    }

    protected async saveToLocalStorage(base64Data: string, filename: string): Promise<void> {
        const localPath = path.join(this.config.outputDirectory, 'recordings', filename);
        
        return new Promise((resolve, reject) => {
            try {
                fs.writeFileSync(localPath, base64Data, 'base64');
                this.logger.info(`Video saved locally: ${localPath}`);
                resolve();
            } catch (error) {
                this.logger.error(`Local save failed: ${error}`);
                reject(error);
            }
        });
    }

    protected async saveToS3Storage(base64Data: string, filename: string): Promise<void> {
        if (!this.s3Client) {
            throw new Error('S3 client not initialized');
        }

        const videoBuffer = Buffer.from(base64Data, 'base64');
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
                    ContentType: 'video/webm'
                }
            });

            // Track upload progress
            upload.on('httpUploadProgress', (progress) => {
                this.logger.info(`S3 Upload progress: ${progress.loaded} / ${progress.total} bytes`);
            });

            upload.done()
                .then(() => {
                    this.logger.info(`Video uploaded to S3: s3://${this.config.s3Config!.bucket}/${s3Key}`);
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

            await new Promise(resolve => setTimeout(resolve, this.config.durationMinutes * 60 * 1000));

            await this.stopRecording();

            this.logger.info('Recording complete');

            await this.saveRecording();

            this.logger.info('Recording saved to storage: ' + this.config.storageType);


        } catch (error) {
            // Take screenshot on failure
            try {
                const screenshot = await this.driver?.takeScreenshot();
                if (screenshot) {
                    const screenshotPath = path.join(
                        this.config.outputDirectory,
                        `error-screenshot-${Date.now()}.png`
                    );
                    fs.writeFileSync(screenshotPath, screenshot, 'base64');
                    this.logger.info(`Error screenshot saved to: ${screenshotPath}`);
                    this.logger.error(`Recording failed: ${error}`);
                }
            } catch (screenshotError) {
                this.logger.error(`Failed to save error screenshot: ${screenshotError}`);
            }
        } finally {
            await this.cleanup();
        }
    }

    public async cleanup(): Promise<void> {
        await this.driver?.quit();
        this.logger.info('Session ended');
    }
}
