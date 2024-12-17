import path from 'path';
import { GoogleMeetRecorder } from './providers/GoogleMeetRecorder';

async function main() {
    const meetingUrl = 'https://meet.google.com/dpj-ogga-vzp';
    const usernameGroup = 'group1';
    const outputDirectory = path.join(__dirname, 'meet-recordings', usernameGroup);

    const recorder = new GoogleMeetRecorder({
        meetingUrl,
        outputDirectory,
        durationMinutes: 1,
    });

    await recorder.recordMeeting(); 
}

main().catch(console.error);
