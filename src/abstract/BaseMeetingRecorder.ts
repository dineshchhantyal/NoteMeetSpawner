import { WebDriver } from 'selenium-webdriver';
import * as winston from 'winston';
import { IMeetingRecorder } from '../interfaces/IMeetingRecorder';
import { IMeetingConfig } from '../interfaces/IMeetingConfig';
import * as path from 'path';
import * as fs from 'fs';


export abstract class BaseMeetingRecorder implements IMeetingRecorder {
    protected driver: WebDriver | null = null;
    protected logger: winston.Logger;
    protected config: IMeetingConfig;

    constructor(config: IMeetingConfig) {
        this.config = config;
        this.logger = this.setupLogger();
    }

    protected abstract initializeDriver(): Promise<void>;
    protected abstract joinMeeting(): Promise<void>;
    protected abstract setupRecording(): Promise<void>;
    protected abstract stopRecording(): Promise<void>;
    protected abstract saveRecording(): Promise<void>;

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
    public async recordMeeting(): Promise<void> {
        try {
            await this.initializeDriver();
            await this.joinMeeting();
            await this.setupRecording();

            await new Promise(resolve => setTimeout(resolve, this.config.durationMinutes * 60 * 1000));

            await this.stopRecording();
            await this.saveRecording();
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
