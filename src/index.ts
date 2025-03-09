import path from "path";
import { GoogleMeetRecorder } from "./providers/GoogleMeetRecorder";
import dotenv from "dotenv";

dotenv.config();

/**
 * Main function to initiate and manage Google Meet recording process.
 *
 * @description
 * This function handles the setup and execution of Google Meet recording with the following steps:
 * 1. Retrieves configuration from environment variables with fallback values
 * 2. Sets up output directory for recordings
 * 3. Initializes and executes the Google Meet recorder
 *
 * @requires
 * - Environment variables:
 *   - MEETING_URL: URL of the Google Meet session
 *   - USERNAME_GROUP: Group identifier for organizing recordings
 *   - DURATION_MINUTES: Recording duration in minutes
 *   - S3_* variables if using S3 storage
 *
 * @example
 * ```
 * // Basic usage with environment variables
 * await main();
 * ```
 *
 * @throws Will throw an error if recording process fails
 * @async
 * @returns {Promise<void>}
 */
async function main() {
  const meetingUrl =
    process.env.MEETING_URL || "https://meet.google.com/jnf-tsow-pif";
  const usernameGroup = process.env.USERNAME_GROUP || "group1";
  const durationMinutes = process.env.DURATION_MINUTES
    ? parseInt(process.env.DURATION_MINUTES, 10)
    : 0.5;

  const outputDirectory = path.join(
    __dirname,
    "meet-recordings",
    usernameGroup
  );

  const recorder = new GoogleMeetRecorder({
    meetingUrl,
    outputDirectory,
    durationMinutes,
    storageType: "local",
    s3Config: {
      region: process.env.S3_REGION!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      bucket: process.env.S3_BUCKET!,
      endpoint: process.env.S3_ENDPOINT!,
    },
  });

  await recorder.recordMeeting();
}

main().catch(console.error);
