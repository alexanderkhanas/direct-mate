import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { IntegrationsService } from './integrations.service';
declare class ConnectInstagramDto {
    pageId: string;
    accessToken: string;
    accountName?: string;
}
declare class ConnectShopifyDto {
    shopDomain: string;
    accessToken: string;
    shopName?: string;
}
export declare class IntegrationsController {
    private readonly integrationsService;
    constructor(integrationsService: IntegrationsService);
    findAll(user: JwtPayload): Promise<import("./entities/connection.entity").Connection[]>;
    connectInstagram(user: JwtPayload, dto: ConnectInstagramDto): Promise<import("./entities/connection.entity").Connection>;
    connectShopify(user: JwtPayload, dto: ConnectShopifyDto): Promise<import("./entities/connection.entity").Connection>;
    disconnect(id: string): Promise<void>;
    remove(id: string): Promise<void>;
}
declare class ResolveCredentialsDto {
    connectionId: string;
    tenantId: string;
    platform: string;
    purpose: string;
}
export declare class InternalConnectionsController {
    private readonly integrationsService;
    constructor(integrationsService: IntegrationsService);
    resolveCredentials(dto: ResolveCredentialsDto): Promise<{
        type: string;
        shopDomain: any;
        accessToken: string;
        apiVersion: string;
        externalAccountId?: undefined;
        metadata?: undefined;
    } | {
        type: import("@direct-mate/shared").ConnectionType;
        externalAccountId: string | null;
        accessToken: string;
        metadata: Record<string, any>;
        shopDomain?: undefined;
        apiVersion?: undefined;
    }>;
}
export declare class InstagramOAuthController {
    private readonly integrationsService;
    private readonly config;
    private readonly logger;
    constructor(integrationsService: IntegrationsService, config: ConfigService);
    start(user: JwtPayload): Promise<{
        redirectUrl: string;
    }>;
    callback(code: string, state: string, res: Response): Promise<void>;
}
export {};
