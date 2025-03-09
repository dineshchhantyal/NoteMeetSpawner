import { Builder, Browser, By, until } from "selenium-webdriver";
import { Options } from "selenium-webdriver/chrome";
import { BaseMeetingRecorder } from "../abstract/BaseMeetingRecorder";
import { IMeetingConfig } from "../interfaces/IMeetingConfig";
import path from "path";
import fs from "fs";

// Add these interfaces to describe the return types from browser scripts
interface StopResult {
  success: boolean;
  message: string;
}

interface VideoDataStatus {
  state: string;
  available: boolean;
  error: string | null;
  chunks: number;
  sampleSize: number;
}

interface VideoDataResult {
  success: boolean;
  data?: string;
  type?: string;
  size?: number;
  message?: string;
  chunks?: number;
}

interface EmergencyRecoveryResult {
  success: boolean;
  message: string;
  size?: number;
}

// Add this with your other interfaces at the top of the file
interface DebugInfo {
  hasRecordingChunks: boolean;
  chunkCount: number;
  hasMediaRecorder: boolean;
  recordingState: string;
  recordingError: string | null;
  navigatorMediaDevices: boolean;
  navigatorGetDisplayMedia: boolean;
  windowAudioContext: boolean;
  documentReadyState: string;
}

// Add this interface at the top with your other interfaces:
interface EmergencyData {
  success: boolean;
  message: string;
  size?: number;
}

export class GoogleMeetRecorder extends BaseMeetingRecorder {
  constructor(config: IMeetingConfig) {
    super(config);
  }

  protected async initializeDriver(): Promise<void> {
    const options = new Options();
    options.addArguments(
      "--start-maximized",
      "--disable-extensions",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      // "--headless", // did not work for me
      "--window-size=1920,1080"
      // "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
        until.elementLocated(
          By.css(
            "/html/body/div[1]/div[3]/span/div[2]/div/div/div[2]/div/button"
          )
        ),
        10000
      );
      await signInButton?.click();
      this.logger.info("Sign in skip button clicked");
    } catch (error) {
      this.logger.info("Sign in button not found, continuing...");
    }

    // Wait for name input
    this.logger.info("Waiting for name input field...");
    const nameInput = await this.driver?.wait(
      until.elementLocated(By.css('input[aria-label="Your name"]')),
      15000
    );
    if (this.config.botName) {
      await nameInput?.sendKeys(this.config.botName);
    } else {
      await nameInput?.sendKeys("Note Meet Bot");
    }
    this.logger.info("Name entered successfully");

    // Find and click join button
    this.logger.info("Attempting to join meeting...");
    const joinButton = await this.driver?.wait(
      until.elementLocated(
        By.xpath(
          "//*[@id='yDmH0d']/c-wiz/div/div/div[38]/div[4]/div/div[2]/div[4]/div/div/div[2]/div[1]/div[2]/div[1]"
        )
      ),
      20000
    );
    await joinButton?.click();
    this.logger.info("Join button clicked");

