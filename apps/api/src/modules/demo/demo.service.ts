import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';

@Injectable()
export class DemoService implements OnModuleInit {
  private readonly logger = new Logger(DemoService.name);
  private demoTenantId: string | null = null;

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async onModuleInit(): Promise<void> {
    const rows: Array<{ id: string }> = await this.tenantRepo.query(
      `SELECT id FROM tenants WHERE slug = 'demo' AND is_demo = true LIMIT 1`,
    );
    this.demoTenantId = rows[0]?.id ?? null;
    if (this.demoTenantId) {
      this.logger.log(`Demo tenant resolved: ${this.demoTenantId}`);
    } else {
      this.logger.warn(
        'Demo tenant not found — POST /demo/message will return 503. Run npm run seed:demo.',
      );
    }
  }

  getTenantId(): string | null {
    return this.demoTenantId;
  }
}
