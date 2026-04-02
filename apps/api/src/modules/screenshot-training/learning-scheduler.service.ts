import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { TelegramService } from '../notifications/telegram.service';

@Injectable()
export class LearningSchedulerService {
  private readonly logger = new Logger(LearningSchedulerService.name);

  constructor(
    @InjectRepository(StoreConfig)
    private readonly storeConfigRepo: Repository<StoreConfig>,
    private readonly telegram: TelegramService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async checkLearningPeriodExpiry(): Promise<void> {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const expired = await this.storeConfigRepo.find({
      where: {
        operatingMode: 'learning',
        learningStartedAt: LessThan(fourteenDaysAgo),
        learningNotifiedAt: IsNull(),
      },
    });

    for (const config of expired) {
      try {
        await this.telegram.sendToTenant(
          config.tenantId,
          '✅ Навчання DirectMate завершено!\n\nПерегляньте зібрані розмови в розділі «Навчання» та натисніть «Go Live» в налаштуваннях, коли будете готові.',
        );

        await this.storeConfigRepo.update(config.id, {
          learningNotifiedAt: new Date(),
        });

        this.logger.log(`Learning period expired notification sent for tenant ${config.tenantId}`);
      } catch (err) {
        this.logger.error(`Failed to notify tenant ${config.tenantId}`, err);
      }
    }
  }
}
