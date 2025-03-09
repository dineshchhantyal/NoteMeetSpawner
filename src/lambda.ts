import { GoogleMeetRecorder } from "./providers/GoogleMeetRecorder";

/**
 * AWS Lambda handler for NoteMeet recording service
 *
 * Expected event structure:
 * {
 *   "meetingUrl": "https://meet.google.com/xxx-xxxx-xxx",
 *   "durationMinutes": 60,
 *   "botName": "NoteMeet Bot",
 *   "outputPrefix": "recordings/client-name"  // optional S3 prefix
 * }
 */
export const handler = async (event: any) => {
  console.log("Event received:", JSON.stringify(event, null, 2));

  try {
    // Validate required parameters
    if (!event.meetingUrl) {
      throw new Error("Missing required parameter: meetingUrl");
    }

    // Set up temporary directory for Lambda
    const tempDir = "/tmp/meet-recordings";

    // Extract parameters from the event
    const meetingUrl = event.meetingUrl;
    const durationMinutes = event.durationMinutes || 60;
    const botName = event.botName || "NoteMeet Bot";

    // Configure the recorder
    const recorder = new GoogleMeetRecorder({
      meetingUrl,
      botName,
      outputDirectory: tempDir,
      durationMinutes,
      storageType: "local", // Always use S3 in Lambda
      s3Config: {
        region: process.env.S3_REGION!,
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        bucket: process.env.S3_BUCKET!,
        endpoint: process.env.S3_ENDPOINT,
      },
    });

    // Start recording process
    console.log(`Starting recording for meeting: ${meetingUrl}`);
    await recorder.recordMeeting();

    // Return success response
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Meeting recording completed successfully",
        meetingUrl,
        recordingDuration: durationMinutes,
      }),
    };
  } catch (error: any) {
    console.error("Error recording meeting:", error);

    // Return error response
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Failed to record meeting",
        error: error.message,
        stack: process.env.DEBUG === "true" ? error.stack : undefined,
      }),
    };
  }
};
