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
var InstagramOAuthController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstagramOAuthController = exports.InternalConnectionsController = exports.IntegrationsController = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@direct-mate/shared");
const swagger_1 = require("@nestjs/swagger");
const config_1 = require("@nestjs/config");
const class_validator_1 = require("class-validator");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const internal_api_key_guard_1 = require("../../common/guards/internal-api-key.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const integrations_service_1 = require("./integrations.service");
class ConnectInstagramDto {
}
__decorate([
    (0, swagger_1.ApiProperty)({ example: '123456789' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ConnectInstagramDto.prototype, "pageId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'EAABwzLix...' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ConnectInstagramDto.prototype, "accessToken", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'My Store', required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], ConnectInstagramDto.prototype, "accountName", void 0);
class ConnectShopifyDto {
}
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'my-store.myshopify.com' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ConnectShopifyDto.prototype, "shopDomain", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'shpat_xxxxx' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ConnectShopifyDto.prototype, "accessToken", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'My Fashion Store', required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], ConnectShopifyDto.prototype, "shopName", void 0);
let IntegrationsController = class IntegrationsController {
    constructor(integrationsService) {
        this.integrationsService = integrationsService;
    }
    findAll(user) {
        return this.integrationsService.findAll(user.tenantId);
    }
    connectInstagram(user, dto) {
        return this.integrationsService.connectInstagram(user.tenantId, dto.pageId, dto.accessToken, dto.accountName);
    }
    connectShopify(user, dto) {
        return this.integrationsService.connectShopify(user.tenantId, dto.shopDomain, dto.accessToken, dto.shopName);
    }
    disconnect(user, id) {
        return this.integrationsService.disconnect(id, user.tenantId);
    }
    remove(user, id) {
        return this.integrationsService.remove(id, user.tenantId);
    }
};
exports.IntegrationsController = IntegrationsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], IntegrationsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)('instagram'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ConnectInstagramDto]),
    __metadata("design:returntype", void 0)
], IntegrationsController.prototype, "connectInstagram", null);
__decorate([
    (0, common_1.Post)('shopify'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, ConnectShopifyDto]),
    __metadata("design:returntype", void 0)
], IntegrationsController.prototype, "connectShopify", null);
__decorate([
    (0, common_1.Post)(':id/disconnect'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], IntegrationsController.prototype, "disconnect", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], IntegrationsController.prototype, "remove", null);
exports.IntegrationsController = IntegrationsController = __decorate([
    (0, swagger_1.ApiTags)('connections'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('connections'),
    __metadata("design:paramtypes", [integrations_service_1.IntegrationsService])
], IntegrationsController);
class ResolveCredentialsDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ResolveCredentialsDto.prototype, "connectionId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ResolveCredentialsDto.prototype, "tenantId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ResolveCredentialsDto.prototype, "platform", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ResolveCredentialsDto.prototype, "purpose", void 0);
let InternalConnectionsController = class InternalConnectionsController {
    constructor(integrationsService) {
        this.integrationsService = integrationsService;
    }
    async resolveCredentials(dto) {
        return this.integrationsService.resolveCredentials(dto);
    }
    async listShopifyConnections() {
        return this.integrationsService.findAllByType(shared_1.ConnectionType.Shopify);
    }
};
exports.InternalConnectionsController = InternalConnectionsController;
__decorate([
    (0, common_1.Post)('resolve-credentials'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ResolveCredentialsDto]),
    __metadata("design:returntype", Promise)
], InternalConnectionsController.prototype, "resolveCredentials", null);
__decorate([
    (0, common_1.Get)('shopify'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], InternalConnectionsController.prototype, "listShopifyConnections", null);
exports.InternalConnectionsController = InternalConnectionsController = __decorate([
    (0, swagger_1.ApiTags)('internal/connections'),
    (0, common_1.UseGuards)(internal_api_key_guard_1.InternalApiKeyGuard),
    (0, common_1.Controller)('internal/connections'),
    __metadata("design:paramtypes", [integrations_service_1.IntegrationsService])
], InternalConnectionsController);
let InstagramOAuthController = InstagramOAuthController_1 = class InstagramOAuthController {
    constructor(integrationsService, config) {
        this.integrationsService = integrationsService;
        this.config = config;
        this.logger = new common_1.Logger(InstagramOAuthController_1.name);
    }
    async start(user) {
        const appId = this.config.get('meta.appId');
        const redirectUri = this.config.get('meta.oauthRedirectUri');
        if (!appId || !redirectUri) {
            throw new common_1.BadRequestException('Instagram OAuth not configured');
        }
        const state = await this.integrationsService.createOAuthState(user.tenantId);
        const scopes = [
            'instagram_business_basic',
            'instagram_business_manage_messages',
            'instagram_business_content_publish',
            'instagram_business_manage_comments',
        ].join(',');
        const redirectUrl = `https://www.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code&state=${state}`;
        return { redirectUrl };
    }
    async callback(code, state, res) {
        const adminBaseUrl = this.config.get('admin.baseUrl') ?? 'http://localhost:5173';
        if (!code || !state) {
            return res.redirect(`${adminBaseUrl}/connections?instagram=error&reason=missing_params`);
        }
        try {
            const tenantId = await this.integrationsService.validateOAuthState(state);
            if (!tenantId) {
                return res.redirect(`${adminBaseUrl}/connections?instagram=error&reason=invalid_state`);
            }
            const { accessToken, userId } = await this.integrationsService.exchangeCodeForToken(code);
            let businessAccountId = userId;
            let username;
            try {
                const profileRes = await fetch(`https://graph.instagram.com/me?fields=user_id,username&access_token=${accessToken}`);
                if (profileRes.ok) {
                    const profile = await profileRes.json();
                    if (profile.user_id)
                        businessAccountId = String(profile.user_id);
                    username = profile.username;
                }
            }
            catch { }
            await this.integrationsService.connectInstagram(tenantId, businessAccountId, accessToken, username);
            this.logger.log(`Instagram OAuth connected for tenant ${tenantId}, user ${userId}`);
            return res.redirect(`${adminBaseUrl}/connections?instagram=connected`);
        }
        catch (err) {
            this.logger.error('Instagram OAuth callback failed', err.message);
            return res.redirect(`${adminBaseUrl}/connections?instagram=error&reason=exchange_failed`);
        }
    }
};
exports.InstagramOAuthController = InstagramOAuthController;
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Post)('connections/instagram/oauth/start'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InstagramOAuthController.prototype, "start", null);
__decorate([
    (0, common_1.Get)('auth/instagram/callback'),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('state')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], InstagramOAuthController.prototype, "callback", null);
exports.InstagramOAuthController = InstagramOAuthController = InstagramOAuthController_1 = __decorate([
    (0, swagger_1.ApiTags)('connections'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [integrations_service_1.IntegrationsService,
        config_1.ConfigService])
], InstagramOAuthController);
//# sourceMappingURL=integrations.controller.js.map