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
const fs = require("fs");
const path = require("path");
const tenant_settings_entity_1 = require("../tenants/entities/tenant-settings.entity");
const manager_example_entity_1 = require("../settings/entities/manager-example.entity");
const availability_service_1 = require("../availability/availability.service");
const audit_service_1 = require("../audit/audit.service");
const shared_1 = require("@direct-mate/shared");
const PLAN_AND_REPLY_TOOL = {
    type: 'function',
    function: {
        name: 'plan_and_reply',
        description: 'Analyze the conversation context, plan the next action, and generate a reply',
        parameters: {
            type: 'object',
            properties: {
                intent: {
                    type: 'string',
                    enum: [
                        'greeting', 'product_inquiry', 'category_browse', 'availability_check',
                        'price_inquiry', 'order_intent', 'order_details', 'delivery_question',
                        'payment_question', 'general_question', 'complaint', 'thanks', 'unknown',
                    ],
                },
                dialogue_act: {
                    type: 'string',
                    enum: [
                        'new_inquiry',
                        'ask_recommendation',
                        'confirm_choice',
                        'provide_details',
                        'ask_about_shown_products',
                        'short_contextual_reply',
                        'clarification',
                        'general_chat',
                    ],
                    description: 'What the user is actually doing in the conversation context. "short_contextual_reply" = user gave a brief answer to the bot\'s previous question. "ask_recommendation" = user wants the bot to suggest from already shown options. "confirm_choice" = user is saying yes/agreeing.',
                },
                dialogue_state: {
                    type: 'string',
                    enum: [
                        'idle',
                        'product_category_selected',
                        'product_list_shown',
                        'waiting_for_choice',
                        'product_selected',
                        'checkout_started',
                        'collecting_delivery_info',
                    ],
                    description: 'The current state of the conversation AFTER processing this message.',
                },
                product_keywords: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Product names/categories to search in the database. Include the customer\'s original term AND closest matching categories from the available list. Empty only for non-product intents.',
                },
                next_action: {
                    type: 'string',
                    enum: [
                        'search_products',
                        'present_options',
                        'recommend_from_shown',
                        'confirm_selection',
                        'start_checkout',
                        'ask_delivery_details',
                        'answer_question',
                        'greet',
                        'clarify',
                        'handoff',
                    ],
                    description: 'What the bot should do next.',
                },
                needs_handoff: {
                    type: 'boolean',
                    description: 'True ONLY for truly impossible requests (complex complaints, refunds, completely outside scope). False for everything else.',
                },
                handoff_reason: { type: 'string', nullable: true },
                reply: {
                    type: 'string',
                    description: 'The reply to send to the customer. Must follow the conversation flow rules.',
                },
            },
            required: [
                'intent', 'dialogue_act', 'dialogue_state', 'product_keywords',
                'next_action', 'needs_handoff', 'reply',
            ],
        },
    },
};
const LOG_FILE = path.join(process.cwd(), 'conversations.log');
let ReplyEngineService = ReplyEngineService_1 = class ReplyEngineService {
    logToFile(entry) {
        const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
        fs.appendFile(LOG_FILE, line, () => { });
    }
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
        const memory = input.state.contextJson ?? {};
        const maxFailedTurns = settings?.handoffRules?.maxFailedTurns ?? 5;
        if ((memory.failedTurns ?? 0) >= maxFailedTurns) {
            return this.doHandoff(input, 'max_failed_turns');
        }
        const [examples, categories] = await Promise.all([
            this.examplesRepo.find({ where: { tenantId: input.tenantId, isActive: true }, take: 10 }),
            this.availabilityService.getCategories(input.tenantId),
        ]);
        let plan;
        try {
            plan = await this.planResponse({
                brandTone: settings?.brandTonePrompt ?? '',
                examples,
                messageText: input.messageText,
                recentMessages: input.recentMessages,
                memory,
                categories,
                language: settings?.supportedLanguages?.[0] ?? 'uk',
            });
        }
        catch (err) {
            this.logger.error('AI plan failed', err);
            return this.doHandoff(input, 'ai_failure');
        }
        this.logger.log(`Plan: intent=${plan.intent} act=${plan.dialogue_act} state=${plan.dialogue_state} action=${plan.next_action} keywords=[${plan.product_keywords.join(',')}] handoff=${plan.needs_handoff}`);
        this.logToFile({
            event: 'plan',
            conversationId: input.conversationId,
            inbound: input.messageText,
            plan: {
                intent: plan.intent,
                dialogueAct: plan.dialogue_act,
                dialogueState: plan.dialogue_state,
                nextAction: plan.next_action,
                keywords: plan.product_keywords,
                handoff: plan.needs_handoff,
            },
            memory,
        });
        if (plan.needs_handoff) {
            const fallbackModel = this.config.get('openai.fallbackModel');
            if (fallbackModel) {
                try {
                    const secondOpinion = await this.planResponse({
                        brandTone: settings?.brandTonePrompt ?? '',
                        examples,
                        messageText: input.messageText,
                        recentMessages: input.recentMessages,
                        memory,
                        categories,
                        language: settings?.supportedLanguages?.[0] ?? 'uk',
                        modelOverride: fallbackModel,
                    });
                    this.logToFile({
                        event: 'handoff_verification',
                        conversationId: input.conversationId,
                        miniSaysHandoff: true,
                        fallbackSaysHandoff: secondOpinion.needs_handoff,
                        fallbackReply: secondOpinion.reply,
                    });
                    if (!secondOpinion.needs_handoff) {
                        this.logger.log(`Fallback model overrode handoff`);
                        plan = secondOpinion;
                    }
                }
                catch {
                    this.logger.warn('Fallback verification failed');
                }
            }
        }
        if (plan.needs_handoff) {
            return this.doHandoff(input, plan.handoff_reason ?? plan.intent);
        }
        const stateUpdate = {};
        let finalReply = plan.reply;
        const needsSearch = plan.next_action === 'search_products' && plan.product_keywords.length > 0;
        if (needsSearch) {
            const searchResult = await this.searchProducts(input.tenantId, input.conversationId, plan.product_keywords);
            this.logToFile({
                event: 'product_search',
                conversationId: input.conversationId,
                keywords: plan.product_keywords,
                found: searchResult.found,
                products: searchResult.presentedProducts?.map((p) => p.title),
            });
            if (searchResult.found) {
                try {
                    const enriched = await this.planResponse({
                        brandTone: settings?.brandTonePrompt ?? '',
                        examples,
                        messageText: input.messageText,
                        recentMessages: input.recentMessages,
                        memory,
                        categories,
                        language: settings?.supportedLanguages?.[0] ?? 'uk',
                        productContext: searchResult.context,
                    });
                    finalReply = enriched.reply;
                    plan.dialogue_state = enriched.dialogue_state;
                    plan.next_action = enriched.next_action;
                }
                catch { }
                stateUpdate.selectedVariantId = searchResult.variantId;
                stateUpdate.selectedProductId = searchResult.productId;
                memory.lastAction = 'presented_product_options';
                memory.lastPresentedProducts = searchResult.presentedProducts;
                memory.awaitingField = 'product_choice_or_recommendation_request';
                memory.selectedCategory = plan.product_keywords[0];
            }
        }
        const stateMap = {
            'product_list_shown': shared_1.ConversationStateStatus.StockConfirmed,
            'waiting_for_choice': shared_1.ConversationStateStatus.StockConfirmed,
            'product_selected': shared_1.ConversationStateStatus.StockConfirmed,
            'checkout_started': shared_1.ConversationStateStatus.CollectingCustomerInfo,
            'collecting_delivery_info': shared_1.ConversationStateStatus.CollectingCustomerInfo,
        };
        const mappedStatus = stateMap[plan.dialogue_state];
        if (mappedStatus) {
            stateUpdate.stateStatus = mappedStatus;
        }
        if (plan.next_action === 'recommend_from_shown') {
            memory.lastAction = 'gave_recommendation';
            memory.awaitingField = 'product_choice';
        }
        else if (plan.next_action === 'confirm_selection') {
            memory.lastAction = 'confirmed_product';
            memory.awaitingField = 'order_confirmation';
        }
        else if (plan.next_action === 'ask_delivery_details') {
            memory.lastAction = 'asked_delivery_details';
            memory.awaitingField = 'delivery_info';
        }
        else if (plan.next_action === 'greet') {
            memory.lastAction = 'greeted';
            memory.awaitingField = 'product_inquiry';
        }
        stateUpdate.contextJson = memory;
        await this.auditService.log({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            type: shared_1.AuditLogType.AiDecision,
            details: {
                decision: shared_1.ReplyDecision.Reply,
                intent: plan.intent,
                dialogueAct: plan.dialogue_act,
                nextAction: plan.next_action,
            },
        });
        this.logToFile({
            event: 'reply',
            conversationId: input.conversationId,
            inbound: input.messageText,
            outbound: finalReply,
            dialogueState: plan.dialogue_state,
            nextAction: plan.next_action,
            memory,
        });
        return {
            decision: shared_1.ReplyDecision.Reply,
            reply: { text: finalReply, sendNow: true },
            handoff: { required: false, reason: null },
            stateUpdate,
        };
    }
    async planResponse(params) {
        const lang = params.language ?? 'uk';
        const langMap = { uk: 'Ukrainian', en: 'English' };
        const langName = langMap[lang] ?? lang;
        const memoryContext = this.buildMemoryContext(params.memory);
        const systemPrompt = [
            `You are a sales manager for an online store. Reply ONLY in ${langName}.`,
            params.brandTone ? `\nTone:\n${params.brandTone}` : '',
            params.productContext
                ? `\nProduct data from database:\n${params.productContext}`
                : '',
            params.categories.length
                ? `\nAvailable categories: ${params.categories.join(', ')}.`
                : '',
            memoryContext ? `\n${memoryContext}` : '',
            `\nCONVERSATION RULES:`,
            `1. NEVER repeat what you already said. Don't re-list products, don't re-describe, don't re-greet.`,
            `2. SHORT REPLIES ("підкажіть", "цей", "рожевий", "так", "добре", "давайте") = interpreted in context of your LAST action.`,
            `3. If you showed options and user asks for recommendation → recommend with a reason. Don't re-ask.`,
            `4. When presenting products: ALWAYS include the price. Be conversational, not tabular.`,
            `5. NEVER say "contact manager", "зараз перевірю ціну" (you already HAVE the price data), or reveal you are AI.`,
            `6. If product not found in database, say you'll check and follow up.`,
            `7. Lead the conversation forward — always give the user a clear next step.`,
            `8. NEVER greet mid-conversation. "Привіт/Вітаю" only at the very start.`,
            ``,
            `PRICING RULE:`,
            `- Product prices are in the "Product data" section and in the ASSISTANT MEMORY "Products shown to customer" section.`,
            `- When user asks about price, answer IMMEDIATELY from this data. NEVER say "зараз перевірю/уточню ціну".`,
            `- Always mention price when presenting or recommending products.`,
            ``,
            `MULTI-PRODUCT ORDERS:`,
            `- If customer is mid-order (collecting delivery info) and asks about ANOTHER product → do NOT reset the order.`,
            `- Say "Звісно! Давайте додамо до замовлення." then recommend the new product.`,
            `- Keep the existing order items in context.`,
            ``,
            `FLOW AFTER RECOMMENDATION:`,
            `- User AGREES ("добре", "так", "давайте") → immediately ask "Оформлюємо замовлення? 💛" Do NOT repeat description.`,
            `- User confirms order → immediately ask for delivery details. Do NOT re-describe.`,
            `- NEVER ask the same question twice.`,
            `\nExtract product_keywords for product-related intents. Include the customer's term AND the closest matching category name(s).`,
            `\nSet next_action to "search_products" ONLY when you need NEW product data not already in memory. If product info is in "Products shown to customer" memory, use it directly.`,
            `\nCall plan_and_reply with your analysis and response.`,
        ].filter(Boolean).join('\n');
        const messages = [
            { role: 'system', content: systemPrompt },
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
            model: params.modelOverride ?? this.model,
            messages,
            tools: [PLAN_AND_REPLY_TOOL],
            tool_choice: { type: 'function', function: { name: 'plan_and_reply' } },
            max_completion_tokens: 600,
            temperature: 0.3,
        });
        const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
        if (!toolCall) {
            return {
                intent: 'unknown', dialogue_act: 'general_chat', dialogue_state: 'idle',
                product_keywords: [], next_action: 'clarify', needs_handoff: false,
                handoff_reason: null,
                reply: completion.choices[0]?.message?.content?.trim() ?? '',
            };
        }
        return JSON.parse(toolCall.function.arguments);
    }
    buildMemoryContext(memory) {
        if (!memory.lastAction)
            return '';
        const parts = [`\nASSISTANT MEMORY (what happened before in this conversation):`];
        parts.push(`Last action: ${memory.lastAction}`);
        if (memory.lastPresentedProducts?.length) {
            parts.push(`Products shown to customer (USE THIS DATA for prices and variants):`);
            for (const p of memory.lastPresentedProducts) {
                const variants = p.variants.join(', ');
                parts.push(`  • ${p.title} — Price: ${p.price} — Variants: ${variants}`);
            }
        }
        if (memory.orderItems?.length) {
            parts.push(`Current order items:`);
            for (const item of memory.orderItems) {
                parts.push(`  • ${item}`);
            }
        }
        if (memory.awaitingField) {
            parts.push(`Currently waiting for: ${memory.awaitingField}`);
        }
        if (memory.selectedCategory) {
            parts.push(`Selected category: ${memory.selectedCategory}`);
        }
        return parts.join('\n');
    }
    async searchProducts(tenantId, conversationId, keywords) {
        for (const keyword of keywords) {
            const results = await this.availabilityService.checkAll(tenantId, { query: keyword });
            await this.auditService.log({
                tenantId, conversationId,
                type: shared_1.AuditLogType.AvailabilityCheck,
                details: { keyword, productsFound: results.length },
            });
            if (results.length > 0) {
                const contextParts = [];
                const presentedProducts = [];
                for (const r of results) {
                    const variantDescs = [];
                    const variantNames = [];
                    for (const v of r.variants) {
                        const details = [v.size, v.color].filter(Boolean).join(', ');
                        const stock = v.effectiveAvailable > 0 ? 'в наявності' : 'немає';
                        variantDescs.push(`${details || 'standard'}: ${v.price} ${v.currency} (${stock})`);
                        variantNames.push(details || 'standard');
                    }
                    contextParts.push(`- ${r.product.title}: ${variantDescs.join('; ')}`);
                    const prices = [...new Set(r.variants.map((v) => `${v.price} ${v.currency}`))];
                    presentedProducts.push({
                        title: r.product.title,
                        variants: variantNames,
                        price: prices.join(' / '),
                    });
                }
                const firstResult = results[0];
                const firstInStock = firstResult.variants.find((v) => v.effectiveAvailable > 0);
                return {
                    found: true,
                    context: `Products found:\n${contextParts.join('\n')}`,
                    variantId: firstInStock?.id ?? firstResult.variants[0]?.id,
                    productId: firstResult.product.id,
                    presentedProducts,
                };
            }
        }
        return { found: false };
    }
    async doHandoff(input, reason) {
        await this.auditService.log({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            type: shared_1.AuditLogType.Handoff,
            details: { reason },
        });
        this.logToFile({
            event: 'handoff',
            conversationId: input.conversationId,
            inbound: input.messageText,
            reason,
        });
        return {
            decision: shared_1.ReplyDecision.Handoff,
            reply: null,
            handoff: { required: true, reason },
            stateUpdate: null,
        };
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