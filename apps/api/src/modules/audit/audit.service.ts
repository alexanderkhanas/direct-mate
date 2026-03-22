import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { IntegrationEvent } from './entities/integration-event.entity';
import { AuditLogStatus, AuditLogType } from '@direct-mate/shared';

export interface LogParams {
  tenantId: string;
  conversationId?: string;
  type: AuditLogType;
  status?: AuditLogStatus;
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(IntegrationEvent)
    private readonly eventRepo: Repository<IntegrationEvent>,
  ) {}

  async log(params: LogParams): Promise<AuditLog> {
    const entry = this.auditRepo.create({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      type: params.type,
      status: params.status ?? AuditLogStatus.Success,
      details: params.details,
    });
    return this.auditRepo.save(entry);
  }

  async getConversationLogs(conversationId: string): Promise<AuditLog[]> {
    return this.auditRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  async recordIntegrationEvent(params: {
    tenantId: string;
    connectionId?: string;
    eventType: string;
    externalEventId?: string;
    payload?: Record<string, unknown>;
  }): Promise<IntegrationEvent> {
    const event = this.eventRepo.create({
      tenantId: params.tenantId,
      connectionId: params.connectionId,
      eventType: params.eventType,
      externalEventId: params.externalEventId,
      payload: params.payload,
    });
    return this.eventRepo.save(event);
  }

  async markEventProcessed(id: string): Promise<void> {
    await this.eventRepo.update(id, { processed: true, processedAt: new Date() });
  }
}
