import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { IntegrationsService } from './integrations.service';
export declare class IntegrationsController {
    private readonly integrationsService;
    constructor(integrationsService: IntegrationsService);
    findAll(user: JwtPayload): Promise<import("./entities/connection.entity").Connection[]>;
    disconnect(id: string): Promise<void>;
}
