export interface IMeetingRecorder {
    recordMeeting(durationMinutes: number): Promise<void>;
    cleanup(): Promise<void>;
}
