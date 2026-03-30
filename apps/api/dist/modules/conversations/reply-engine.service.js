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
const store_config_entity_1 = require("../engine/entities/store-config.entity");
const availability_service_1 = require("../availability/availability.service");
const audit_service_1 = require("../audit/audit.service");
const classifier_service_1 = require("../engine/classifier.service");
const template_engine_service_1 = require("../engine/template-engine.service");
const policy_engine_service_1 = require("../engine/policy-engine.service");
const shared_1 = require("@direct-mate/shared");
const instagram_content_service_1 = require("../channels/instagram/instagram-content.service");
const LOG_FILE = path.join(process.cwd(), 'conversations.log');
let ReplyEngineService = ReplyEngineService_1 = class ReplyEngineService {
    logToFile(entry) {
        const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
        fs.appendFile(LOG_FILE, line, () => { });
    }
    constructor(settingsRepo, examplesRepo, storeConfigRepo, availabilityService, auditService, classifierService, templateEngine, policyEngine, config, instagramContentService) {
        this.settingsRepo = settingsRepo;
        this.examplesRepo = examplesRepo;
        this.storeConfigRepo = storeConfigRepo;
        this.availabilityService = availabilityService;
        this.auditService = auditService;
        this.classifierService = classifierService;
        this.templateEngine = templateEngine;
        this.policyEngine = policyEngine;
        this.config = config;
        this.instagramContentService = instagramContentService;
        this.logger = new common_1.Logger(ReplyEngineService_1.name);
        this.openai = new openai_1.default({
            apiKey: this.config.get('openai.apiKey'),
        });
        this.model = this.config.get('openai.model') ?? 'gpt-4o';
    }
    async process(input) {
        const [settings, storeConfig, examples, categories] = await Promise.all([
            this.settingsRepo.findOne({ where: { tenantId: input.tenantId } }),
            this.storeConfigRepo.findOne({ where: { tenantId: input.tenantId } }),
            this.examplesRepo.find({
                where: { tenantId: input.tenantId, isActive: true },
                take: 10,
            }),
            this.availabilityService.getCategories(input.tenantId),
        ]);
        const memory = input.state.contextJson ?? {};
        const maxFailedTurns = settings?.handoffRules?.maxFailedTurns ?? 5;
        if ((memory.failedTurns ?? 0) >= maxFailedTurns) {
            return this.doHandoff(input, 'max_failed_turns');
        }
        const effectiveConfig = storeConfig ??
            {
                escalationConfig: {},
                fallbackConfig: {
                    mode: 'template_first_with_safe_fallback',
                },
                brandConfig: {},
            };
        let classification;
        try {
            classification = await this.classifierService.classify({
                messageText: input.messageText,
                recentMessages: input.recentMessages,
                memory,
                categories,
                currentStage: this.getCurrentStage(input.state),
            });
        }
        catch (err) {
            this.logger.error('AI classification failed', err);
            return this.doHandoff(input, 'ai_failure');
        }
        this.resolveShortReply(classification, memory, input.messageText);
        this.logger.log(`Classification: intent=${classification.primaryIntent} stage=${classification.conversationStage} ` +
            `action=${classification.recommendedAction} confidence=${classification.confidence} sentiment=${classification.sentiment}`);
        this.logToFile({
            event: 'classification',
            conversationId: input.conversationId,
            inbound: input.messageText,
            classification: {
                intent: classification.primaryIntent,
                entities: classification.entities,
                stage: classification.conversationStage,
                sentiment: classification.sentiment,
                confidence: classification.confidence,
                dialogueAct: classification.dialogueAct,
                action: classification.recommendedAction,
                slotAction: classification.slotAction,
            },
            memory,
        });
        const policy = this.policyEngine.evaluate({
            classification,
            storeConfig: effectiveConfig,
            state: {
                failedTurns: memory.failedTurns ?? 0,
                maxFailedTurns,
            },
        });
        if (policy.action === 'escalate') {
            const fallbackModel = this.config.get('openai.fallbackModel');
            if (fallbackModel) {
                try {
                    const secondOpinion = await this.classifierService.classifyWithFallback({
                        messageText: input.messageText,
                        recentMessages: input.recentMessages,
                        memory,
                        categories,
                        currentStage: this.getCurrentStage(input.state),
                    });
                    this.logToFile({
                        event: 'handoff_verification',
                        conversationId: input.conversationId,
                        primarySaysEscalate: true,
                        fallbackIntent: secondOpinion.primaryIntent,
                        fallbackAction: secondOpinion.recommendedAction,
                        fallbackConfidence: secondOpinion.confidence,
                    });
                    const fallbackPolicy = this.policyEngine.evaluate({
                        classification: secondOpinion,
                        storeConfig: effectiveConfig,
                        state: {
                            failedTurns: memory.failedTurns ?? 0,
                            maxFailedTurns,
                        },
                    });
                    if (fallbackPolicy.action !== 'escalate') {
                        this.logger.log(`Fallback model overrode escalation`);
                        classification = secondOpinion;
                    }
                    else {
                        return this.doHandoff(input, policy.reason ?? 'policy_escalation');
                    }
                }
                catch {
                    this.logger.warn('Fallback verification failed');
                    return this.doHandoff(input, policy.reason ?? 'policy_escalation');
                }
            }
            else {
                return this.doHandoff(input, policy.reason ?? 'policy_escalation');
            }
        }
        const POST_ORDER_PASSIVE_INTENTS = ['gratitude', 'thanks', 'small_talk', 'confirmation', 'goodbye'];
        if (memory.orderCreated) {
            if (POST_ORDER_PASSIVE_INTENTS.includes(classification.primaryIntent)) {
                this.logger.log('Post-order passive intent: ' + classification.primaryIntent);
                const ackReply = 'Будь ласка 💛 Якщо захочете ще щось — пишіть!';
                const stateUpdate = {};
                stateUpdate.contextJson = memory;
                return {
                    decision: shared_1.ReplyDecision.Reply,
                    reply: { text: ackReply, sendNow: true },
                    handoff: { required: false, reason: null },
                    stateUpdate,
                };
            }
            if (classification.slotAction === 'new_inquiry' ||
                ['product_inquiry', 'ready_to_order', 'category_browse', 'greeting'].includes(classification.primaryIntent)) {
                memory.selectedProductId = undefined;
                memory.selectedProductTitle = undefined;
                memory.selectedVariantId = undefined;
                memory.selectedVariantName = undefined;
                memory.selectionState = undefined;
                memory.lastPresentedProducts = undefined;
                memory.availableVariants = undefined;
                memory.lastAction = undefined;
                memory.awaitingField = undefined;
                memory.orderCreated = undefined;
                this.logger.log('State reset: new inquiry after completed order');
            }
        }
        let mediaProductData;
        if (input.mediaReference) {
            if (input.mediaReference.type === 'customer_photo') {
                return this.doHandoff(input, 'customer_photo', 'Секунду, зараз перевірю 💛');
            }
            const mapping = await this.instagramContentService.findByMediaId(input.tenantId, input.mediaReference.mediaId);
            if (mapping?.productId) {
                mediaProductData = await this.availabilityService.findAllByProductId(mapping.productId, mapping.variantId ?? undefined);
                this.logToFile({
                    event: 'media_product_resolved',
                    conversationId: input.conversationId,
                    mediaId: input.mediaReference.mediaId,
                    mediaType: input.mediaReference.type,
                    productId: mapping.productId,
                    variantId: mapping.variantId,
                    productsFound: mediaProductData.length,
                });
            }
            else {
                this.instagramContentService
                    .saveUnlinkedMedia(input.tenantId, input.mediaReference.mediaId, input.mediaReference.type)
                    .catch((err) => this.logger.error('Failed to save unlinked media', err));
                return this.doHandoff(input, 'unlinked_media_reference', 'Секунду, зараз перевірю 💛');
            }
        }
        let productData;
        let isFirstProductPresentation = false;
        if (mediaProductData && mediaProductData.length > 0) {
            productData = mediaProductData;
            isFirstProductPresentation = !memory.lastPresentedProducts?.length;
        }
        const needsSearch = !productData && this.shouldSearchProducts(classification, memory);
        if (needsSearch) {
            const searchKeywords = this.extractSearchKeywords(classification);
            productData = await this.searchProducts(input.tenantId, input.conversationId, searchKeywords);
            this.logToFile({
                event: 'product_search',
                conversationId: input.conversationId,
                keywords: searchKeywords,
                found: productData ? productData.length : 0,
            });
            if ((!productData || productData.length === 0) &&
                ['product_inquiry', 'ready_to_order', 'availability_check', 'category_browse'].includes(classification.primaryIntent)) {
                this.logger.log('Product not found — using product_not_found template + handoff');
                classification.recommendedAction = 'product_not_found';
                const pnfResult = await this.templateEngine.render({
                    tenantId: input.tenantId,
                    classification,
                    memory,
                    recentTemplateIds: memory.recentTemplateIds ?? [],
                    messageText: input.messageText,
                });
                const softMessage = pnfResult?.text ?? 'Секунду, уточню наявність 💛';
                return this.doHandoff(input, 'product_not_found', softMessage);
            }
            if (productData && productData.length > 0) {
                isFirstProductPresentation = !memory.lastPresentedProducts?.length;
                memory.lastPresentedProducts = productData.map((p) => ({
                    title: p.product.title,
                    variants: [...new Set(p.variants.map((v) => [...new Set([v.size, v.color].filter(Boolean))].join(', ') || 'standard'))],
                    price: [
                        ...new Set(p.variants.map((v) => `${v.price} ${v.currency}`)),
                    ].join(' / '),
                }));
                memory.selectedCategory =
                    classification.entities.category ?? searchKeywords[0];
                if (productData.length === 1) {
                    memory.availableVariants = productData[0].variants
                        .filter((v) => v.effectiveAvailable > 0)
                        .map((v) => [v.color, v.size].filter(Boolean).join(', '))
                        .filter(Boolean)
                        .join(', ');
                    memory.selectedProductId = productData[0].product.id;
                    memory.selectedProductTitle = productData[0].product.title;
                }
                if (isFirstProductPresentation) {
                    memory.selectionState = 'awaiting_product';
                }
            }
        }
        this.logger.log(`5.5a check: slotAction=${classification.slotAction} selState=${memory.selectionState} prodId=${!!memory.selectedProductId} varId=${!!memory.selectedVariantId}`);
        if (classification.slotAction === 'confirmation' &&
            memory.selectionState === 'awaiting_confirmation' &&
            memory.selectedProductId &&
            memory.selectedVariantId) {
            memory.selectionState = 'confirmed';
            classification.primaryIntent = 'ready_to_order';
            classification.recommendedAction = 'start_checkout';
            classification.conversationStage = 'checkout_started';
            this.logger.log('5.5a FIRED: Selection fully confirmed, proceeding to checkout');
            this.logToFile({
                event: 'selection_confirmed',
                conversationId: input.conversationId,
                selectionState: memory.selectionState,
                selectedProductId: memory.selectedProductId,
                selectedVariantId: memory.selectedVariantId,
                action: 'start_checkout',
            });
        }
        if (classification.slotAction === 'confirmation' &&
            memory.selectionState === 'awaiting_confirmation' &&
            memory.selectedProductId &&
            !memory.selectedVariantId) {
            const rawVariants = memory.availableVariants;
            const variants = Array.isArray(rawVariants) ? rawVariants : [];
            const userColor = classification.entities.color;
            const userSize = classification.entities.size;
            if (variants.length === 1) {
                memory.selectedVariantId = variants[0].id;
                memory.selectedVariantName = variants[0].name;
                memory.selectionState = 'awaiting_confirmation';
                classification.recommendedAction = 'confirm_selection';
                this.logger.log('Single variant → auto-selected, proceeding to confirm_selection');
            }
            else if (variants.length > 1 && (userColor || userSize)) {
                const matched = this.matchVariant(variants, userColor, userSize);
                if (matched) {
                    memory.selectedVariantId = matched.id;
                    memory.selectedVariantName = matched.name;
                    memory.selectionState = 'awaiting_confirmation';
                    classification.recommendedAction = 'confirm_selection';
                    this.logger.log(`Variant matched: ${matched.name}`);
                }
                else {
                    memory.selectionState = 'awaiting_variant';
                    classification.primaryIntent = 'ask_variant_choice';
                    classification.recommendedAction = 'ask_variant_choice';
                    this.logger.log('Variant not matched confidently, asking user');
                }
            }
            else if (variants.length > 1) {
                memory.selectionState = 'awaiting_variant';
                classification.primaryIntent = 'ask_variant_choice';
                classification.recommendedAction = 'ask_variant_choice';
                this.logger.log(`Multiple variants (${variants.length}), asking user to choose`);
            }
        }
        if (classification.slotAction === 'fills_missing_slot' &&
            memory.selectedProductId &&
            !memory.selectedVariantId &&
            productData && productData.length === 1) {
            const variants = productData[0].variants.filter(v => v.effectiveAvailable > 0);
            if (variants.length > 1) {
                const userColor = classification.entities.color;
                const userSize = classification.entities.size;
                if (userColor || userSize) {
                    const matched = this.matchVariant(variants.map(v => ({ id: v.id, name: [...new Set([v.color, v.size].filter(Boolean))].join(', '), color: v.color, size: v.size })), userColor, userSize);
                    if (matched) {
                        memory.selectedVariantId = matched.id;
                        memory.selectedVariantName = matched.name;
                        memory.selectionState = 'awaiting_confirmation';
                        classification.recommendedAction = 'confirm_selection';
                    }
                    else {
                        memory.selectionState = 'awaiting_variant';
                        classification.primaryIntent = 'ask_variant_choice';
                        classification.recommendedAction = 'ask_variant_choice';
                    }
                }
                else {
                    memory.selectionState = 'awaiting_variant';
                    memory.availableVariants = variants.map(v => ({
                        id: v.id,
                        name: [...new Set([v.color, v.size].filter(Boolean))].join(', ') || 'standard',
                        color: v.color,
                        size: v.size,
                    }));
                    classification.primaryIntent = 'ask_variant_choice';
                    classification.recommendedAction = 'ask_variant_choice';
                    this.logger.log(`5.5c: Product selected, ${variants.length} variants — asking user`);
                }
            }
            else if (variants.length === 1) {
                memory.selectedVariantId = variants[0].id;
                memory.selectedVariantName = [...new Set([variants[0].color, variants[0].size].filter(Boolean))].join(', ') || 'standard';
                memory.selectionState = 'awaiting_confirmation';
                classification.recommendedAction = 'confirm_selection';
            }
        }
        const recentTemplateIds = memory.recentTemplateIds ?? [];
        const templateResult = await this.templateEngine.render({
            tenantId: input.tenantId,
            classification,
            productData,
            memory,
            recentTemplateIds,
            isFirstProductPresentation,
            messageText: input.messageText,
        });
        let finalReply;
        let usedTemplateId;
        let actualAction;
        if (templateResult) {
            finalReply = templateResult.text;
            usedTemplateId = templateResult.templateId;
            actualAction = this.scenarioToAction(templateResult.scenario);
            const classifierAction = classification.recommendedAction;
            if (actualAction !== classifierAction) {
                const reason = !memory.selectedProductId ? 'checkout_blocked_no_product'
                    : !memory.selectedVariantId ? 'missing_variant_selection'
                        : memory.selectionState !== 'confirmed' ? 'selection_not_confirmed'
                            : classification.slotAction === 'correction' ? 'correction_received'
                                : 'stage_gate_override';
                this.logToFile({
                    event: 'flow_override',
                    conversationId: input.conversationId,
                    reason,
                    classifierSaid: classifierAction,
                    engineDid: actualAction,
                    selectionState: memory.selectionState,
                });
            }
            memory.recentTemplateIds = [
                templateResult.templateId,
                ...recentTemplateIds,
            ].slice(0, 10);
            this.logger.log(`Template selected: ${templateResult.templateId}`);
        }
        else {
            const productIntents = ['product_inquiry', 'ready_to_order', 'availability_check', 'category_browse', 'ask_price'];
            if (productIntents.includes(classification.primaryIntent) && (!productData || productData.length === 0)) {
                this.logger.log('No template + no products found for product intent → handoff');
                return this.doHandoff(input, 'product_not_found', 'Секунду, уточню наявність 💛');
            }
            const hasActiveCheckout = !!(memory.selectedProductId &&
                (memory.selectionState === 'confirmed' || memory.lastAction === 'asked_delivery_details'));
            if (classification.primaryIntent === 'provide_details' && !hasActiveCheckout) {
                this.logger.log('Pre-check: provide_details without active checkout → clarification');
                finalReply = 'Дякую 💛 Підкажіть, будь ласка, який товар вас цікавить?';
                actualAction = 'greeting';
            }
            else if (policy.action === 'fallback' ||
                this.policyEngine.isFallbackAllowed(classification, effectiveConfig)) {
                this.logger.log('No template matched, using AI fallback');
                try {
                    finalReply = await this.aiFallbackReply({
                        brandTone: settings?.brandTonePrompt ?? '',
                        examples,
                        messageText: input.messageText,
                        recentMessages: input.recentMessages,
                        memory,
                        categories,
                        language: settings?.supportedLanguages?.[0] ?? 'uk',
                        productData,
                        classification,
                    });
                    actualAction = 'ai_fallback_clarification';
                    if (!hasActiveCheckout) {
                        const orderPhrases = ['замовлення оформлено', 'вже в обробці', 'надішлю підтвердження',
                            'очікуйте відправку', 'замовлення прийнято', 'дані отримала', 'замовлення створено'];
                        const hasOrderLanguage = orderPhrases.some(p => finalReply.toLowerCase().includes(p));
                        if (hasOrderLanguage) {
                            finalReply = 'Дякую 💛 Підкажіть, будь ласка, який товар вас цікавить?';
                            this.logger.warn('Output safety: blocked fake order confirmation from AI fallback');
                        }
                    }
                }
                catch (err) {
                    this.logger.error('AI fallback failed', err);
                    memory.failedTurns = (memory.failedTurns ?? 0) + 1;
                    return this.doHandoff(input, 'ai_fallback_failure');
                }
            }
            else {
                this.logger.log('No template and fallback not allowed, escalating');
                return this.doHandoff(input, 'no_template_strict_mode');
            }
        }
        const stateUpdate = {};
        const stageStatusMap = {
            showing_options: shared_1.ConversationStateStatus.StockConfirmed,
            selection_help: shared_1.ConversationStateStatus.StockConfirmed,
            product_selected: shared_1.ConversationStateStatus.StockConfirmed,
            checkout_started: shared_1.ConversationStateStatus.CollectingCustomerInfo,
            collecting_customer_info: shared_1.ConversationStateStatus.CollectingCustomerInfo,
            order_confirmation: shared_1.ConversationStateStatus.CollectingCustomerInfo,
        };
        const mappedStatus = stageStatusMap[classification.conversationStage];
        if (mappedStatus) {
            stateUpdate.stateStatus = mappedStatus;
        }
        this.updateMemoryFromAction(actualAction, memory, templateResult, classification, productData);
        if (templateResult?.matchedVariantId) {
            memory.selectedVariantId = templateResult.matchedVariantId;
            memory.selectedVariantName = classification.entities.color ?? classification.entities.size ?? memory.selectedVariantName;
        }
        if (productData && productData.length > 0) {
            const first = productData[0];
            stateUpdate.selectedProductId = first.product.id;
            memory.selectedProductId = first.product.id;
            memory.selectedProductTitle = memory.selectedProductTitle || first.product.title;
            const inStockVariant = first.variants.find((v) => v.effectiveAvailable > 0);
            stateUpdate.selectedVariantId =
                inStockVariant?.id ?? first.variants[0]?.id;
        }
        stateUpdate.contextJson = memory;
        const alreadyOrdered = memory.orderCreated === true;
        if (actualAction === 'confirm_order' && !alreadyOrdered) {
            memory.orderCreated = true;
            const orderPayload = this.buildOrderPayload(input, memory, classification);
            await this.auditService.log({
                tenantId: input.tenantId,
                conversationId: input.conversationId,
                type: shared_1.AuditLogType.DraftOrderCreated,
                details: {
                    decision: shared_1.ReplyDecision.CreateDraftOrder,
                    intent: classification.primaryIntent,
                    action: actualAction,
                    templateId: usedTemplateId ?? 'ai_fallback',
                    hasOrderPayload: !!orderPayload,
                },
            });
            this.logToFile({
                event: 'create_draft_order',
                conversationId: input.conversationId,
                inbound: input.messageText,
                outbound: finalReply,
                templateId: usedTemplateId ?? 'ai_fallback',
                templateScenario: templateResult?.scenario ?? 'ai_fallback',
                orderPayload: orderPayload ? { items: orderPayload.items.length, customerInfo: orderPayload.customerInfo } : null,
                memory,
            });
            return {
                decision: shared_1.ReplyDecision.CreateDraftOrder,
                reply: { text: finalReply, sendNow: true },
                handoff: { required: false, reason: null },
                stateUpdate,
                orderPayload: orderPayload ?? undefined,
            };
        }
        await this.auditService.log({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            type: shared_1.AuditLogType.AiDecision,
            details: {
                decision: shared_1.ReplyDecision.Reply,
                intent: classification.primaryIntent,
                dialogueAct: classification.dialogueAct,
                action: classification.recommendedAction,
                templateId: usedTemplateId ?? 'ai_fallback',
            },
        });
        this.logToFile({
            event: 'reply',
            conversationId: input.conversationId,
            inbound: input.messageText,
            outbound: finalReply,
            templateId: usedTemplateId ?? 'ai_fallback',
            templateScenario: templateResult?.scenario ?? 'ai_fallback',
            stage: classification.conversationStage,
            action: classification.recommendedAction,
            memory,
        });
        return {
            decision: shared_1.ReplyDecision.Reply,
            reply: { text: finalReply, sendNow: true },
            handoff: { required: false, reason: null },
            stateUpdate,
        };
    }
    scenarioToAction(scenario) {
        const map = {
            greeting: 'greet',
            show_products: 'show_products',
            show_price: 'show_price',
            recommend_product: 'recommend',
            ask_recommendation_from_shown: 'recommend',
            confirm_selection: 'confirm_selection',
            collect_checkout_info: 'start_checkout',
            order_confirmed_ask_delivery: 'ask_delivery',
            confirm_order: 'confirm_order',
            answer_delivery: 'answer_faq',
            answer_payment: 'answer_faq',
            out_of_stock: 'show_products',
            ask_variant_choice: 'ask_variant_choice',
            product_not_found: 'ai_fallback_clarification',
        };
        return map[scenario] ?? scenario;
    }
    resolveShortReply(classification, memory, messageText) {
        const text = messageText.trim().toLowerCase();
        if (text.length > 8 || classification.confidence >= 0.8)
            return;
        const isConfirmation = /^(так|да|ок|добре|беру|го|давайте|звісно)$/i.test(text);
        const isRejection = /^(ні|нет|не)$/i.test(text);
        if (isConfirmation) {
            classification.slotAction = 'confirmation';
            classification.confidence = 0.95;
            this.logger.log(`Short reply safety net: "${text}" → confirmation`);
        }
        else if (isRejection) {
            classification.slotAction = 'rejection';
            classification.confidence = 0.95;
            this.logger.log(`Short reply safety net: "${text}" → rejection`);
        }
    }
    matchVariant(variants, userColor, userSize) {
        const input = (userColor || userSize || '').toLowerCase().trim();
        if (!input)
            return null;
        const normalize = (s) => s.toLowerCase().replace(/[ʼ'ьіїєґ]/g, '').replace(/\s+/g, ' ').trim();
        const getLabel = (v) => (v.color || v.size || v.name || '').toLowerCase();
        const exact = variants.find(v => getLabel(v) === input);
        if (exact)
            return exact;
        const partial = variants.filter(v => getLabel(v).includes(input) || input.includes(getLabel(v)));
        if (partial.length === 1)
            return partial[0];
        const normalizedInput = normalize(input);
        const normMatch = variants.find(v => normalize(getLabel(v)) === normalizedInput);
        if (normMatch)
            return normMatch;
        const inputWords = normalizedInput.split(/[\s-]+/);
        const wordMatches = variants
            .map(v => {
            const labelWords = normalize(getLabel(v)).split(/[\s-]+/);
            const overlap = inputWords.filter(w => labelWords.some(lw => lw.includes(w) || w.includes(lw))).length;
            return { variant: v, overlap };
        })
            .filter(x => x.overlap > 0)
            .sort((a, b) => b.overlap - a.overlap);
        if (wordMatches.length === 1)
            return wordMatches[0].variant;
        if (wordMatches.length > 1 && wordMatches[0].overlap > wordMatches[1].overlap) {
            return wordMatches[0].variant;
        }
        const levenshtein = (a, b) => {
            const matrix = [];
            for (let i = 0; i <= a.length; i++)
                matrix[i] = [i];
            for (let j = 0; j <= b.length; j++)
                matrix[0][j] = j;
            for (let i = 1; i <= a.length; i++) {
                for (let j = 1; j <= b.length; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
                }
            }
            return matrix[a.length][b.length];
        };
        const fuzzy = variants
            .map(v => ({ variant: v, dist: levenshtein(normalizedInput, normalize(getLabel(v))) }))
            .filter(x => x.dist <= 3)
            .sort((a, b) => a.dist - b.dist);
        if (fuzzy.length === 1)
            return fuzzy[0].variant;
        if (fuzzy.length > 1 && fuzzy[0].dist < fuzzy[1].dist)
            return fuzzy[0].variant;
        return null;
    }
    shouldSearchProducts(classification, memory) {
        const searchActions = [
            'show_products',
            'recommend',
            'show_price',
            'confirm_selection',
            'start_checkout',
        ];
        const searchIntents = [
            'product_inquiry',
            'category_browse',
            'ask_price',
            'availability_check',
            'ask_recommendation',
            'ready_to_order',
            'confirm_choice',
        ];
        const hasEntities = !!(classification.entities.category || classification.entities.productName || classification.entities.color);
        const noProductsShownYet = !memory.lastPresentedProducts?.length;
        return (searchActions.includes(classification.recommendedAction) ||
            searchIntents.includes(classification.primaryIntent) ||
            (hasEntities && noProductsShownYet));
    }
    extractSearchKeywords(classification) {
        const keywords = [];
        if (classification.entities.productName)
            keywords.push(classification.entities.productName);
        if (classification.entities.category)
            keywords.push(classification.entities.category);
        if (classification.entities.color)
            keywords.push(classification.entities.color);
        return keywords.length > 0 ? keywords : [''];
    }
    async searchProducts(tenantId, conversationId, keywords) {
        for (const keyword of keywords) {
            if (!keyword)
                continue;
            const results = await this.availabilityService.checkAll(tenantId, {
                query: keyword,
            });
            await this.auditService.log({
                tenantId,
                conversationId,
                type: shared_1.AuditLogType.AvailabilityCheck,
                details: { keyword, productsFound: results.length },
            });
            if (results.length > 0) {
                return results.map((r) => ({
                    product: r.product,
                    variants: r.variants,
                }));
            }
        }
        return undefined;
    }
    updateMemoryFromAction(actualAction, memory, templateResult, classification, productData) {
        switch (actualAction) {
            case 'recommend':
                memory.lastAction = 'gave_recommendation';
                memory.awaitingField = 'product_choice';
                memory.selectionState = 'awaiting_confirmation';
                if (productData && productData.length > 0) {
                    const recommended = productData[0];
                    memory.selectedProductId = recommended.product.id;
                    memory.selectedProductTitle = recommended.product.title;
                    memory.availableVariants = recommended.variants.map((v) => ({
                        id: v.id,
                        name: [...new Set([v.color, v.size].filter(Boolean))].join(', ') || 'standard',
                        color: v.color,
                        size: v.size,
                    }));
                }
                break;
            case 'confirm_selection':
                memory.lastAction = 'confirmed_product';
                memory.awaitingField = 'order_confirmation';
                memory.selectionState = 'awaiting_confirmation';
                if (templateResult && classification) {
                    memory.selectedProductTitle = classification.entities?.productName ?? memory.selectedProductTitle;
                    memory.selectedVariantName = classification.entities?.color ?? classification.entities?.size ?? memory.selectedVariantName;
                }
                break;
            case 'ask_delivery':
            case 'start_checkout':
                memory.lastAction = 'asked_delivery_details';
                memory.awaitingField = 'delivery_info';
                memory.selectionState = 'confirmed';
                break;
            case 'greet':
                memory.lastAction = 'greeted';
                memory.awaitingField = 'product_inquiry';
                memory.selectionState = undefined;
                break;
            case 'show_products':
                memory.lastAction = 'presented_product_options';
                memory.awaitingField = 'product_choice_or_recommendation_request';
                memory.selectionState = 'awaiting_product';
                break;
            case 'show_price':
                memory.lastAction = 'showed_price';
                memory.awaitingField = 'order_decision';
                break;
            case 'ai_fallback_clarification':
                memory.lastAction = 'asked_clarification';
                memory.awaitingField = 'clarification';
                break;
            case 'ask_variant_choice':
                memory.lastAction = 'asked_variant';
                memory.awaitingField = 'variant_selection';
                memory.selectionState = 'awaiting_variant';
                break;
            case 'answer_faq':
                memory.lastAction = 'answered_faq';
                break;
            case 'confirm_order':
                memory.lastAction = 'confirmed_order';
                memory.awaitingField = 'order_finalized';
                break;
        }
    }
    buildOrderPayload(input, memory, classification) {
        const productId = memory.selectedProductId;
        const variantId = memory.selectedVariantId;
        if (!productId || !variantId) {
            this.logger.warn(`Cannot build order payload: missing productId=${productId} variantId=${variantId}`);
            return null;
        }
        const customerName = classification.entities.customerName ?? '';
        const phone = classification.entities.phone ?? '';
        const city = classification.entities.city ?? '';
        const deliveryBranch = classification.entities.deliveryBranch ?? '';
        let unitPrice = 0;
        let externalProductId = null;
        let externalVariantId = null;
        const variants = memory.availableVariants;
        if (Array.isArray(variants)) {
            const matchedVariant = variants.find((v) => v.id === variantId);
            if (matchedVariant) {
                unitPrice = matchedVariant.price ?? 0;
                externalProductId = matchedVariant.externalProductId ?? null;
                externalVariantId = matchedVariant.externalVariantId ?? null;
            }
        }
        if (unitPrice === 0 && memory.lastPresentedProducts?.length) {
            const priceStr = memory.lastPresentedProducts[0].price;
            const priceMatch = priceStr?.match(/[\d.]+/);
            if (priceMatch) {
                unitPrice = parseFloat(priceMatch[0]);
            }
        }
        return {
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            customerId: input.state.conversationId,
            items: [
                {
                    productId,
                    variantId,
                    externalProductId,
                    externalVariantId,
                    title: memory.selectedProductTitle ?? '',
                    variantTitle: memory.selectedVariantName ?? '',
                    quantity: 1,
                    unitPrice,
                    currency: 'UAH',
                },
            ],
            customerInfo: {
                fullName: customerName,
                phone,
                city,
                deliveryBranch,
            },
            source: 'instagram_ai',
        };
    }
    getCurrentStage(state) {
        const statusStageMap = {
            [shared_1.ConversationStateStatus.Browsing]: 'need_discovery',
            [shared_1.ConversationStateStatus.StockConfirmed]: 'showing_options',
            [shared_1.ConversationStateStatus.CollectingCustomerInfo]: 'collecting_customer_info',
        };
        return statusStageMap[state.stateStatus] ?? 'greeting';
    }
    buildOrderStateContext(memory) {
        if (memory.selectedProductId && (memory.selectionState === 'confirmed' || memory.lastAction === 'asked_delivery_details')) {
            return `\nORDER STATE: Active checkout — Product: ${memory.selectedProductTitle ?? 'unknown'} (${memory.selectedVariantName ?? ''}). Awaiting delivery details.`;
        }
        if (memory.selectedProductId) {
            return `\nORDER STATE: Product browsing — ${memory.selectedProductTitle ?? 'product selected'}, not yet confirmed for order.`;
        }
        return `\nORDER STATE: No active order. No product selected. Do NOT confirm any order.`;
    }
    async aiFallbackReply(params) {
        const lang = params.language ?? 'uk';
        const langMap = { uk: 'Ukrainian', en: 'English' };
        const langName = langMap[lang] ?? lang;
        const productContext = params.productData
            ? this.buildProductContext(params.productData)
            : '';
        const memoryContext = this.buildMemoryContext(params.memory);
        const systemPrompt = [
            `You are a sales manager for an online store. Reply ONLY in ${langName}.`,
            params.brandTone ? `\nTone:\n${params.brandTone}` : '',
            productContext ? `\nProduct data from database:\n${productContext}` : '',
            params.categories.length
                ? `\nAvailable categories: ${params.categories.join(', ')}.`
                : '',
            memoryContext ? `\n${memoryContext}` : '',
            `\nCONVERSATION RULES:`,
            `1. NEVER repeat what you already said. Don't re-list products, don't re-describe, don't re-greet.`,
            `2. SHORT REPLIES = interpreted in context of your LAST action.`,
            `3. If you showed options and user asks for recommendation -> recommend with a reason. Don't re-ask.`,
            `4. When presenting products: ALWAYS include the price. Be conversational, not tabular.`,
            `5. NEVER say "contact manager", "зараз перевірю ціну", or reveal you are AI.`,
            `6. If product not found, say you'll check and follow up.`,
            `7. Lead the conversation forward.`,
            `8. NEVER greet mid-conversation.`,
            `9. Keep replies SHORT (1-3 sentences max).`,
            `10. NEVER confirm an order, say "замовлення оформлено", "в обробці", "дані отримала", or imply an order exists unless ALL of these are true: selectedProductId exists, checkout is in progress, system is expecting delivery details.`,
            this.buildOrderStateContext(params.memory),
            `\nClassification context:`,
            `Intent: ${params.classification.primaryIntent}`,
            `Stage: ${params.classification.conversationStage}`,
            `Action: ${params.classification.recommendedAction}`,
            `\nGenerate a natural, helpful reply. Keep it concise.`,
        ]
            .filter(Boolean)
            .join('\n');
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
        messages.push({ role: 'user', content: params.messageText });
        const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages,
            max_completion_tokens: 300,
            temperature: 0.3,
        });
        const reply = completion.choices[0]?.message?.content?.trim();
        if (!reply) {
            throw new Error('Empty AI fallback response');
        }
        return reply;
    }
    buildProductContext(productData) {
        const parts = [];
        for (const p of productData) {
            const variantDescs = p.variants.map((v) => {
                const details = [v.size, v.color].filter(Boolean).join(', ');
                const stock = v.effectiveAvailable > 0 ? 'в наявності' : 'немає';
                return `${details || 'standard'}: ${v.price} ${v.currency} (${stock})`;
            });
            parts.push(`- ${p.product.title}: ${variantDescs.join('; ')}`);
        }
        return `Products found:\n${parts.join('\n')}`;
    }
    buildMemoryContext(memory) {
        if (!memory.lastAction)
            return '';
        const parts = [
            `\nASSISTANT MEMORY (what happened before):`,
            `Last action: ${memory.lastAction}`,
        ];
        if (memory.lastPresentedProducts?.length) {
            parts.push(`Products shown to customer:`);
            for (const p of memory.lastPresentedProducts) {
                const variants = p.variants.join(', ');
                parts.push(`  - ${p.title} — Price: ${p.price} — Variants: ${variants}`);
            }
        }
        if (memory.orderItems?.length) {
            parts.push(`Current order items: ${memory.orderItems.join(', ')}`);
        }
        if (memory.awaitingField) {
            parts.push(`Currently waiting for: ${memory.awaitingField}`);
        }
        if (memory.selectedCategory) {
            parts.push(`Selected category: ${memory.selectedCategory}`);
        }
        return parts.join('\n');
    }
    async doHandoff(input, reason, softMessage) {
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
            softMessage,
        });
        return {
            decision: shared_1.ReplyDecision.Handoff,
            reply: softMessage ? { text: softMessage, sendNow: true } : null,
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
    __param(2, (0, typeorm_1.InjectRepository)(store_config_entity_1.StoreConfig)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        availability_service_1.AvailabilityService,
        audit_service_1.AuditService,
        classifier_service_1.ClassifierService,
        template_engine_service_1.TemplateEngineService,
        policy_engine_service_1.PolicyEngineService,
        config_1.ConfigService,
        instagram_content_service_1.InstagramContentService])
], ReplyEngineService);
//# sourceMappingURL=reply-engine.service.js.map