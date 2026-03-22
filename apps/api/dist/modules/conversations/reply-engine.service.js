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
var ReplyEngineService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplyEngineService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const config_1 = require("@nestjs/config");
const typeorm_2 = require("typeorm");
const openai_1 = require("openai");
const tenant_settings_entity_1 = require("../tenants/entities/tenant-settings.entity");
const manager_example_entity_1 = require("../settings/entities/manager-example.entity");
const availability_service_1 = require("../availability/availability.service");
const audit_service_1 = require("../audit/audit.service");
const shared_1 = require("@direct-mate/shared");
let ReplyEngineService = ReplyEngineService_1 = class ReplyEngineService {
    constructor(settingsRepo, examplesRepo, availabilityService, auditService, config) {
        this.settingsRepo = settingsRepo;
        this.examplesRepo = examplesRepo;
        this.availabilityService = availabilityService;
        this.auditService = auditService;
        this.config = config;
        this.logger = new common_1.Logger(ReplyEngineService_1.name);
        this.openai = new openai_1.default({ apiKey: this.config.get('openai.apiKey') });
        this.model = this.config.get('openai.model') ?? 'gpt-4o';
    }
    async process(input) {
        const settings = await this.settingsRepo.findOne({
            where: { tenantId: input.tenantId },
        });
        const stockFreshness = settings?.handoffRules?.stockFreshnessMinutes ?? 10;
        const maxFailedTurns = settings?.handoffRules?.maxFailedTurns ?? 2;
        const failedTurns = input.state.contextJson?.failedTurns ?? 0;
        if (failedTurns >= maxFailedTurns) {
            await this.auditService.log({
                tenantId: input.tenantId,
                conversationId: input.conversationId,
                type: shared_1.AuditLogType.Handoff,
                details: { reason: 'max_failed_turns', failedTurns },
            });
            return {
                decision: shared_1.ReplyDecision.Handoff,
                reply: null,
                handoff: { required: true, reason: 'max_failed_turns' },
                stateUpdate: null,
            };
        }
        const examples = await this.examplesRepo.find({
            where: { tenantId: input.tenantId, isActive: true },
            take: 5,
        });
        let availabilityResult;
        if (input.state.selectedProductId &&
            input.state.stateStatus === shared_1.ConversationStateStatus.StockConfirmed) {
            const selectedContext = await this.getSelectedProductContext(input.state.selectedProductId, input.state.selectedVariantId ?? undefined);
            availabilityResult = {
                handoffRequired: false,
                context: selectedContext ?? 'Previously selected product',
                variantId: input.state.selectedVariantId ?? undefined,
                productId: input.state.selectedProductId,
            };
        }
        else {
            availabilityResult = await this.runAvailabilityCheck(input.tenantId, input.conversationId, input.messageText, stockFreshness);
        }
        if (availabilityResult.handoffRequired) {
            return {
                decision: shared_1.ReplyDecision.Handoff,
                reply: null,
                handoff: { required: true, reason: availabilityResult.reason ?? 'stale_data' },
                stateUpdate: null,
            };
        }
        let replyText;
        try {
            replyText = await this.generateReply({
                brandTone: settings?.brandTonePrompt ?? 'Warm and concise, like a professional manager',
                examples,
                messageText: input.messageText,
                recentMessages: input.recentMessages,
                availabilityContext: availabilityResult.context,
                language: settings?.supportedLanguages?.[0] ?? 'uk',
            });
        }
        catch (err) {
            this.logger.error('OpenAI call failed', err);
            await this.auditService.log({
                tenantId: input.tenantId,
                conversationId: input.conversationId,
                type: shared_1.AuditLogType.AiDecision,
                status: shared_1.AuditLogStatus.Failed,
                details: { error: 'openai_failure' },
            });
            return {
                decision: shared_1.ReplyDecision.Handoff,
                reply: null,
                handoff: { required: true, reason: 'ai_failure' },
                stateUpdate: null,
            };
        }
        const stateUpdate = {};
        if (availabilityResult.variantId) {
            stateUpdate.selectedVariantId = availabilityResult.variantId;
            stateUpdate.selectedProductId = availabilityResult.productId ?? undefined;
            stateUpdate.stateStatus = shared_1.ConversationStateStatus.StockConfirmed;
        }
        await this.auditService.log({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            type: shared_1.AuditLogType.AiDecision,
            details: { decision: shared_1.ReplyDecision.Reply },
        });
        return {
            decision: shared_1.ReplyDecision.Reply,
            reply: { text: replyText, sendNow: true },
            handoff: { required: false, reason: null },
            stateUpdate,
        };
    }
    async getSelectedProductContext(productId, variantId) {
        try {
            const result = await this.availabilityService.getByProductId(productId, variantId);
            if (!result)
                return null;
            const parts = [`Customer previously selected: ${result.title}`];
            if (result.variant) {
                parts.push(`Variant: ${[result.variant.size, result.variant.color].filter(Boolean).join(', ')}`);
                parts.push(`Price: ${result.variant.price} ${result.variant.currency}`);
            }
            if (result.stock !== undefined) {
                parts.push(`Stock: ${result.stock} available`);
            }
            parts.push(`Status: customer confirmed interest, proceed with ordering flow`);
            return parts.join('. ');
        }
        catch {
            return null;
        }
    }
    async runAvailabilityCheck(tenantId, conversationId, text, maxFreshnessMinutes) {
        try {
            const result = await this.availabilityService.check(tenantId, { query: text });
            await this.auditService.log({
                tenantId,
                conversationId,
                type: shared_1.AuditLogType.AvailabilityCheck,
                details: {
                    matchType: result.matchType,
                    variantId: result.variant?.id,
                    effectiveAvailable: result.stock?.effectiveAvailable,
                },
            });
            if (result.matchType === 'none') {
                return {
                    handoffRequired: false,
                    context: 'No matching product found',
                };
            }
            if (result.stock && !result.stock.isFresh) {
                return {
                    handoffRequired: true,
                    reason: 'stale_stock_data',
                };
            }
            if (result.stock && result.stock.effectiveAvailable <= 0) {
                return {
                    handoffRequired: false,
                    context: `${result.product?.title} is currently out of stock`,
                };
            }
            return {
                handoffRequired: false,
                context: `${result.product?.title} is available (${result.stock?.effectiveAvailable} units)`,
                variantId: result.variant?.id,
                productId: result.product?.id,
            };
        }
        catch (err) {
            this.logger.error('Availability check failed', err);
            return { handoffRequired: true, reason: 'availability_check_failed' };
        }
    }
    async generateReply(params) {
        const lang = params.language ?? 'uk';
        const langMap = { uk: 'Ukrainian', en: 'English', ru: 'Russian' };
        const langName = langMap[lang] ?? lang;
        const systemParts = [
            `You are a sales assistant for an online store. CRITICAL: You MUST reply ONLY in ${langName}. Never switch to another language regardless of what language the customer uses.`,
            `\nTone and personality:\n${params.brandTone}`,
        ];
        if (params.availabilityContext) {
            systemParts.push(`\nStock context: ${params.availabilityContext}`);
        }
        systemParts.push(`\nRules:\n- Be concise and warm\n- Never invent stock or pricing facts\n- Always respond in ${langName}\n- NEVER say "contact manager", "ask our manager", or reveal you are AI/bot\n- If you don't know something, say you'll check and get back to them\n- Act as the store manager yourself — you ARE the manager`);
        const messages = [
            { role: 'system', content: systemParts.join('\n') },
        ];
        for (const ex of params.examples) {
            messages.push({ role: 'user', content: ex.customerMessage });
            messages.push({ role: 'assistant', content: ex.managerReply });
        }
        for (const msg of params.recentMessages) {
            const role = msg.role === shared_1.MessageRole.User ? 'user' : 'assistant';
            messages.push({ role, content: msg.text ?? '' });
        }
        const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages,
            max_tokens: 300,
            temperature: 0.7,
        });
        return completion.choices[0]?.message?.content?.trim() ?? '';
    }
};
exports.ReplyEngineService = ReplyEngineService;
exports.ReplyEngineService = ReplyEngineService = ReplyEngineService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(tenant_settings_entity_1.TenantSettings)),
    __param(1, (0, typeorm_1.InjectRepository)(manager_example_entity_1.ManagerExample)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        availability_service_1.AvailabilityService,
        audit_service_1.AuditService,
        config_1.ConfigService])
], ReplyEngineService);
//# sourceMappingURL=reply-engine.service.js.map