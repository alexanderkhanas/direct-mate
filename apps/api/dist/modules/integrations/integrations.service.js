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
var IntegrationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const config_1 = require("@nestjs/config");
const typeorm_2 = require("typeorm");
const crypto = require("crypto");
const connection_entity_1 = require("./entities/connection.entity");
const sync_job_entity_1 = require("./entities/sync-job.entity");
const telegram_connect_token_entity_1 = require("../notifications/entities/telegram-connect-token.entity");
const shared_1 = require("@direct-mate/shared");
const crypto_service_1 = require("../../common/crypto.service");
let IntegrationsService = IntegrationsService_1 = class IntegrationsService {
    constructor(connectionRepo, syncJobRepo, connectTokenRepo, crypto, config) {
        this.connectionRepo = connectionRepo;
        this.syncJobRepo = syncJobRepo;
        this.connectTokenRepo = connectTokenRepo;
        this.crypto = crypto;
        this.config = config;
        this.logger = new common_1.Logger(IntegrationsService_1.name);
        this.ALLOWED_PURPOSES = ['create_order', 'sync_catalog', 'sync_stock', 'health_check'];
    }
    async connectInstagram(tenantId, pageId, accessToken, accountName) {
        let finalToken = accessToken;
        let tokenExpiresAt = null;
        try {
            const exchanged = await this.exchangeForLongLivedToken(accessToken);
            finalToken = exchanged.token;
            tokenExpiresAt = exchanged.expiresAt;
            this.logger.log(`Instagram token exchanged: expires ${tokenExpiresAt.toISOString()}`);
        }
        catch (err) {
            this.logger.warn(`Token exchange failed, using original token: ${err.message}`);
        }
        const encrypted = this.crypto.encrypt(finalToken);
        let conn = await this.connectionRepo.findOne({
            where: { tenantId, type: shared_1.ConnectionType.Instagram },
        });
        if (conn) {
            await this.connectionRepo.update(conn.id, {
                externalAccountId: pageId,
                accessTokenEncrypted: encrypted,
                tokenExpiresAt,
                status: shared_1.ConnectionStatus.Connected,
                metadata: accountName ? { accountName } : (conn.metadata ?? null),
            });
            return this.connectionRepo.findOne({ where: { id: conn.id } });
        }
        conn = this.connectionRepo.create({
            tenantId,
            type: shared_1.ConnectionType.Instagram,
            status: shared_1.ConnectionStatus.Connected,
            externalAccountId: pageId,
            accessTokenEncrypted: encrypted,
            tokenExpiresAt,
            metadata: accountName ? { accountName } : null,
        });
        return this.connectionRepo.save(conn);
    }
    async connectShopify(tenantId, shopDomain, accessToken, shopName) {
        let conn = await this.connectionRepo.findOne({
            where: { tenantId, type: shared_1.ConnectionType.Shopify },
        });
        const encrypted = this.crypto.encrypt(accessToken);
        if (conn) {
            await this.connectionRepo.update(conn.id, {
                externalAccountId: shopDomain,
                accessTokenEncrypted: encrypted,
                status: shared_1.ConnectionStatus.Connected,
                metadata: shopName ? { shopName, shopDomain } : { shopDomain },
            });
            return this.connectionRepo.findOne({ where: { id: conn.id } });
        }
        conn = this.connectionRepo.create({
            tenantId,
            type: shared_1.ConnectionType.Shopify,
            status: shared_1.ConnectionStatus.Connected,
            externalAccountId: shopDomain,
            accessTokenEncrypted: encrypted,
            metadata: shopName ? { shopName, shopDomain } : { shopDomain },
        });
        return this.connectionRepo.save(conn);
    }
    async getDecryptedToken(connectionId) {
        const conn = await this.connectionRepo.findOne({ where: { id: connectionId } });
        if (!conn || !conn.accessTokenEncrypted) {
            throw new common_1.NotFoundException('Connection or token not found');
        }
        return this.crypto.decrypt(conn.accessTokenEncrypted);
    }
    async findAll(tenantId) {
        return this.connectionRepo.find({ where: { tenantId } });
    }
    async findByExternalAccountId(externalAccountId, type) {
        return this.connectionRepo.findOne({
            where: { externalAccountId, type, status: shared_1.ConnectionStatus.Connected },
        });
    }
    async disconnect(id) {
        const conn = await this.connectionRepo.findOne({ where: { id } });
        if (!conn)
            throw new common_1.NotFoundException('Connection not found');
        await this.connectionRepo.update(id, {
            status: shared_1.ConnectionStatus.Disconnected,
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
        });
    }
    async remove(id) {
        const conn = await this.connectionRepo.findOne({ where: { id } });
        if (!conn)
            throw new common_1.NotFoundException('Connection not found');
        await this.connectionRepo.delete(id);
    }
    async queueSyncJob(tenantId, connectionId, syncType, mode) {
        const job = this.syncJobRepo.create({
            tenantId,
            connectionId,
            syncType: syncType,
            mode: mode,
        });
        return this.syncJobRepo.save(job);
    }
    async markJobRunning(jobId) {
        await this.syncJobRepo.update(jobId, { status: 'running', startedAt: new Date() });
    }
    async markJobDone(jobId, summary) {
        await this.syncJobRepo.update(jobId, {
            status: 'success',
            finishedAt: new Date(),
            summary,
        });
    }
    async markJobFailed(jobId, error) {
        await this.syncJobRepo.update(jobId, {
            status: 'failed',
            finishedAt: new Date(),
            errorMessage: error,
        });
    }
    async updateJobStatus(jobId, status, summary, errorMessage) {
        const job = await this.syncJobRepo.findOne({ where: { id: jobId } });
        if (!job)
            return;
        if (status === 'success') {
            await this.syncJobRepo.update(jobId, {
                status: 'success',
                finishedAt: new Date(),
                summary: summary ? { text: summary } : null,
            });
            if (job.connectionId) {
                await this.connectionRepo.update(job.connectionId, { lastSyncAt: new Date() });
            }
        }
        else {
            await this.syncJobRepo.update(jobId, {
                status: 'failed',
                finishedAt: new Date(),
                errorMessage: errorMessage ?? null,
            });
        }
    }
    async resolveCredentials(dto) {
        if (!this.ALLOWED_PURPOSES.includes(dto.purpose)) {
            throw new common_1.BadRequestException(`Invalid purpose: ${dto.purpose}`);
        }
        const connection = await this.connectionRepo.findOne({
            where: { id: dto.connectionId },
        });
        if (!connection) {
            throw new common_1.NotFoundException(`Connection ${dto.connectionId} not found`);
        }
        if (connection.tenantId !== dto.tenantId) {
            throw new common_1.ForbiddenException('Connection does not belong to tenant');
        }
        if (connection.type !== dto.platform) {
            throw new common_1.BadRequestException(`Platform mismatch: connection is ${connection.type}, requested ${dto.platform}`);
        }
        if (connection.status !== shared_1.ConnectionStatus.Connected) {
            throw new common_1.BadRequestException(`Connection is not active (status: ${connection.status})`);
        }
        const accessToken = connection.accessTokenEncrypted
            ? this.crypto.decrypt(connection.accessTokenEncrypted)
            : '';
        const metadata = (connection.metadata ?? {});
        if (dto.platform === 'shopify') {
            return {
                type: 'shopify',
                shopDomain: metadata.shopDomain ?? connection.externalAccountId,
                accessToken,
                apiVersion: '2024-07',
            };
        }
        return {
            type: connection.type,
            externalAccountId: connection.externalAccountId,
            accessToken,
            metadata,
        };
    }
    async createOAuthState(tenantId) {
        const token = crypto.randomBytes(16).toString('hex');
        await this.connectTokenRepo.save(this.connectTokenRepo.create({
            tenantId,
            token,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        }));
        return token;
    }
    async validateOAuthState(state) {
        const record = await this.connectTokenRepo.findOne({
            where: { token: state, usedAt: (0, typeorm_2.IsNull)(), expiresAt: (0, typeorm_2.MoreThan)(new Date()) },
        });
        if (!record)
            return null;
        record.usedAt = new Date();
        await this.connectTokenRepo.save(record);
        return record.tenantId;
    }
    async exchangeCodeForToken(code) {
        const appId = this.config.get('meta.appId');
        const appSecret = this.config.get('meta.appSecret');
        const redirectUri = this.config.get('meta.oauthRedirectUri');
        const body = new URLSearchParams({
            client_id: appId ?? '',
            client_secret: appSecret ?? '',
            grant_type: 'authorization_code',
            redirect_uri: redirectUri ?? '',
            code,
        });
        const res = await fetch('https://api.instagram.com/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Code exchange failed: ${res.status} — ${errBody}`);
        }
        const data = await res.json();
        return { accessToken: data.access_token, userId: String(data.user_id) };
    }
    async exchangeForLongLivedToken(shortLivedToken) {
        const appSecret = this.config.get('meta.appSecret');
        if (!appSecret)
            throw new Error('META_APP_SECRET not configured');
        const url = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${shortLivedToken}`;
        const res = await fetch(url);
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Token exchange failed: ${res.status} — ${body}`);
        }
        const data = await res.json();
        return {
            token: data.access_token,
            expiresAt: new Date(Date.now() + data.expires_in * 1000),
        };
    }
    async refreshLongLivedToken(connectionId) {
        const conn = await this.connectionRepo.findOne({ where: { id: connectionId } });
        if (!conn || !conn.accessTokenEncrypted) {
            throw new common_1.NotFoundException('Connection not found or no token');
        }
        const currentToken = this.crypto.decrypt(conn.accessTokenEncrypted);
        const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`;
        const res = await fetch(url);
        if (!res.ok) {
            const body = await res.text();
            this.logger.error(`Token refresh failed for connection ${connectionId}: ${res.status} — ${body}`);
            throw new Error(`Token refresh failed: ${res.status}`);
        }
        const data = await res.json();
        const encrypted = this.crypto.encrypt(data.access_token);
        const tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);
        await this.connectionRepo.update(connectionId, {
            accessTokenEncrypted: encrypted,
            tokenExpiresAt,
        });
        this.logger.log(`Token refreshed for connection ${connectionId}, expires ${tokenExpiresAt.toISOString()}`);
    }
    async refreshExpiringTokens() {
        const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const expiring = await this.connectionRepo.find({
            where: {
                type: shared_1.ConnectionType.Instagram,
                status: shared_1.ConnectionStatus.Connected,
                tokenExpiresAt: (0, typeorm_2.LessThan)(sevenDaysFromNow),
            },
        });
        let refreshed = 0;
        let failed = 0;
        for (const conn of expiring) {
            try {
                await this.refreshLongLivedToken(conn.id);
                refreshed++;
            }
            catch (err) {
                this.logger.error(`Failed to refresh token for connection ${conn.id}`, err.message);
                failed++;
            }
        }
        this.logger.log(`Token refresh: ${refreshed} refreshed, ${failed} failed out of ${expiring.length} expiring`);
        return { refreshed, failed };
    }
};
exports.IntegrationsService = IntegrationsService;
exports.IntegrationsService = IntegrationsService = IntegrationsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(connection_entity_1.Connection)),
    __param(1, (0, typeorm_1.InjectRepository)(sync_job_entity_1.SyncJob)),
    __param(2, (0, typeorm_1.InjectRepository)(telegram_connect_token_entity_1.TelegramConnectToken)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        crypto_service_1.CryptoService,
        config_1.ConfigService])
], IntegrationsService);
//# sourceMappingURL=integrations.service.js.map