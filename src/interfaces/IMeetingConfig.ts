export interface IMeetingConfig {
    meetingUrl: string;
    outputDirectory: string;
    username?: string;
    maxResolutionWidth?: number;
    maxResolutionHeight?: number;
    durationMinutes: number;
}
