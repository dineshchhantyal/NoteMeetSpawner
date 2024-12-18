export interface IMeetingConfig {
    meetingUrl: string;
    botName?: string;
    outputDirectory: string;
    durationMinutes: number;
    storageType: 'local' | 's3' | 'both';
    s3Config?: {
        bucket: string;
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
    };
}
