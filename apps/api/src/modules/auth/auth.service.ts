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
import { randomBytes } from 'crypto';
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
import { SessionsService } from './sessions.service';
import { assertNotLocked, clearFailures, recordFailure } from './login-attempts';
import { TwoFactorProof, TwoFactorService, TwoFactorSetup } from './two-factor/two-factor.service';

/** How long the code step may take after the password. */
const CHALLENGE_SECONDS = 5 * 60;
const CHALLENGE_PURPOSE = '2fa';
/** Login tokens of accounts with 2FA (others keep JWT_EXPIRES_IN). */
const STRICT_SESSION_SECONDS = 12 * 3600;

export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string;
  isActive: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  accessToken: string;
  user: PublicUser;
}

/** A login token, or the code step (`verify`) or 2FA setup (`setup`) the account owes first. */
export type LoginResult = Session | { twoFactor: 'verify' | 'setup'; challenge: string };

/** What the browser may see of a user: never the password hash or the code secret. */
function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    isActive: user.isActive,
    twoFactorEnabled: !!user.totpEnabledAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

let standIn: Promise<string> | null = null;
function standInHash(): Promise<string> {
  standIn ??= bcrypt.hash(randomBytes(16).toString('hex'), 10);
  return standIn;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly telegram: TelegramService,
    private readonly twoFactor: TwoFactorService,
    private readonly sessions: SessionsService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.userRepo.findOne({ where: { email: dto.email, isActive: true } });
    assertNotLocked(user?.lockedUntil);
    // Compared against a stand-in hash when there's no such user: the answer takes as long either way.
    const valid = await bcrypt.compare(dto.password, user?.passwordHash ?? (await standInHash()));
    // One answer for an unknown email and a wrong password: sign-in doesn't tell which emails exist.
    if (!user || !valid) {
      if (user) await recordFailure(this.dataSource, user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    const state = await this.sessions.state(user.id);
    if (state?.twoFactorEnabled) return { twoFactor: 'verify', challenge: this.challenge(user.id) };
    if (state?.twoFactorRequired) return { twoFactor: 'setup', challenge: this.challenge(user.id) };
    await clearFailures(this.dataSource, user.id);
    return this.session(user, false);
  }

  /** The second step of sign-in: a code from the app or a recovery code. */
  async verifyTwoFactor(challenge: string, proof: TwoFactorProof): Promise<Session> {
    const user = await this.challengeUser(challenge);
    if (!(await this.twoFactor.check(user.id, proof))) {
      throw new UnauthorizedException({ message: 'Wrong code', details: { code: 'invalid_code' } });
    }
    await clearFailures(this.dataSource, user.id);
    return this.session(user, true);
  }

  /** Setup at sign-in, for an account that must have 2FA and doesn't yet. */
  async setupTwoFactor(challenge: string): Promise<TwoFactorSetup> {
    const user = await this.challengeUser(challenge);
    return this.twoFactor.startSetup(user.id);
  }

  async enableTwoFactor(challenge: string, code: string): Promise<Session & { recoveryCodes: string[] }> {
    const user = await this.challengeUser(challenge);
    const recoveryCodes = await this.twoFactor.enable(user.id, code);
    if (!recoveryCodes) throw new UnauthorizedException({ message: 'Wrong code', details: { code: 'invalid_code' } });
    await clearFailures(this.dataSource, user.id);
    return { ...this.session(user, true), recoveryCodes };
  }

  /** A fresh login token for a signed-in user, after their sessions ended (2FA turned on or off). */
  async sessionFor(userId: string): Promise<Session> {
    const user = await this.userRepo.findOne({ where: { id: userId, isActive: true } });
    if (!user) throw new UnauthorizedException();
    const state = await this.sessions.state(userId);
    return this.session(user, !!(state?.twoFactorEnabled || state?.twoFactorRequired));
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return publicUser(user);
  }

  /** A login token. Accounts with 2FA get shorter ones. */
  private session(user: User, strict: boolean): Session {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId, iatMs: Date.now() };
    return {
      accessToken: this.jwtService.sign(payload, strict ? { expiresIn: STRICT_SESSION_SECONDS } : undefined),
      user: publicUser(user),
    };
  }

  /** Proof that the password was right, good for the code step only (never a login: JwtStrategy refuses it). */
  private challenge(userId: string): string {
    return this.jwtService.sign({ sub: userId, purpose: CHALLENGE_PURPOSE }, { expiresIn: CHALLENGE_SECONDS });
  }

  private async challengeUser(challenge: string): Promise<User> {
    let sub: string | undefined;
    try {
      const payload = this.jwtService.verify<{ sub?: string; purpose?: string }>(challenge);
      if (payload.purpose === CHALLENGE_PURPOSE) sub = payload.sub;
    } catch {
      // expired or not ours
    }
    const user = sub ? await this.userRepo.findOne({ where: { id: sub, isActive: true } }) : null;
    if (!user) throw new UnauthorizedException({ message: 'Sign in again', details: { code: 'challenge_expired' } });
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
        iatMs: Date.now(),
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
