import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';

export const DEFAULT_DEMO_TENANT_SLUG = 'demo-women-clothes';

@Injectable()
export class DemoService implements OnModuleInit {
  private readonly logger = new Logger(DemoService.name);
  private readonly demoTenants = new Map<string, string>();

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async onModuleInit(): Promise<void> {
    const rows: Array<{ slug: string; id: string }> = await this.tenantRepo.query(
      `SELECT slug, id FROM tenants WHERE is_demo = true`,
    );
    this.demoTenants.clear();
    for (const r of rows) this.demoTenants.set(r.slug, r.id);

    if (this.demoTenants.size === 0) {
      this.logger.warn(
        'No demo tenants found — POST /demo/message will return 503. Run the demo seed scripts.',
      );
      return;
    }
    this.logger.log(
      `Demo tenants resolved (${this.demoTenants.size}): ${Array.from(this.demoTenants.keys()).join(', ')}`,
    );
  }

  /**
   * Resolve a demo tenant by slug. Returns null if the slug is not a known
   * `is_demo=true` tenant. Caller decides 404 vs 503 semantics.
   */
  getTenantId(slug: string = DEFAULT_DEMO_TENANT_SLUG): string | null {
    return this.demoTenants.get(slug) ?? null;
  }

  /** True when at least one demo tenant exists (any slug). */
  hasAnyTenant(): boolean {
    return this.demoTenants.size > 0;
  }

  listSlugs(): string[] {
    return Array.from(this.demoTenants.keys());
  }
}
