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

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
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

      return {
        accessToken: this.jwtService.sign(payload),
        user: {
          id: savedUser.id,
          email: savedUser.email,
          role: savedUser.role,
          tenantId: savedTenant.id,
        },
      };
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

  private async createDefaultTemplates(manager: EntityManager, tenantId: string): Promise<void> {
    const templates = [
      { scenario: 'greeting', stage: 'greeting', blocks: ['Вітаю 💛 Чим можу допомогти?'], requiredVariables: [], toneTags: ['warm'], priority: 90 },
      { scenario: 'show_products', stage: 'product_discovery', blocks: ['В наявності є такі варіанти 💛\n\n{product_list}\n\nМожу підказати, який краще підійде 💛'], requiredVariables: ['product_list'], toneTags: ['warm'], priority: 90 },
      { scenario: 'show_price', stage: 'product_discovery', blocks: ['Ціна на {product_name} — {price} 💛'], requiredVariables: ['product_name', 'price'], toneTags: ['warm'], priority: 90 },
      { scenario: 'confirm_selection', stage: 'product_selection', blocks: ['Оформлюємо {product_name} ({variant_name}), {price}? 💛'], requiredVariables: ['product_name', 'variant_name', 'price'], toneTags: ['warm'], priority: 90 },
      { scenario: 'ask_variant_choice', stage: 'product_selection', blocks: ['У {product_name} є такі варіанти:\n{variant_list}\n\nЯкий вам подобається? 💛'], requiredVariables: ['product_name', 'variant_list'], toneTags: ['warm'], priority: 90 },
      { scenario: 'ask_continue_or_checkout', stage: 'product_selection', blocks: ['Додала {product_name} ({variant_name}) 💛 Хочете ще щось, чи оформлюємо замовлення?'], requiredVariables: ['product_name'], toneTags: ['warm'], priority: 90 },
      { scenario: 'order_confirmed_ask_delivery', stage: 'checkout', blocks: ['Чудово 💛 Для оформлення напишіть:\n• ПІБ\n• Телефон\n• Місто та відділення НП'], requiredVariables: [], toneTags: ['warm'], priority: 90 },
      { scenario: 'collect_checkout_info', stage: 'checkout', blocks: ['Чудово 💛 Для оформлення напишіть, будь ласка:\n• ПІБ\n• Номер телефону\n• Місто та відділення Нової Пошти'], requiredVariables: [], toneTags: ['warm'], priority: 90 },
      { scenario: 'confirm_order', stage: 'order_confirmation', blocks: ['Дякую 💛 Ваше замовлення:\n{order_summary}\n\nОчікуйте повідомлення про відправку!'], requiredVariables: ['order_summary'], toneTags: ['warm'], priority: 90 },
      { scenario: 'answer_delivery', stage: 'faq', blocks: ['Відправка здійснюється Новою Поштою. Зазвичай 1-3 дні після оформлення 💛'], requiredVariables: [], toneTags: ['warm'], priority: 90 },
      { scenario: 'answer_payment', stage: 'faq', blocks: ['Оплата при отриманні (накладений платіж) або передоплата на картку 💛'], requiredVariables: [], toneTags: ['warm'], priority: 90 },
      { scenario: 'out_of_stock', stage: 'product_discovery', blocks: ['На жаль, {product_name} зараз немає в наявності. Можу підказати схожі варіанти або повідомити, коли з\'явиться 💛'], requiredVariables: ['product_name'], toneTags: ['warm'], priority: 90 },
      { scenario: 'product_not_found', stage: 'product_discovery', blocks: ['Зараз перевірю наявність і напишу вам 💛'], requiredVariables: [], toneTags: ['warm'], priority: 90 },
      { scenario: 'recommend_product', stage: 'product_discovery', blocks: ['Я б радила {product_name} — {reason}. Ціна {price}. Хочете оформити? 💛'], requiredVariables: ['product_name', 'price'], toneTags: ['warm'], priority: 90 },
      { scenario: 'ask_recommendation_from_shown', stage: 'product_discovery', blocks: ['З цих варіантів я б радила {product_name} — {reason} 💛'], requiredVariables: ['product_name'], toneTags: ['warm'], priority: 90 },
    ];

    for (const t of templates) {
      const entity = manager.create(ResponseTemplate, {
        tenantId,
        scenario: t.scenario,
        stage: t.stage,
        blocks: t.blocks,
        requiredVariables: t.requiredVariables,
        toneTags: t.toneTags,
        priority: t.priority,
        active: true,
      });
      await manager.save(entity);
    }
  }
}
