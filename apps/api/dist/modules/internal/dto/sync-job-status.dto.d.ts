export declare enum SyncJobUpdateStatus {
    Success = "success",
    Failed = "failed"
}
export declare class SyncJobStatusDto {
    status: SyncJobUpdateStatus;
    summary?: string;
    errorMessage?: string;
}