    // Wait for meeting interface
    this.logger.info("Waiting for meeting interface to load...");
    await this.driver?.wait(
      until.elementLocated(By.css('div[aria-label="Turn off microphone"]')),
      20000
    );
    this.logger.info("Successfully joined meeting");
  }

  private getScreenRecordingScript(): string {
    return `(async function() {
    try {
      // Initialize state variables
      console.log('Initializing screen recording...');
      window.recordingState = 'initializing';
      window.recordingChunks = [];
      window.recordingError = null;

      // Hide safety popups
      const hidePopupStyle = document.createElement('style');
      hidePopupStyle.textContent = \`
        div[aria-label="Meet keeps you safe"],
        div[role="dialog"][data-is-persistent="true"] {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }
      \`;
      document.documentElement.appendChild(hidePopupStyle);

      // IMPORTANT: Define all major variables in outer scope
      let screenStream = null;
      let audioContext = null;
      let audioDestination = null;
      let combinedStream = null;
      let recorder = null;
      let selectedMimeType = null;

      // Step 1: Get screen stream first
      console.log('Requesting screen capture...');
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'browser',
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30, max: 30 }
          },
          audio: false
        });

        if (!screenStream || screenStream.getVideoTracks().length === 0) {
          throw new Error('No video tracks in screen capture');
        }
        console.log('Screen capture successful');
      } catch (screenError) {
        console.error('Screen capture failed:', screenError);
        window.recordingError = 'Screen capture failed: ' + screenError.toString();
        return;
      }

      // Step 2: Set up audio processing
      try {
        console.log('Setting up audio context...');
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioDestination = audioContext.createMediaStreamDestination();

        // Find all audio elements
        const allAudioElements = Array.from(document.querySelectorAll('audio'));
        console.log('Found', allAudioElements.length, 'audio elements');

        // Filter usable audio elements
        const usableAudioElements = allAudioElements.filter(audio => {
          if (!audio.srcObject || audio.muted) return false;

          // Skip self-audio
          let parent = audio.parentElement;
          let depth = 0;
          while (parent && depth < 5) {
            if (parent.classList.contains('self-view') ||
                parent.getAttribute('aria-label')?.includes('You')) {
              return false;
            }
            parent = parent.parentElement;
            depth++;
          }
          return true;
        });

        console.log('Using', usableAudioElements.length, 'filtered audio elements');

        // Connect meeting audio to destination
        if (usableAudioElements.length > 0) {
          usableAudioElements.forEach((audio, index) => {
            try {
              const source = audioContext.createMediaStreamSource(audio.srcObject);
              const gainNode = audioContext.createGain();
              gainNode.gain.value = 0.7;

              // Add filters to improve audio
              const bassFilter = audioContext.createBiquadFilter();
              bassFilter.type = 'lowshelf';
              bassFilter.frequency.value = 200;
              bassFilter.gain.value = -10;

              source.connect(gainNode);
              gainNode.connect(bassFilter);
              bassFilter.connect(audioDestination);
              console.log('Connected audio element', index);
            } catch (e) {
              console.warn('Failed to connect audio element:', e);
            }
          });
        } else {
          // Add silent audio if no meeting audio found
          console.log('No meeting audio found, adding silent track');
          const oscillator = audioContext.createOscillator();
          const silentGain = audioContext.createGain();
          silentGain.gain.value = 0.0001;
          oscillator.connect(silentGain);
          silentGain.connect(audioDestination);
          oscillator.start();
        }
      } catch (audioError) {
        console.error('Audio setup failed:', audioError);
        window.recordingError = 'Audio setup failed: ' + audioError.toString();
        // Continue anyway, just without audio
      }

      // Step 3: Create combined stream
      try {
        console.log('Creating combined stream...');
        combinedStream = new MediaStream();

        // Add video tracks
        screenStream.getVideoTracks().forEach(track => {
          combinedStream.addTrack(track);
        });

        // Add audio tracks if available
        if (audioDestination && audioDestination.stream) {
          audioDestination.stream.getAudioTracks().forEach(track => {
            combinedStream.addTrack(track);
          });
        }

        console.log('Combined stream created with',
          combinedStream.getVideoTracks().length, 'video and',
          combinedStream.getAudioTracks().length, 'audio tracks');
      } catch (streamError) {
        console.error('Stream combination failed:', streamError);
        window.recordingError = 'Stream combination failed: ' + streamError.toString();

        // If combining failed, just use screen stream
        combinedStream = screenStream;
        console.log('Falling back to screen stream only');
      }

      // Step 4: Set up MediaRecorder
      try {
        console.log('Setting up MediaRecorder...');

        // Find supported MIME types
        const mimeTypes = [
          'video/webm;codecs=vp8,opus',
          'video/webm;codecs=vp9,opus',
          'video/webm'
        ];

        for (const type of mimeTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            selectedMimeType = type;
            break;
          }
        }

        if (!selectedMimeType) {
          selectedMimeType = 'video/webm';
        }

        window.selectedMimeType = selectedMimeType;
        console.log('Using MIME type:', selectedMimeType);

        // Create recorder
        recorder = new MediaRecorder(combinedStream, {
          mimeType: selectedMimeType,
          videoBitsPerSecond: 2500000
        });

        window.recordingChunks = [];

        // Handle chunks
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            window.recordingChunks.push(event.data);
            console.log('Chunk received:', event.data.size, 'bytes');
          }
        };

        // Start with a larger initial chunk to ensure proper header
        recorder.start(5000);  // 5 second first chunk
        console.log('Started recording with 5-second first chunk');

        // After first chunk, switch to smaller chunks
        setTimeout(() => {
          if (recorder && recorder.state === 'recording') {
            recorder.stop();
            recorder.start(1000);  // 1 second chunks after that
            console.log('Switched to 1-second chunks');
          }
        }, 5100);  // Wait just over 5 seconds

        window.recordingState = 'recording';

        // Define stop function
        window.stopScreenRecording = () => {
          return new Promise((resolve, reject) => {
            console.log('Stopping recording...');
            window.recordingState = 'stopping';

            // Exit early if no recorder
            if (!recorder) {
              window.recordingError = 'No recorder available';
              reject(new Error('No recorder available'));
              return;
            }

            // Stop recorder if running
            if (recorder.state === 'recording') {
              recorder.stop();
            }

            recorder.onstop = async () => {
              try {
                console.log('Processing', window.recordingChunks.length, 'chunks');
                window.recordingState = 'processing';

                if (!window.recordingChunks || window.recordingChunks.length === 0) {
                  window.recordingError = 'No recording chunks available';
                  reject(new Error('No recording chunks available'));
                  return;
                }

                // Create blob from chunks
                // CRITICAL - Ensure we use the first chunk for header
                const firstChunk = window.recordingChunks[0];
                const restChunks = window.recordingChunks.slice(1);

                // Create a new blob ensuring the header chunk is first
                const blob = new Blob([firstChunk, ...restChunks], {
                  type: selectedMimeType
                });

                console.log('Created blob of size:', blob.size, 'bytes');

                // Convert to base64
                const reader = new FileReader();
                reader.onloadend = () => {
                  window.recordedVideoBase64 = reader.result;
                  console.log('Base64 conversion complete');

                  // Clean up
                  if (screenStream) {
                    screenStream.getTracks().forEach(track => track.stop());
                  }
                  if (audioContext) {
                    audioContext.close();
                  }

                  window.recordingState = 'completed';
                  resolve(true);
                };

                reader.onerror = (e) => {
                  window.recordingError = 'FileReader error: ' + e.toString();
                  reject(e);
                };

                reader.readAsDataURL(blob);
              } catch (e) {
                window.recordingError = 'Error in stop handler: ' + e.toString();
                reject(e);
              }
            };
          });
        };

      } catch (recorderError) {
        console.error('Recorder setup failed:', recorderError);
        window.recordingError = 'Recorder setup failed: ' + recorderError.toString();
      }

    } catch (outerError) {
      console.error('Screen recording setup error:', outerError);
      window.recordingError = 'Setup error: ' + outerError.toString();
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
      this.logger.info("Microphone muted");

      const cameraMuteButton = await this.driver?.findElement(
        By.css('div[aria-label="Turn off camera"]')
      );
      await cameraMuteButton?.click();
      this.logger.info("Camera turned off");

      // skip meet keeps you safe popup if exist
      try {
        const skipButton = await this.driver?.findElement(
          By.xpath("/html/body/div[1]/div[3]/span/div[2]/div/di")
        );
        if (skipButton) {
          await skipButton.click();
          this.logger.info("Skipped safety popup");
        }
      } catch (error) {
        this.logger.info("Safety popup not found, continuing...");
      }
    } catch (muteError) {
      this.logger.warn(`Failed to mute devices: ${muteError}`);
    }

    // Start screen recording
    this.logger.info("Starting screen recording...");
    // wait unit this elemeeent is found aria-label="Leave call"
    await this.driver?.wait(
      until.elementLocated(By.css('button[aria-label="Leave call"]')),
      20000
    );
    await this.driver?.executeScript(this.getScreenRecordingScript());
    this.logger.info("Screen recording started");

    // Wait for specified duration (fixing the multiplication)
    this.logger.info(`Recording for ${this.config.durationMinutes} minutes...`);
    await new Promise(
      (resolve) => setTimeout(resolve, this.config.durationMinutes * 60 * 1000) // Changed from 2000 to 1000
    );
  }

  async getRecordedVideo(): Promise<string | null> {
    try {
      // Get recorded video with simple error checking
      const result = (await this.driver?.executeScript(`
        return {
          success: !!window.recordedVideoBase64,
          data: window.recordedVideoBase64 || null,
          type: window.selectedMimeType || 'video/webm'
        };
      `)) as VideoDataResult | undefined;

      if (!result?.success || !result.data) {
        this.logger.error("No video data available");
        return null;
      }

      // Just extract the base64 part from the data URL
      const base64Data = result.data;
      if (typeof base64Data === "string" && base64Data.includes("base64,")) {
        return base64Data.split("base64,")[1];
      }

      return base64Data;
    } catch (error) {
      this.logger.error(`Error getting recorded video: ${error}`);
      return null;
    }
  }

  async stopRecording(): Promise<void> {
    try {
      this.logger.info("Stopping screen recording...");

      interface RecordingState {
        state: string;
        error: string | null;
      }

      // Get current recording state
      const recordingState = (await this.driver?.executeScript(
        "return { state: window.recordingState || 'unknown', error: window.recordingError || null }"
      )) as RecordingState;
      this.logger.info(
        `Current recording state: ${recordingState.state}, Error: ${
          recordingState.error || "none"
        }`
      );

      // If we're in an error state already, try to collect diagnostic info
      if (recordingState.error) {
        this.logger.warn(`Recording error detected: ${recordingState.error}`);
      }

      // Call browser stop function with robust error handling
      const stopResult = (await this.driver?.executeScript(`
      try {
        if (typeof window.stopScreenRecording === 'function') {
          console.log("Calling stopScreenRecording...");
          return window.stopScreenRecording()
            .then(() => ({ success: true, message: "Recording stopped successfully" }))
            .catch(err => ({
              success: false,
              message: "Error during stop: " + (err ? err.toString() : "unknown"),
              error: err ? err.toString() : null
            }));
        } else {
          return {
            success: false,
            message: "Stop function not found",
            state: window.recordingState || 'unknown',
            error: window.recordingError || null
          };
        }
      } catch (err) {
        return {
          success: false,
          message: "Exception in stop function: " + (err ? err.toString() : "unknown"),
          error: err ? err.toString() : null
        };
      }
    `)) as StopResult;

      this.logger.info(`Stop result: ${JSON.stringify(stopResult)}`);

      // Extra handling for stop function not found
      if (
        !stopResult.success &&
        stopResult.message === "Stop function not found"
      ) {
        this.logger.warn(
          "Stop function not found. Attempting to debug browser state..."
        );

        // Check if we have window.recordingChunks
        const debugInfo = (await this.driver?.executeScript(`
        return {
          hasRecordingChunks: !!window.recordingChunks,
          chunkCount: window.recordingChunks ? window.recordingChunks.length : 0,
          hasMediaRecorder: typeof MediaRecorder !== 'undefined',
          recordingState: window.recordingState || 'unknown',
          recordingError: window.recordingError || null,
          navigatorMediaDevices: !!navigator.mediaDevices,
          navigatorGetDisplayMedia: !!navigator.mediaDevices.getDisplayMedia,
          windowAudioContext: !!(window.AudioContext || window.webkitAudioContext),
          documentReadyState: document.readyState
        };
      `)) as DebugInfo | undefined;

        this.logger.info(`Browser debug info: ${JSON.stringify(debugInfo)}`);

        // Try emergency recovery if we have chunks
        if (
          debugInfo &&
          debugInfo.hasRecordingChunks &&
          debugInfo.chunkCount > 0
        ) {
          this.logger.info(
            `Found ${debugInfo.chunkCount} recording chunks, attempting emergency recovery...`
          );

          const emergencyData = (await this.driver?.executeScript(`
          try {
            if (!window.recordingChunks || window.recordingChunks.length === 0) {
              return { success: false, message: "No chunks available" };
            }

            const blob = new Blob(window.recordingChunks, {
              type: window.selectedMimeType || 'video/webm'
            });

            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                window.recordedVideoBase64 = reader.result;
                resolve({
                  success: true,
                  message: "Emergency recovery successful",
                  size: reader.result ? reader.result.length : 0
                });
              };
              reader.onerror = () => {
                resolve({ success: false, message: "Reader error" });
              };
              reader.readAsDataURL(blob);
            });
          } catch (err) {
            return {
              success: false,
              message: "Recovery error: " + (err ? err.toString() : "unknown")
            };
          }
        `)) as EmergencyData | undefined;

          this.logger.info(
            `Emergency recovery result: ${JSON.stringify(emergencyData)}`
          );
        }
      }

      // Wait for video data to be ready
      this.logger.info("Waiting for video data to be available...");
      let videoAvailable = false;
      let attempts = 0;
      const maxAttempts = 15;

      while (!videoAvailable && attempts < maxAttempts) {
        attempts++;
        this.logger.info(
          `Checking video data (attempt ${attempts}/${maxAttempts})...`
        );

        try {
          const dataStatus = (await this.driver?.executeScript(`
          return {
            state: window.recordingState || 'unknown',
            available: !!window.recordedVideoBase64,
            error: window.recordingError || null,
            chunks: window.recordingChunks ? window.recordingChunks.length : 0,
            sampleSize: window.recordedVideoBase64 ? window.recordedVideoBase64.length : 0
          };
        `)) as VideoDataStatus | undefined;

          this.logger.info(`Video status: ${JSON.stringify(dataStatus)}`);

          if (dataStatus && dataStatus.available) {
            videoAvailable = true;
            this.logger.info("Video data is available!");
            break;
          }

          // Emergency recovery logic similar to before...
          // (keep your existing emergency recovery code)
        } catch (checkError) {
          this.logger.warn(`Error checking video status: ${checkError}`);
        }

        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }

      if (!videoAvailable) {
        // Save a screenshot for debugging
        try {
          const screenshotPath = path.join(
            this.config.outputDirectory,
            `error-screenshot-${Date.now()}.png`
          );

          const screenshot = await this.driver?.takeScreenshot();
          if (screenshot) {
            fs.writeFileSync(screenshotPath, screenshot, "base64");
            this.logger.info(`Error screenshot saved to: ${screenshotPath}`);
          }
        } catch (screenshotError) {
          this.logger.warn(
            `Failed to take error screenshot: ${screenshotError}`
          );
        }

        throw new Error(
          "Timed out waiting for video data after multiple attempts"
        );
      }

      this.logger.info("Screen recording stopped successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to stop recording: ${errorMessage}`);
      throw error;
    }
  }
}
