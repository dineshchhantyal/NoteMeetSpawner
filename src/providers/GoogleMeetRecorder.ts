import { Builder, Browser, By, until } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/chrome';
import { BaseMeetingRecorder } from '../abstract/BaseMeetingRecorder';
import * as fs from 'fs';
import * as path from 'path';
import { IMeetingConfig } from '../interfaces/IMeetingConfig';


export class GoogleMeetRecorder extends BaseMeetingRecorder {
    constructor(config: IMeetingConfig) {
        super(config);
    }

    protected async initializeDriver(): Promise<void> {
        const options = new Options();
        options.addArguments(
            '--start-maximized',
            '--disable-extensions',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--use-fake-ui-for-media-stream'
        );
        this.driver = await new Builder()
            .forBrowser(Browser.CHROME)
            .setChromeOptions(options)
            .build();
    }

    async joinMeeting(): Promise<void> {
        // Navigate to meeting
        this.logger.info(`Navigating to meeting URL: ${this.config.meetingUrl}`);
        await this.driver?.get(this.config.meetingUrl);

        // Wait for name input
        this.logger.info('Waiting for name input field...');
        const nameInput = await this.driver?.wait(
            until.elementLocated(By.css('input[aria-label="Your name"]')), 
            15000
        );
        await nameInput?.sendKeys('Screen Bot');
        this.logger.info('Name entered successfully');

        // Find and click join button
        this.logger.info('Attempting to join meeting...');
        const joinButton = await this.driver?.findElement(
            By.xpath('/html/body/div/c-wiz/div/div/div[35]/div[4]/div/div[2]/div[4]/div/div/div[2]/div[1]/div[2]/div[1]/div/div/button')
        );
        await joinButton?.click();
        this.logger.info('Join button clicked');

        // Wait for meeting interface
        this.logger.info('Waiting for meeting interface to load...');
        await this.driver?.wait(
            until.elementLocated(By.css('div[aria-label="Turn off microphone"]')), 
            20000
        );
        this.logger.info('Successfully joined meeting');
    }
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

    async setupRecording(): Promise<void> {
         // Optional: Mute mic and camera
        try {
            const micMuteButton = await this.driver?.findElement(
                By.css('div[aria-label="Turn off microphone"]')
            );
            await micMuteButton?.click();
            this.logger.info('Microphone muted');

            const cameraMuteButton = await this.driver?.findElement(
                By.css('div[aria-label="Turn off camera"]')
            );
            await cameraMuteButton?.click();
            this.logger.info('Camera turned off');
        } catch (muteError) {
            this.logger.warn(`Failed to mute devices: ${muteError}`);
        }

        // Start screen recording
        this.logger.info('Starting screen recording...');
        await this.driver?.executeScript(this.getScreenRecordingScript());
        this.logger.info('Screen recording started');

        // Wait for specified duration
        this.logger.info(`Recording for ${this.config.durationMinutes} minutes...`);
        await new Promise(resolve => setTimeout(resolve, this.config.durationMinutes * 60 * 1000));

    }

    async stopRecording(): Promise<void> {
        // Stop recording and wait for data
        this.logger.info('Stopping screen recording...');
        await this.driver?.executeScript('window.stopScreenRecording?.()');
        
        // Wait for video data to be available
        await this.driver?.wait(
            async () => {
                const videoData = await this.driver?.executeScript('return window.recordedVideoBase64');
                return videoData !== undefined && videoData !== null;
            },
            30000,
            'Timed out waiting for video data'
        );
        this.logger.info('Screen recording stopped');
    }

    async saveRecording(): Promise<void> {
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
            const fullPath = path.join(this.config.outputDirectory, filename);

            // Write video file
            fs.writeFileSync(fullPath, base64Data, 'base64');
            
            this.logger.info(`Video saved: ${fullPath}`);
        } catch (error) {
            this.logger.error(`Video save failed: ${error}`);
        }

       
    }
}
