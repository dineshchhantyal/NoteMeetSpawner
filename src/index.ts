import { Builder, Browser, By, until, WebDriver } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/chrome';
import * as path from 'path';
import * as fs from 'fs';
import * as winston from 'winston';

class GoogleMeetRecorder {
    private driver: WebDriver | null = null;
    private meetingUrl: string;
    private outputDirectory: string;
    private logger: winston.Logger;

    constructor(meetingUrl: string, outputDirectory: string) {
        this.meetingUrl = meetingUrl;
        this.outputDirectory = outputDirectory;

        // Configure logging
        this.logger = winston.createLogger({
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
                    filename: path.join(outputDirectory, 'meet-recording.log') 
                })
            ]
        });
    }

    // Comprehensive screen recording script with explicit download
    private getScreenRecordingScript(): string {
        return `
        (function() {
            return new Promise((resolve, reject) => {
                // Create hidden video element
                const video = document.createElement('video');
                video.style.display = 'none';
                document.body.appendChild(video);

                // Start screen capture
                navigator.mediaDevices.getDisplayMedia({
                    video: { 
                        displaySurface: 'browser',
                        width: { ideal: 1920, max: 1920 },
                        height: { ideal: 1080, max: 1080 }
                    },
                    audio: true
                })
                .then((stream) => {
                    const mediaRecorder = new MediaRecorder(stream, { 
                        mimeType: 'video/webm; codecs=vp9' 
                    });
                    
                    const chunks = [];

                    mediaRecorder.ondataavailable = (e) => {
                        if (e.data.size > 0) {
                            chunks.push(e.data);
                        }
                    };

                    mediaRecorder.onstop = () => {
                        // Create a blob from recorded chunks
                        const blob = new Blob(chunks, { type: 'video/webm' });
                        
                        // Create FileReader to convert blob to base64
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            // Send base64 encoded video back to Selenium
                            window.recordedVideoBase64 = reader.result;
                            resolve(true);
                        };
                        reader.readAsDataURL(blob);

                        // Stop all tracks
                        stream.getTracks().forEach(track => track.stop());
                    };

                    // Start recording
                    mediaRecorder.start();

                    // Expose stop function globally
                    window.stopScreenRecording = () => {
                        if (mediaRecorder.state !== 'inactive') {
                            mediaRecorder.stop();
                        }
                    };

                    // Auto-stop after 1 hour
                    setTimeout(() => {
                        if (mediaRecorder.state !== 'inactive') {
                            mediaRecorder.stop();
                        }
                    }, 3600000);
                })
                .catch(reject);
            });
        })();
        `;
    }

    // Main method to handle recording and download
    private async saveRecordedVideo(): Promise<void> {
        try {
            // Retrieve base64 encoded video
            const base64Video = await this.driver?.executeScript('return window.recordedVideoBase64') as string;
            
            if (!base64Video) {
                this.logger.error('No video data found');
                return;
            }

            // Remove data URL prefix
            const base64Data = base64Video.split(',')[1];
            
            // Generate filename
            const filename = `meet-recording-${Date.now()}.webm`;
            const fullPath = path.join(this.outputDirectory, filename);

            // Write video file
            fs.writeFileSync(fullPath, base64Data, 'base64');
            
            this.logger.info(`Video saved: ${fullPath}`);
        } catch (error) {
            this.logger.error(`Video save failed: ${error}`);
        }
    }
    // Comprehensive automation method
    async recordMeeting(durationMinutes: number = 60): Promise<void> {
        try {
            this.logger.info(`Starting recording session for ${durationMinutes} minutes`);
            
            // Ensure output directory exists
            if (!fs.existsSync(this.outputDirectory)) {
                fs.mkdirSync(this.outputDirectory, { recursive: true });
                this.logger.info(`Created output directory: ${this.outputDirectory}`);
            }

            // Initialize WebDriver
            const options = new Options();
            options.addArguments(
                "--start-maximized",
                "--disable-extensions",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--use-fake-ui-for-media-stream"
            );

            this.driver = await new Builder()
                .forBrowser(Browser.CHROME)
                .setChromeOptions(options)
                .build();
            this.logger.info('Chrome WebDriver initialized');

            // Navigate to meeting
            this.logger.info(`Navigating to meeting URL: ${this.meetingUrl}`);
            await this.driver.get(this.meetingUrl);

            // Wait for name input
            this.logger.info('Waiting for name input field...');
            const nameInput = await this.driver.wait(
                until.elementLocated(By.css('input[aria-label="Your name"]')), 
                15000
            );
            await nameInput.sendKeys('Screen Bot');
            this.logger.info('Name entered successfully');

            // Find and click join button
            this.logger.info('Attempting to join meeting...');
            const joinButton = await this.driver.findElement(
                By.xpath('/html/body/div/c-wiz/div/div/div[35]/div[4]/div/div[2]/div[4]/div/div/div[2]/div[1]/div[2]/div[1]/div/div/button')
            );
            await joinButton.click();
            this.logger.info('Join button clicked');

            // Wait for meeting interface
            this.logger.info('Waiting for meeting interface to load...');
            await this.driver.wait(
                until.elementLocated(By.css('div[aria-label="Turn off microphone"]')), 
                20000
            );
            this.logger.info('Successfully joined meeting');

            // Optional: Mute mic and camera
            try {
                const micMuteButton = await this.driver.findElement(
                    By.css('div[aria-label="Turn off microphone"]')
                );
                await micMuteButton.click();
                this.logger.info('Microphone muted');

                const cameraMuteButton = await this.driver.findElement(
                    By.css('div[aria-label="Turn off camera"]')
                );
                await cameraMuteButton.click();
                this.logger.info('Camera turned off');
            } catch (muteError) {
                this.logger.warn(`Failed to mute devices: ${muteError}`);
            }

            // Start screen recording
            this.logger.info('Starting screen recording...');
            await this.driver.executeScript(this.getScreenRecordingScript());
            this.logger.info('Screen recording started');

            // Wait for specified duration
            this.logger.info(`Recording for ${durationMinutes} minutes...`);
            await new Promise(resolve => setTimeout(resolve, durationMinutes * 60 * 1000));

            // Stop recording
            this.logger.info('Stopping screen recording...');
            await this.driver.executeScript('window.stopScreenRecording?.()');
            // Stop recording and wait for data
            this.logger.info('Stopping screen recording...');
            await this.driver.executeScript('window.stopScreenRecording?.()');
            await this.driver.wait(
                async () => await this.driver?.executeScript('return window.recordedVideoBase64') !== undefined,
                30000
            );
            this.logger.info('Screen recording stopped');

            // Save recorded video
            await this.saveRecordedVideo();
            
            // Take screenshot on failure
            try {
                const screenshot = await this.driver?.takeScreenshot();
                if (screenshot) {
                    const screenshotPath = path.join(
                        this.outputDirectory, 
                        `error-screenshot-${Date.now()}.png`
                    );
                    fs.writeFileSync(screenshotPath, screenshot, 'base64');
                    this.logger.info(`Error screenshot saved to: ${screenshotPath}`);
                }
            } catch (screenshotError) {
                this.logger.error(`Failed to save error screenshot: ${screenshotError}`);
            }
        } finally {
            this.logger.info('Cleaning up and closing browser...');
            await this.driver?.quit();
            this.logger.info('Session ended');
        }
    }
}

// Usage example
async function main() {
    const meetingUrl = 'https://meet.google.com/dpj-ogga-vzp';
    const usernameGroup = 'group1';
    const outputDirectory = path.join(__dirname, 'meet-recordings', usernameGroup);

    const recorder = new GoogleMeetRecorder(meetingUrl, outputDirectory);
    await recorder.recordMeeting(1); // Record for 60 minutes
}

main().catch(console.error);

export default GoogleMeetRecorder;