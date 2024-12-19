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
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            // '--headless' // did not work for me
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
        
        // if sign in button is found, click Got it
        try {
            const signInButton = await this.driver?.wait(
                until.elementLocated(By.css('/html/body/div[1]/div[3]/span/div[2]/div/div/div[2]/div/button')),
                10000
            );
            await signInButton?.click();
            this.logger.info('Sign in skip button clicked');
        } catch (error) {
            this.logger.info('Sign in button not found, continuing...');
        }

        // Wait for name input
        this.logger.info('Waiting for name input field...');
        const nameInput = await this.driver?.wait(
            until.elementLocated(By.css('input[aria-label="Your name"]')),
            15000
        );
        if (this.config.botName) {
            await nameInput?.sendKeys(this.config.botName);
        } else {
            await nameInput?.sendKeys('Note Meet Bot');
        }
        this.logger.info('Name entered successfully');

        // Find and click join button
        this.logger.info('Attempting to join meeting...');
        const joinButton = await this.driver?.wait(
            until.elementLocated(
                By.xpath('/html/body/div/c-wiz/div/div/div[35]/div[4]/div/div[2]/div[4]/div/div/div[2]/div[1]/div[2]/div[1]/div/div/button')
            ), 20000
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
        return `(async function () {
            try {
                
                // Hide the div with aria-label="Meet keeps you safe"
                const hidePopupStyle = document.createElement('style');
                hidePopupStyle.textContent = \`
                div[aria-label="Meet keeps you safe"],
                div[role="dialog"][data-is-persistent="true"] { 
                    display: none !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                }\`;
                
                document.documentElement.appendChild(hidePopupStyle);
                

                console.log('Requesting screen and audio capture...');


                
                // Capture screen video and audio
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        displaySurface: 'browser',
                        width: { ideal: 1920, max: 1920 },
                        height: { ideal: 1080, max: 1080 }
                    },
                    audio: true
                });
    
                if (!screenStream || screenStream.getTracks().length === 0) {
                    throw new Error('No media stream returned. User might have cancelled sharing.');
                }
    
                console.log('Screen capture stream obtained.');
    
                // Create an AudioContext for combining audio streams
                const audioContext = new AudioContext();
                const screenAudioStream = audioContext.createMediaStreamSource(screenStream);
    
                // Get audio from DOM elements (if any)
                const audioElements = Array.from(document.querySelectorAll('audio'));
                const audioElementStreams = audioElements.map(audio => {
                    if (audio.srcObject) {
                        return audioContext.createMediaStreamSource(audio.srcObject);
                    } else {
                        console.warn('Audio element does not have a valid srcObject:', audio);
                        return null;
                    }
                }).filter(Boolean);
    
                // Create a destination for combined audio
                const audioDest = audioContext.createMediaStreamDestination();
                screenAudioStream.connect(audioDest);
                audioElementStreams.forEach(stream => stream.connect(audioDest));
    
                // Combine screen video and combined audio
                const combinedStream = new MediaStream([
                    ...screenStream.getVideoTracks(),
                    ...audioDest.stream.getAudioTracks()
                ]);
    
                console.log('MediaRecorder initializing...');
    
                const startRecording = (stream) => {
                    const recorder = new MediaRecorder(stream, {
                        mimeType: 'video/webm; codecs=vp8,opus'
                    });
                    const chunks = [];
    
                    recorder.ondataavailable = (event) => {
                        if (event.data.size > 0) chunks.push(event.data);
                    };
    
                    const stopped = new Promise((resolve) => recorder.onstop = resolve);
    
                    recorder.start();
                    console.log('Recording started. Call window.stopScreenRecording() to stop recording.');
    
                    return {
                        recorder,
                        stop: () => {
                            if (recorder.state === 'recording') {
                                recorder.stop();
                            }
                            return stopped.then(() => new Blob(chunks, { type: 'video/webm' }));
                        }
                    };
                };
    
                const { recorder, stop } = startRecording(combinedStream);
    
                window.stopScreenRecording = async () => {
                    console.log('Stopping recording...');
                    const recordedBlob = await stop();
    
                    // Convert the recorded video to a Base64 string
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        window.recordedVideoBase64 = reader.result; // Base64 without the data prefix
                        console.log('Base64 video data available at window.recordedVideoBase64.');
                    };
                    reader.readAsDataURL(recordedBlob);
    
                    console.log('Recording processing completed.');
    
                    // Cleanup resources
                    screenStream.getTracks().forEach(track => track.stop());
                    audioContext.close();
                };
    
            } catch (error) {
                console.error('Error during screen recording:', error);
            }
        })();`;
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

            // skip meet keeps you safe popup if exist
            try {
                const skipButton = await this.driver?.findElement(
                    By.xpath('/html/body/div[1]/div[3]/span/div[2]/div/di')
                );
                if (skipButton) {
                    await skipButton.click();
                    this.logger.info('Skipped safety popup');
                }
            } catch (error) {
                this.logger.info('Safety popup not found, continuing...');
            }

        } catch (muteError) {
            this.logger.warn(`Failed to mute devices: ${muteError}`);
        }

        // Start screen recording
        this.logger.info('Starting screen recording...');
        // wait unit this elemeeent is found aria-label="Leave call"
        await this.driver?.wait(
            until.elementLocated(By.css('button[aria-label="Leave call"]')),
            20000
        );
        await this.driver?.executeScript(this.getScreenRecordingScript());
        this.logger.info('Screen recording started');

        // Wait for specified duration
        this.logger.info(`Recording for ${this.config.durationMinutes} minutes...`);
        await new Promise(resolve => setTimeout(resolve, this.config.durationMinutes * 60 * 2000));

    }

    async getRecordedVideo(): Promise<string | null> {
        const base64 = await this.driver?.executeScript('return window.recordedVideoBase64') as string | null;
        // Remove data prefix
        return base64?.split(',')[1] ?? null;
    }


    async stopRecording(): Promise<void> {
        try {
            this.logger.info('Stopping screen recording...');
            await this.driver?.executeScript('window.stopScreenRecording?.();');

            this.logger.info('Waiting for video data to be available...');
            await this.driver?.wait(
                async () => {
                    const videoData = await this.getRecordedVideo();
                    return videoData !== null && videoData !== undefined;
                },
                30000,
                'Timed out waiting for video data'
            );
            this.logger.info('Screen recording stopped and data is available.');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.logger.error(`Failed to stop recording: ${errorMessage}`);
            throw error;
        }
    }



}
