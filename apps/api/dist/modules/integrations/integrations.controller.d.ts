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
}
export {};
