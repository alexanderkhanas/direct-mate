import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@direct-mate/shared';
import { User } from '../tenants/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { ResponseTemplate } from '../engine/entities/response-template.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { BASE_TEMPLATES } from '../../scripts/seed/templates/base';
import { CLOTHING_TEMPLATES } from '../../scripts/seed/templates/clothing';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async login(dto: LoginDto): Promise<{ accessToken: string; user: Omit<User, 'passwordHash'> }> {
    const user = await this.userRepo.findOne({
      where: { email: dto.email, isActive: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        tenant: user.tenant,
      },
    };
  }

  async me(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async deleteAccount(userId: string, tenantId: string): Promise<{ success: boolean }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.Owner) {
      throw new UnauthorizedException('Only the account owner can delete the account');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Tenant, { id: tenantId });
    });

    return { success: true };
  }

  async register(dto: RegisterDto): Promise<{ accessToken: string; user: any }> {
    // 1. Check email uniqueness globally
    const existingUser = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existingUser) throw new ConflictException('Email already registered');

    // 2. Generate slug
    let slug = this.slugify(dto.storeName);

    // 3. Transaction: create everything
    return this.dataSource.transaction(async (manager) => {
      // Handle slug collision (retry up to 3 times)
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await manager.findOne(Tenant, { where: { slug } });
        if (!existing) break;
        slug = this.slugify(dto.storeName) + '-' + this.randomSuffix();
      }

      // Create tenant
      const tenant = manager.create(Tenant, {
        name: dto.storeName,
        slug,
        businessType: dto.businessType as any,
        timezone: 'Europe/Kyiv',
        isActive: true,
      });
      const savedTenant = await manager.save(tenant);

      // Create user
      const passwordHash = await bcrypt.hash(dto.password, 10);
      const user = manager.create(User, {
        tenantId: savedTenant.id,
        email: dto.email,
        passwordHash,
        role: UserRole.Owner,
        isActive: true,
      });
      const savedUser = await manager.save(user);

      // Create tenant settings
      const settings = manager.create(TenantSettings, {
        tenantId: savedTenant.id,
        supportedLanguages: ['uk'],
        brandTonePrompt: 'Warm, friendly, concise. Use Ukrainian. Never reveal you are AI.',
      });
      await manager.save(settings);

      // Create store config
      const storeConfig = manager.create(StoreConfig, {
        tenantId: savedTenant.id,
      });
      await manager.save(storeConfig);

      // Create default templates
      await this.createDefaultTemplates(manager, savedTenant.id);

      // Generate JWT
      const payload: JwtPayload = {
        sub: savedUser.id,
        email: savedUser.email,
        role: savedUser.role,
        tenantId: savedTenant.id,
      };

      const result = {
        accessToken: this.jwtService.sign(payload),
        user: {
          id: savedUser.id,
          email: savedUser.email,
          role: savedUser.role,
          tenantId: savedTenant.id,
        },
      };

      // Create trial plan OUTSIDE the transaction — if Mono API is down,
      // registration still succeeds and trial can be created manually later.
      setTimeout(async () => {
        try {
          await this.subscriptionsService.createTrialForTenant(savedTenant.id);
        } catch (err) {
          console.error(`Trial creation failed for tenant ${savedTenant.id}:`, err);
        }
      }, 0);

      return result;
    });
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9а-яіїєґ\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
  }

  private randomSuffix(): string {
    return Math.random().toString(36).substring(2, 6);
  }

  /**
   * Insert the default starter-pack response templates for a newly registered
   * tenant. Pulls from the same source-of-truth as the demo-tenant builders
   * (BASE_TEMPLATES + CLOTHING_TEMPLATES) so adding a new scenario in
   * `seed/templates/{base,clothing}/index.ts` automatically propagates to new
   * registrations.
   *
   * Vertical: defaults to clothing/fashion. If a future signup flow surfaces
   * `businessType === 'cosmetics'`, swap CLOTHING_TEMPLATES for
   * COSMETICS_TEMPLATES based on `dto.businessType`.
   */
  private async createDefaultTemplates(manager: EntityManager, tenantId: string): Promise<void> {
    // Dedup by scenario — vertical templates can override base entries by key.
    const merged = new Map<string, (typeof BASE_TEMPLATES)[number]>();
    for (const t of BASE_TEMPLATES) merged.set(t.scenario, t);
    for (const t of CLOTHING_TEMPLATES) merged.set(t.scenario, t);

    for (const t of merged.values()) {
      const entity = manager.create(ResponseTemplate, {
        tenantId,
        scenario: t.scenario,
        stage: t.stage,
        blocks: t.blocks,
        requiredVariables: t.requiredVariables,
        toneTags: t.toneTags,
        priority: t.priority,
        active: t.active,
      });
      await manager.save(entity);
    }
  }
}
