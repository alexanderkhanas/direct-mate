import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { InstagramService } from './instagram.service';
export declare class InstagramController {
    private readonly instagramService;
    constructor(instagramService: InstagramService);
    verifyWebhook(mode: string, token: string, challenge: string): string;
    handleWebhook(req: RawBodyRequest<Request>, signature: string, body: Record<string, unknown>, tenantId: string): Promise<{
        received: boolean;
    }>;
}
