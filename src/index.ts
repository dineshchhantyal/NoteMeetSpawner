import path from 'path';
import { GoogleMeetRecorder } from './providers/GoogleMeetRecorder';
import dotenv from 'dotenv';

dotenv.config();

async function main() {



    const meetingUrl = 'https://meet.google.com/xyu-vvtp-gts';
    const usernameGroup = 'group1';
    const outputDirectory = path.join(__dirname, 'meet-recordings', usernameGroup);

    const recorder = new GoogleMeetRecorder({
        meetingUrl,
        outputDirectory,
        durationMinutes: 1,
        storageType: 's3',
        s3Config: {
            region: process.env.S3_REGION!,
            accessKeyId: process.env.S3_ACCESS_KEY_ID!,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
            bucket: process.env.S3_BUCKET!,
            endpoint: process.env.S3_ENDPOINT!
        }
    });

    await recorder.recordMeeting(); 
}

main().catch(console.error);
