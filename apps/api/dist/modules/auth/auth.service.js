"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const bcrypt = require("bcrypt");
const shared_1 = require("@direct-mate/shared");
const user_entity_1 = require("../tenants/entities/user.entity");
const tenant_entity_1 = require("../tenants/entities/tenant.entity");
const tenant_settings_entity_1 = require("../tenants/entities/tenant-settings.entity");
const store_config_entity_1 = require("../engine/entities/store-config.entity");
const response_template_entity_1 = require("../engine/entities/response-template.entity");
let AuthService = class AuthService {
    constructor(userRepo, jwtService, dataSource) {
        this.userRepo = userRepo;
        this.jwtService = jwtService;
        this.dataSource = dataSource;
    }
    async login(dto) {
        const user = await this.userRepo.findOne({
            where: { email: dto.email, isActive: true },
        });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const valid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!valid)
            throw new common_1.UnauthorizedException('Invalid credentials');
        const payload = {
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
    async me(userId) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return user;
    }
    async register(dto) {
        const existingUser = await this.userRepo.findOne({ where: { email: dto.email } });
        if (existingUser)
            throw new common_1.ConflictException('Email already registered');
        let slug = this.slugify(dto.storeName);
        return this.dataSource.transaction(async (manager) => {
            for (let attempt = 0; attempt < 3; attempt++) {
                const existing = await manager.findOne(tenant_entity_1.Tenant, { where: { slug } });
                if (!existing)
                    break;
                slug = this.slugify(dto.storeName) + '-' + this.randomSuffix();
            }
            const tenant = manager.create(tenant_entity_1.Tenant, {
                name: dto.storeName,
                slug,
                businessType: dto.businessType,
                timezone: 'Europe/Kyiv',
                isActive: true,
            });
            const savedTenant = await manager.save(tenant);
            const passwordHash = await bcrypt.hash(dto.password, 10);
            const user = manager.create(user_entity_1.User, {
                tenantId: savedTenant.id,
                email: dto.email,
                passwordHash,
                role: shared_1.UserRole.Owner,
                isActive: true,
            });
            const savedUser = await manager.save(user);
            const settings = manager.create(tenant_settings_entity_1.TenantSettings, {
                tenantId: savedTenant.id,
                supportedLanguages: ['uk'],
                brandTonePrompt: 'Warm, friendly, concise. Use Ukrainian. Never reveal you are AI.',
            });
            await manager.save(settings);
            const storeConfig = manager.create(store_config_entity_1.StoreConfig, {
                tenantId: savedTenant.id,
            });
            await manager.save(storeConfig);
            await this.createDefaultTemplates(manager, savedTenant.id);
            const payload = {
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
    slugify(name) {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9а-яіїєґ\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .slice(0, 50);
    }
    randomSuffix() {
        return Math.random().toString(36).substring(2, 6);
    }
    async createDefaultTemplates(manager, tenantId) {
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
            const entity = manager.create(response_template_entity_1.ResponseTemplate, {
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
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        jwt_1.JwtService,
        typeorm_2.DataSource])
], AuthService);
//# sourceMappingURL=auth.service.js.map