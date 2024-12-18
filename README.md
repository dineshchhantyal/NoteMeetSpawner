# Screen Recording Agent

The NoteMeet Screen Recording Agent is a specialized component that handles automated video capture and streaming during meetings. Built using Selenium WebDriver, this agent provides seamless recording capabilities with direct integration to AWS S3 storage.

## Key Capabilities

### Video Recording
- Automated screen capture using Selenium WebDriver
- Real-time video streaming to AWS S3 
- Support for multiple video quality configurations
- Buffer management for optimal streaming performance

### AWS Integration 
- Direct streaming to S3 buckets
- Secure credential management
- Configurable storage lifecycle policies
- Automatic cleanup of temporary files

### Recording Controls
- Programmatic start/stop recording
- Customizable frame rates and resolution
- Error handling and recovery
- Session management

## Technical Details

The recording agent operates as part of the NoteMeet architecture by:
1. Initializing a headless Chrome instance via Selenium
2. Capturing screen content as video stream
3. Chunking and uploading stream data to S3
4. Managing recording metadata and session info

## Usage

This component is typically deployed as part of the NoteMeet infrastructure and interacts with other services to:
- Respond to meeting recording requests
- Stream meeting content to storage
- Provide recording status and health metrics
- Enable programmatic control of recording sessions

For detailed setup and configuration instructions, see the deployment documentation.
# NoteMeet
