import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@direct-mate/shared';
import { User } from '../tenants/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TelegramService } from '../notifications/telegram.service';
import { DEFAULT_BRAND_TONE, defaultWelcomeLine } from '../onboarding/store-defaults';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly telegram: TelegramService,
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

    const businessType = dto.businessType ?? 'fashion';

    // 2. Generate slug
    let slug = this.slugify(dto.storeName);

    // 3. Transaction: create everything
    const registered = await this.dataSource.transaction(async (manager) => {
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
        businessType: businessType as any,
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
        brandTonePrompt: DEFAULT_BRAND_TONE,
      });
      await manager.save(settings);

      // Create store config. Paused until the owner turns the bot on in the
      // setup flow (set here, not as the column default: rows auto-created
      // for older stores must not silently pause them).
      const storeConfig = manager.create(StoreConfig, {
        tenantId: savedTenant.id,
        operatingMode: 'paused',
        brandConfig: { welcomeLine: defaultWelcomeLine(dto.storeName) },
      });
      await manager.save(storeConfig);

      // The trial commits with the store: a store with no plan row would count as active forever.
      await this.subscriptionsService.createTrialForTenant(savedTenant.id, manager);
      // Not finished: the owner lands in the setup flow.
      await manager.query(`INSERT INTO tenant_onboarding (tenant_id) VALUES ($1)`, [savedTenant.id]);

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

      return result;
    });

    void this.telegram.notifyPlatform(`🆕 Нова реєстрація: «${dto.storeName}» (${dto.email}), ${businessType}`);
    return registered;
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
}
