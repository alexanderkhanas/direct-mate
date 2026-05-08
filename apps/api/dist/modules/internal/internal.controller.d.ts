import { IntegrationsService } from '../integrations/integrations.service';
import { CatalogService } from '../catalog/catalog.service';
import { SyncTriggerDto } from './dto/sync-trigger.dto';
import { SyncJobStatusDto } from './dto/sync-job-status.dto';
import { CatalogImportDto } from './dto/catalog-import.dto';
import { StockImportDto } from './dto/stock-import.dto';
export declare class InternalController {
    private readonly integrationsService;
    private readonly catalogService;
    constructor(integrationsService: IntegrationsService, catalogService: CatalogService);
    private verifyConnectionOwnership;
    syncCatalog(dto: SyncTriggerDto): Promise<{
        jobId: string;
        accepted: boolean;
    }>;
    syncStock(dto: SyncTriggerDto): Promise<{
        jobId: string;
        accepted: boolean;
    }>;
    catalogImport(dto: CatalogImportDto): Promise<{
        productsCreated: number;
        productsUpdated: number;
        productsArchived: number;
        variantsCreated: number;
        variantsUpdated: number;
        categoriesCreated: number;
        errors: string[];
        success: boolean;
        jobId: string;
        error?: undefined;
    } | {
        success: boolean;
        jobId: string;
        error: string;
    }>;
    stockImport(dto: StockImportDto): Promise<{
        processed: number;
        updated: number;
        skipped: number;
        errors: string[];
        success: boolean;
        jobId: string;
        error?: undefined;
    } | {
        success: boolean;
        jobId: string;
        error: any;
    }>;
    updateSyncJob(id: string, dto: SyncJobStatusDto): Promise<{
        updated: boolean;
    }>;
}
