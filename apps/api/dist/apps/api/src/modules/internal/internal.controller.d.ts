import { IntegrationsService } from '../integrations/integrations.service';
import { SyncTriggerDto } from './dto/sync-trigger.dto';
export declare class InternalController {
    private readonly integrationsService;
    constructor(integrationsService: IntegrationsService);
    syncCatalog(dto: SyncTriggerDto): Promise<{
        jobId: string;
        accepted: boolean;
    }>;
    syncStock(dto: SyncTriggerDto): Promise<{
        jobId: string;
        accepted: boolean;
    }>;
}
