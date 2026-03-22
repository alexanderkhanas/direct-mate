import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';
import { IntegrationsService } from '../integrations/integrations.service';
import { CatalogService } from '../catalog/catalog.service';
import { SyncTriggerDto } from './dto/sync-trigger.dto';
import { SyncJobStatusDto } from './dto/sync-job-status.dto';
import { CatalogImportDto } from './dto/catalog-import.dto';
import { StockImportDto } from './dto/stock-import.dto';
import { SyncType } from '@direct-mate/shared';

@ApiTags('internal')
@UseGuards(InternalApiKeyGuard)
@Controller('internal')
export class InternalController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly catalogService: CatalogService,
  ) {}

  @Post('sync/catalog')
  async syncCatalog(@Body() dto: SyncTriggerDto) {
    const job = await this.integrationsService.queueSyncJob(
      dto.tenantId,
      dto.connectionId ?? '',
      SyncType.Catalog,
      dto.mode,
    );
    return { jobId: job.id, accepted: true };
  }

  @Post('sync/stock')
  async syncStock(@Body() dto: SyncTriggerDto) {
    const job = await this.integrationsService.queueSyncJob(
      dto.tenantId,
      dto.connectionId ?? '',
      SyncType.Stock,
      dto.mode,
    );
    return { jobId: job.id, accepted: true };
  }

  /**
   * n8n sends normalized catalog data here.
   * Creates a sync job, imports products/variants/stock, marks job done.
   */
  @Post('sync/catalog-import')
  async catalogImport(@Body() dto: CatalogImportDto) {
    const job = await this.integrationsService.queueSyncJob(
      dto.tenantId,
      dto.connectionId,
      SyncType.Catalog,
      'full',
    );
    await this.integrationsService.markJobRunning(job.id);

    try {
      const result = await this.catalogService.importCatalog(dto.tenantId, dto.products);
      await this.integrationsService.markJobDone(job.id, result as any);
      return { success: true, jobId: job.id, ...result };
    } catch (err: any) {
      await this.integrationsService.markJobFailed(job.id, err.message);
      return { success: false, jobId: job.id, error: err.message };
    }
  }

  /**
   * n8n sends normalized stock data here.
   * Creates a sync job, updates stock balances, marks job done.
   */
  @Post('sync/stock-import')
  async stockImport(@Body() dto: StockImportDto) {
    const job = await this.integrationsService.queueSyncJob(
      dto.tenantId,
      dto.connectionId,
      SyncType.Stock,
      'full',
    );
    await this.integrationsService.markJobRunning(job.id);

    try {
      const result = await this.catalogService.importStock(dto.tenantId, dto.items);
      await this.integrationsService.markJobDone(job.id, result as any);
      return { success: true, jobId: job.id, ...result };
    } catch (err: any) {
      await this.integrationsService.markJobFailed(job.id, err.message);
      return { success: false, jobId: job.id, error: err.message };
    }
  }

  @Patch('sync/jobs/:id')
  async updateSyncJob(@Param('id') id: string, @Body() dto: SyncJobStatusDto) {
    await this.integrationsService.updateJobStatus(id, dto.status, dto.summary, dto.errorMessage);
    return { updated: true };
  }
}
