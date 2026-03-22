export declare class IntegrationEvent {
    id: string;
    tenantId: string;
    connectionId: string | null;
    eventType: string;
    externalEventId: string | null;
    payload: Record<string, unknown> | null;
    processed: boolean;
    processedAt: Date | null;
    createdAt: Date;
}
