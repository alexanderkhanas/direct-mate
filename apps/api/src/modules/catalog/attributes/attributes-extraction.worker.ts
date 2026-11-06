import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductAttributesService } from './product-attributes.service';

/**
 * Reads attributes for new and changed products in the background, off the
 * catalog-sync path: a sync of 300 products shouldn't wait on 300 vision
 * calls. Same shape as `ProductMediaEmbedderService`: one tick at a time, a
 * small batch, sequential calls, failures retried after a backoff.
 *
 * Off unless ATTRIBUTES_WORKER_ENABLED=true, because every product it reads is
 * a paid model call. `npm run attributes:extract -- --tenant <slug>` runs the
 * same extraction for one store by hand.
 */
@Injectable()
export class AttributesExtractionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttributesExtractionWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly attributes: ProductAttributesService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('attributes.workerEnabled')) return;
    const tickMs = this.config.get<number>('attributes.tickMs') ?? 60000;
    this.logger.log(`Attribute extraction worker starting (tick=${tickMs}ms, model=${this.attributes.modelId()})`);
    this.timer = setInterval(() => void this.tick(), tickMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const ids = await this.attributes.findStale({
        limit: this.config.get<number>('attributes.batch') ?? 10,
        backoffMinutes: this.config.get<number>('attributes.backoffMinutes') ?? 30,
      });
      if (ids.length === 0) return;
      let ok = 0;
      for (const id of ids) {
        const result = await this.attributes.extract(id);
        if (result.ok) ok++;
      }
      this.logger.log(`Read attributes for ${ok}/${ids.length} products`);
    } catch (err) {
      this.logger.error(`Attribute extraction tick failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running = false;
    }
  }
}
