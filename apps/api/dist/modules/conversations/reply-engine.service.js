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
const subscriptions_service_1 = require("../subscriptions/subscriptions.service");
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
const color_i18n_1 = require("../engine/color-i18n");
const format_1 = require("../../common/format");
const shared_1 = require("@direct-mate/shared");
const instagram_content_service_1 = require("../channels/instagram/instagram-content.service");
const size_charts_service_1 = require("../size-charts/size-charts.service");
const nonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0;
const LOG_FILE = path.join(process.cwd(), 'conversations.log');
const RECOMMENDED_SIZE_PREFIX = (size) => `За вашими параметрами рекомендую розмір ${size} 💛`;
const ASK_FOR_MEASUREMENTS_HELP = 'Напишіть свій зріст та вагу і я допоможу підібрати розмір 💛';
let ReplyEngineService = ReplyEngineService_1 = class ReplyEngineService {
    logToFile(entry) {
        const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
        fs.appendFile(LOG_FILE, line, () => { });
    }
    constructor(settingsRepo, examplesRepo, storeConfigRepo, availabilityService, auditService, classifierService, templateEngine, policyEngine, config, instagramContentService, subscriptionsService, sizeChartsService) {
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
        this.subscriptionsService = subscriptionsService;
        this.sizeChartsService = sizeChartsService;
        this.logger = new common_1.Logger(ReplyEngineService_1.name);
        this.openai = new openai_1.default({
            apiKey: this.config.get('openai.apiKey'),
        });
        this.model = this.config.get('openai.model') ?? 'gpt-4o';
    }
    async process(input) {
        const ctx = await this.loadContext(input);
        const withTrace = (r) => { r.trace = ctx.trace; return r; };
        const planActive = await this.subscriptionsService.isActive(input.tenantId);
        if (!planActive) {
            ctx.trace.push('subscription: inactive → soft block');
            return withTrace({
                decision: shared_1.ReplyDecision.Reply,
                reply: { text: null, sendNow: false },
                handoff: { required: true, reason: 'subscription_expired' },
                stateUpdate: {},
            });
        }
        const maxFailedTurns = ctx.settings?.handoffRules?.maxFailedTurns ?? 5;
        if ((ctx.memory.failedTurns ?? 0) >= maxFailedTurns) {
            ctx.trace.push('pre-check: max_failed_turns exceeded');
            return withTrace(await this.doHandoff(input, 'max_failed_turns'));
        }
        const classifyResult = await this.classifyMessage(input, ctx);
        if (classifyResult)
            return withTrace(classifyResult);
        const mediaResult = await this.resolveMediaProduct(input, ctx);
        if (mediaResult)
            return withTrace(mediaResult);
        const sizeChartResult = await this.handleSizeChartRequest(input, ctx);
        if (sizeChartResult)
            return withTrace(sizeChartResult);
        const preQualifyResult = await this.handlePreQualify(input, ctx);
        if (preQualifyResult)
            return withTrace(preQualifyResult);
        const searchResult = await this.searchAndFilterProducts(input, ctx);
        if (searchResult)
            return withTrace(searchResult);
        this.resolveVariantSelection(input, ctx);
        const result = await this.buildResponse(input, ctx);
        if (!ctx.memory.welcomedAt &&
            ctx.classification?.primaryIntent !== 'greeting' &&
            result.reply?.text) {
            const greeting = await this.templateEngine.renderCustomScenario(input.tenantId, 'conversation_start_greeting', {});
            if (greeting) {
                ctx.trace.push('first-turn welcome prepended');
                ctx.memory.welcomedAt = new Date().toISOString();
                result.stateUpdate = {
                    ...result.stateUpdate,
                    contextJson: { ...ctx.memory },
                };
                const contextualReply = result.reply;
                result.reply = { text: greeting.text, sendNow: true };
                result.extraReplies = [
                    {
                        text: contextualReply.text,
                        sendNow: true,
                        imageUrls: contextualReply.imageUrls,
                    },
                    ...(result.extraReplies ?? []),
                ];
            }
        }
        return withTrace(result);
    }
    async loadContext(input) {
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
        const effectiveConfig = storeConfig ??
            {
                escalationConfig: {},
                fallbackConfig: {
                    mode: 'template_first_with_safe_fallback',
                },
                brandConfig: {},
            };
        const flowConfig = effectiveConfig?.flowConfig;
        return {
            memory,
            classification: undefined,
            policy: undefined,
            settings,
            storeConfig,
            effectiveConfig,
            examples,
            categories,
            productData: undefined,
            mediaProductData: undefined,
            isFirstProductPresentation: false,
            flowConfig,
            trace: [],
        };
    }
    async classifyMessage(input, ctx) {
        const { memory, settings, effectiveConfig, categories } = ctx;
        const maxFailedTurns = settings?.handoffRules?.maxFailedTurns ?? 5;
        const tenantBusinessType = effectiveConfig?.flowConfig?.businessType ?? 'clothing';
        let classification;
        try {
            classification = await this.classifierService.classify({
                messageText: input.messageText,
                recentMessages: input.recentMessages,
                memory,
                categories,
                currentStage: this.getCurrentStage(input.state),
                tenantBusinessType,
            });
        }
        catch (err) {
            this.logger.error('AI classification failed', err);
            ctx.trace.push('classify: ai_failure → handoff');
            return this.doHandoff(input, 'ai_failure');
        }
        this.resolveShortReply(classification, memory, input.messageText);
        ctx.trace.push(`classify: intent=${classification.primaryIntent} action=${classification.recommendedAction} slot=${classification.slotAction} conf=${classification.confidence}`);
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
        ctx.policy = policy;
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
                        tenantBusinessType,
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
                        ctx.trace.push(`classify: fallback model overrode escalation → continue`);
                        classification = secondOpinion;
                    }
                    else {
                        ctx.trace.push(`classify: policy escalation confirmed by fallback → handoff (${policy.reason ?? 'policy_escalation'})`);
                        return this.doHandoff(input, policy.reason ?? 'policy_escalation');
                    }
                }
                catch {
                    this.logger.warn('Fallback verification failed');
                    ctx.trace.push(`classify: fallback verification failed → handoff (${policy.reason ?? 'policy_escalation'})`);
                    return this.doHandoff(input, policy.reason ?? 'policy_escalation');
                }
            }
            else {
                ctx.trace.push(`classify: policy escalation, no fallback model → handoff (${policy.reason ?? 'policy_escalation'})`);
                return this.doHandoff(input, policy.reason ?? 'policy_escalation');
            }
        }
        if (classification.primaryIntent === 'greeting' &&
            memory.selectionState &&
            !memory.orderCreated &&
            !classification.entities.category &&
            !classification.entities.productName) {
            ctx.trace.push('classify: greeting with stale state → reset');
            memory.selectedProductId = undefined;
            memory.selectedProductTitle = undefined;
            memory.selectedVariantId = undefined;
            memory.selectedVariantName = undefined;
            memory.selectionState = undefined;
            memory.lastPresentedProducts = undefined;
            memory.availableVariants = undefined;
            memory.lastAction = undefined;
            memory.awaitingField = undefined;
            memory.cartItems = undefined;
            memory.variantStep = null;
            memory.selectedColor = undefined;
            memory.selectedSize = undefined;
            memory.preQualifyCollected = undefined;
            memory.preQualifyData = undefined;
            memory.recommendedSize = undefined;
            memory.skinTypeCollected = undefined;
            memory.recommendedSkinType = undefined;
            memory.shouldOfferSizeHelp = undefined;
            memory.awaitingPreQualifyAnswer = undefined;
        }
        const POST_ORDER_PASSIVE_INTENTS = ['gratitude', 'thanks', 'small_talk', 'confirmation', 'goodbye'];
        if (memory.orderCreated) {
            if (POST_ORDER_PASSIVE_INTENTS.includes(classification.primaryIntent)) {
                ctx.trace.push(`classify: post-order passive intent=${classification.primaryIntent} → ack reply`);
                this.logger.log('Post-order passive intent: ' + classification.primaryIntent);
                const ackReply = 'Будь ласка 💛 Якщо захочете ще щось — пишіть!';
                const stateUpdate = {};
                stateUpdate.contextJson = memory;
                ctx.classification = classification;
                return {
                    decision: shared_1.ReplyDecision.Reply,
                    reply: { text: ackReply, sendNow: true },
                    handoff: { required: false, reason: null },
                    stateUpdate,
                };
            }
            if (!POST_ORDER_PASSIVE_INTENTS.includes(classification.primaryIntent)) {
                ctx.trace.push(`classify: post-order state reset (slotAction=${classification.slotAction} intent=${classification.primaryIntent})`);
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
                memory.cartItems = undefined;
                memory.variantStep = null;
                memory.selectedColor = undefined;
                memory.selectedSize = undefined;
                memory.preQualifyCollected = undefined;
                memory.preQualifyData = undefined;
                memory.recommendedSize = undefined;
                memory.skinTypeCollected = undefined;
                memory.recommendedSkinType = undefined;
                memory.shouldOfferSizeHelp = undefined;
                memory.awaitingPreQualifyAnswer = undefined;
                this.logger.log('State reset: new inquiry after completed order');
            }
        }
        if (classification.slotAction === 'adds_to_cart' && !memory.orderCreated) {
            const sameProduct = memory.selectedProductTitle &&
                (!classification.entities.productName ||
                    memory.selectedProductTitle.toLowerCase().includes(classification.entities.productName.toLowerCase()) ||
                    classification.entities.productName.toLowerCase().includes(memory.selectedProductTitle.toLowerCase()));
            if (memory.selectionState === 'awaiting_confirmation' &&
                memory.selectedProductId &&
                memory.selectedVariantId &&
                memory.selectedVariantName) {
                if (!memory.cartItems)
                    memory.cartItems = [];
                const alreadyInCart = memory.cartItems.some((it) => it.productId === memory.selectedProductId &&
                    it.variantId === memory.selectedVariantId);
                if (!alreadyInCart) {
                    let itemPrice = 0;
                    let itemCurrency = 'UAH';
                    const memVar = Array.isArray(memory.availableVariants)
                        ? memory.availableVariants.find((v) => v.id === memory.selectedVariantId)
                        : null;
                    if (memVar?.price) {
                        itemPrice = memVar.price;
                        itemCurrency = memVar.currency ?? 'UAH';
                    }
                    memory.cartItems.push({
                        productId: memory.selectedProductId,
                        variantId: memory.selectedVariantId,
                        externalProductId: null,
                        externalVariantId: null,
                        title: memory.selectedProductTitle ?? '',
                        variantName: memory.selectedVariantName,
                        price: itemPrice,
                        currency: itemCurrency,
                    });
                    ctx.trace.push(`4.6: committed pending ${memory.selectedVariantName} before switching (cart=${memory.cartItems.length})`);
                }
            }
            if (sameProduct) {
                memory.selectedVariantId = undefined;
                memory.selectedVariantName = undefined;
                memory.selectionState = 'awaiting_product';
                memory.variantStep = null;
                memory.selectedColor = undefined;
                memory.selectedSize = undefined;
                ctx.trace.push(`4.6: adds_to_cart same product (${memory.selectedProductTitle}), cleared variant only, selectionState=awaiting_product`);
                this.logger.log('adds_to_cart: same product, clearing variant for new selection');
            }
            else {
                memory.selectedProductId = undefined;
                memory.selectedProductTitle = undefined;
                memory.selectedVariantId = undefined;
                memory.selectedVariantName = undefined;
                memory.selectionState = undefined;
                memory.availableVariants = undefined;
                memory.variantStep = null;
                memory.selectedColor = undefined;
                memory.selectedSize = undefined;
                ctx.trace.push(`4.6: adds_to_cart new product, cleared all selection`);
                this.logger.log('adds_to_cart: clearing selection for new product, keeping cart');
            }
        }
        if (classification.slotAction === 'correction' &&
            memory.cartItems?.length &&
            memory.selectionState === 'cart_item_added') {
            const wantedProduct = classification.entities.productName;
            const wantedColor = classification.entities.color;
            if (wantedProduct || wantedColor) {
                const before = memory.cartItems.length;
                memory.cartItems = memory.cartItems.filter(item => {
                    if (wantedProduct && !item.title.toLowerCase().includes(wantedProduct.toLowerCase()))
                        return false;
                    if (wantedColor && !item.variantName.toLowerCase().includes(wantedColor.toLowerCase()))
                        return false;
                    return true;
                });
                if (memory.cartItems.length > 1 && wantedColor) {
                    const narrower = memory.cartItems.filter(item => item.variantName.toLowerCase().includes(wantedColor.toLowerCase()));
                    if (narrower.length > 0)
                        memory.cartItems = narrower;
                }
                ctx.trace.push(`cart-correction: ${before} → ${memory.cartItems.length} items (kept matching "${wantedProduct ?? wantedColor}")`);
                if (memory.cartItems.length === 0) {
                    ctx.trace.push('cart-correction: no match in cart → clear + fresh search');
                    memory.selectedProductId = undefined;
                    memory.selectedProductTitle = undefined;
                    memory.selectedVariantId = undefined;
                    memory.selectedVariantName = undefined;
                    memory.selectionState = undefined;
                    memory.lastAction = undefined;
                    memory.awaitingField = undefined;
                    memory.availableVariants = undefined;
                    memory.variantStep = null;
                    memory.selectedColor = undefined;
                    memory.selectedSize = undefined;
                }
                else {
                    memory.selectionState = 'cart_item_added';
                    memory.lastAction = 'cart_corrected';
                    classification.recommendedAction = 'ask_continue_or_checkout';
                }
            }
        }
        ctx.classification = classification;
        return null;
    }
    async resolveMediaProduct(input, ctx) {
        if (!input.mediaReference)
            return null;
        if (input.mediaReference.type === 'customer_photo') {
            try {
                const match = await this.instagramContentService.matchCustomerPhoto(input.tenantId, input.mediaReference.mediaId);
                if (match) {
                    ctx.trace.push(`customer_photo: matched to product ${match.productId} (confidence=${match.confidence})`);
                    const mediaProductData = await this.availabilityService.findAllByProductId(match.productId);
                    ctx.mediaProductData = mediaProductData;
                    this.logToFile({
                        event: 'customer_photo_matched',
                        conversationId: input.conversationId,
                        productId: match.productId,
                        confidence: match.confidence,
                    });
                    return null;
                }
            }
            catch (err) {
                this.logger.error('Customer photo matching failed, falling back to handoff', err);
            }
            ctx.trace.push('customer_photo: no product match → handoff');
            return this.doHandoff(input, 'customer_photo', 'Секунду, зараз перевірю 💛');
        }
        const mapping = await this.instagramContentService.findByMediaId(input.tenantId, input.mediaReference.mediaId);
        if (mapping?.productId) {
            const mediaProductData = await this.availabilityService.findAllByProductId(mapping.productId, mapping.variantId ?? undefined);
            ctx.mediaProductData = mediaProductData;
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
        return null;
    }
    async handlePreQualify(input, ctx) {
        const businessType = ctx.effectiveConfig?.flowConfig?.businessType ?? 'clothing';
        if (businessType === 'cosmetics') {
            return this.handlePreQualifyCosmetics(input, ctx);
        }
        return this.handlePreQualifyClothing(input, ctx);
    }
    async handlePreQualifyClothing(input, ctx) {
        const { memory, effectiveConfig, mediaProductData } = ctx;
        const classification = ctx.classification;
        const preQualifyFlowConfig = effectiveConfig?.flowConfig;
        const strategy = preQualifyFlowConfig?.preQualifyStrategy ?? 'after_search_offered';
        const awaitingPreQualify = memory.lastAction === 'asked_pre_qualify' &&
            memory.awaitingField === 'pre_qualify_data';
        if (memory.awaitingPreQualifyAnswer && !preQualifyFlowConfig?.preQualify?.enabled) {
            ctx.trace.push('preQualify: disabled mid-conversation → dropping pending offer answer');
            memory.awaitingPreQualifyAnswer = false;
            memory.shouldOfferSizeHelp = false;
        }
        if (memory.awaitingPreQualifyAnswer) {
            const yesNo = this.classifyOfferAnswer(classification);
            if (yesNo === 'yes') {
                ctx.trace.push('preQualify: offer accepted → ask height/weight');
                memory.awaitingPreQualifyAnswer = false;
                memory.shouldOfferSizeHelp = false;
                const prompt = preQualifyFlowConfig.preQualify?.prompt ||
                    'Підкажіть ваш зріст та вагу, щоб підібрати розмір 💛';
                memory.lastAction = 'asked_pre_qualify';
                memory.awaitingField = 'pre_qualify_data';
                return {
                    decision: shared_1.ReplyDecision.Reply,
                    reply: { text: prompt, sendNow: true },
                    handoff: { required: false, reason: null },
                    stateUpdate: { contextJson: memory },
                };
            }
            if (yesNo === 'no') {
                ctx.trace.push('preQualify: offer declined → short ack');
                memory.awaitingPreQualifyAnswer = false;
                memory.shouldOfferSizeHelp = false;
                memory.lastAction = 'declined_offer';
                return {
                    decision: shared_1.ReplyDecision.Reply,
                    reply: {
                        text: 'Окей 💛 Як визначитесь — пишіть',
                        sendNow: true,
                    },
                    handoff: { required: false, reason: null },
                    stateUpdate: { contextJson: memory },
                };
            }
            ctx.trace.push('preQualify: offer ignored (user moved on) → clear flags');
            memory.awaitingPreQualifyAnswer = false;
            memory.shouldOfferSizeHelp = false;
        }
        const midFlow = await this.maybeMidFlowSizeHelp(input, ctx);
        if (midFlow)
            return midFlow;
        if (preQualifyFlowConfig?.preQualify?.enabled &&
            !memory.preQualifyCollected &&
            !memory.orderCreated &&
            !mediaProductData &&
            !memory.cartItems?.length &&
            memory.selectionState !== 'cart_item_added' &&
            memory.selectionState !== 'awaiting_variant' &&
            memory.selectionState !== 'awaiting_confirmation' &&
            !classification.entities.size &&
            !classification.entities.productName &&
            (awaitingPreQualify || this.shouldSearchProducts(classification, memory))) {
            if (awaitingPreQualify ||
                classification.primaryIntent === 'provide_details' ||
                this.looksLikePreQualifyData(input.messageText, preQualifyFlowConfig.preQualify.fields)) {
                memory.preQualifyData = this.extractPreQualifyData(input.messageText, preQualifyFlowConfig.preQualify.fields);
                memory.preQualifyCollected = true;
                ctx.trace.push(`preQualify: data collected ${JSON.stringify(memory.preQualifyData)}`);
                this.logger.log(`Pre-qualify data collected: ${JSON.stringify(memory.preQualifyData)}`);
                const sizeChart = preQualifyFlowConfig.sizeChart;
                if (sizeChart && memory.preQualifyData) {
                    const recommended = this.recommendSize(memory.preQualifyData, sizeChart);
                    if (recommended) {
                        memory.recommendedSize = recommended;
                        this.logger.log(`Recommended size: ${recommended}`);
                        memory.lastAction = 'recommended_size';
                    }
                }
                if (!classification.entities.category && memory.selectedCategory) {
                    classification.entities.category = memory.selectedCategory;
                }
                const hasSpecificChoice = !!(classification.entities.productName ||
                    (classification.entities.color && classification.entities.size));
                if (!hasSpecificChoice) {
                    classification.primaryIntent = 'category_browse';
                    classification.recommendedAction = 'show_products';
                    classification.dialogueAct = 'general_chat';
                }
                return null;
            }
            if (strategy === 'before_search') {
                ctx.trace.push('preQualify: before_search → ask height/weight');
                if (classification.entities.category) {
                    memory.selectedCategory = classification.entities.category;
                }
                const prompt = preQualifyFlowConfig.preQualify.prompt ||
                    'Підкажіть ваш зріст та вагу, щоб підібрати розмір 💛';
                memory.lastAction = 'asked_pre_qualify';
                memory.awaitingField = 'pre_qualify_data';
                return {
                    decision: shared_1.ReplyDecision.Reply,
                    reply: { text: prompt, sendNow: true },
                    handoff: { required: false, reason: null },
                    stateUpdate: { contextJson: memory },
                };
            }
            ctx.trace.push('preQualify: after_search_offered → continue to search, will append offer');
            if (classification.entities.category) {
                memory.selectedCategory = classification.entities.category;
            }
        }
        return null;
    }
    classifyOfferAnswer(classification) {
        const hasProductEntities = !!(classification.entities.productName ||
            classification.entities.color ||
            classification.entities.size ||
            classification.entities.skinType);
        if (hasProductEntities)
            return 'other';
        if (classification.slotAction === 'confirmation')
            return 'yes';
        if (classification.slotAction === 'rejection')
            return 'no';
        return 'other';
    }
    async handlePreQualifyCosmetics(input, ctx) {
        const { memory, effectiveConfig, mediaProductData } = ctx;
        const classification = ctx.classification;
        const preQualifyFlowConfig = effectiveConfig?.flowConfig;
        const strategy = preQualifyFlowConfig?.preQualifyStrategy ?? 'after_search_offered';
        const awaitingPreQualify = memory.lastAction === 'asked_pre_qualify' &&
            memory.awaitingField === 'pre_qualify_data';
        if (classification.entities.skinType && !memory.skinTypeCollected) {
            memory.recommendedSkinType = classification.entities.skinType;
            memory.skinTypeCollected = true;
            memory.preQualifyData = { skinType: classification.entities.skinType };
            memory.preQualifyCollected = true;
            memory.lastAction = 'recommended_skin_type';
            ctx.trace.push(`preQualifyCosmetics: skinType=${classification.entities.skinType} captured`);
            if (!classification.entities.category && memory.selectedCategory) {
                classification.entities.category = memory.selectedCategory;
            }
            if (!classification.entities.productName) {
                classification.primaryIntent = 'category_browse';
                classification.recommendedAction = 'show_products';
            }
            return null;
        }
        if (memory.awaitingPreQualifyAnswer && !preQualifyFlowConfig?.preQualify?.enabled) {
            ctx.trace.push('preQualifyCosmetics: disabled mid-conversation → dropping pending offer answer');
            memory.awaitingPreQualifyAnswer = false;
            memory.shouldOfferSizeHelp = false;
        }
        if (memory.awaitingPreQualifyAnswer) {
            const yesNo = this.classifyOfferAnswer(classification);
            if (yesNo === 'yes') {
                ctx.trace.push('preQualifyCosmetics: offer accepted → ask skin type');
                memory.awaitingPreQualifyAnswer = false;
                memory.shouldOfferSizeHelp = false;
                const prompt = preQualifyFlowConfig.preQualify?.prompt ||
                    'Який у вас тип шкіри? (жирна / суха / нормальна / комбінована / чутлива) 💛';
                memory.lastAction = 'asked_pre_qualify';
                memory.awaitingField = 'pre_qualify_data';
                return {
                    decision: shared_1.ReplyDecision.Reply,
                    reply: { text: prompt, sendNow: true },
                    handoff: { required: false, reason: null },
                    stateUpdate: { contextJson: memory },
                };
            }
            if (yesNo === 'no') {
                ctx.trace.push('preQualifyCosmetics: offer declined → short ack');
                memory.awaitingPreQualifyAnswer = false;
                memory.shouldOfferSizeHelp = false;
                memory.lastAction = 'declined_offer';
                return {
                    decision: shared_1.ReplyDecision.Reply,
                    reply: {
                        text: 'Окей 💛 Як визначитесь — пишіть',
                        sendNow: true,
                    },
                    handoff: { required: false, reason: null },
                    stateUpdate: { contextJson: memory },
                };
            }
            ctx.trace.push('preQualifyCosmetics: offer ignored (user moved on)');
            memory.awaitingPreQualifyAnswer = false;
            memory.shouldOfferSizeHelp = false;
        }
        if (preQualifyFlowConfig?.preQualify?.enabled &&
            !memory.skinTypeCollected &&
            !memory.orderCreated &&
            !mediaProductData &&
            !memory.cartItems?.length &&
            memory.selectionState !== 'cart_item_added' &&
            memory.selectionState !== 'awaiting_variant' &&
            memory.selectionState !== 'awaiting_confirmation' &&
            !classification.entities.productName &&
            (awaitingPreQualify || this.shouldSearchProducts(classification, memory))) {
            if (strategy === 'before_search') {
                ctx.trace.push('preQualifyCosmetics: before_search → ask skin type');
                if (classification.entities.category) {
                    memory.selectedCategory = classification.entities.category;
                }
                const prompt = preQualifyFlowConfig.preQualify.prompt ||
                    'Який у вас тип шкіри? (жирна / суха / нормальна / комбінована / чутлива) 💛';
                memory.lastAction = 'asked_pre_qualify';
                memory.awaitingField = 'pre_qualify_data';
                return {
                    decision: shared_1.ReplyDecision.Reply,
                    reply: { text: prompt, sendNow: true },
                    handoff: { required: false, reason: null },
                    stateUpdate: { contextJson: memory },
                };
            }
            ctx.trace.push('preQualifyCosmetics: after_search_offered → continue to search, will append offer');
            if (classification.entities.category) {
                memory.selectedCategory = classification.entities.category;
            }
        }
        return null;
    }
    async searchAndFilterProducts(input, ctx) {
        const { memory, mediaProductData } = ctx;
        const classification = ctx.classification;
        let productData;
        let isFirstProductPresentation = false;
        if (mediaProductData && mediaProductData.length > 0) {
            productData = mediaProductData;
            isFirstProductPresentation = false;
            memory.lastPresentedProducts = mediaProductData.map((p) => ({
                title: p.product.title,
                variants: [...new Set(p.variants.map((v) => [...new Set([v.size, (0, color_i18n_1.localizeColor)(v.color)].filter(Boolean))].join(', ') || 'standard'))],
                price: [
                    ...new Set(p.variants.map((v) => `${v.price} ${(0, format_1.formatCurrency)(v.currency)}`)),
                ].join(' / '),
                productId: p.product.id,
                rawVariants: p.variants.map((v) => ({
                    id: v.id,
                    color: v.color,
                    size: v.size,
                    price: v.price,
                    salePrice: null,
                    available: v.effectiveAvailable > 0,
                })),
                searchKeywords: p.product.searchKeywords ?? null,
            }));
            const first = mediaProductData[0];
            const inStock = first.variants.filter((v) => v.effectiveAvailable > 0);
            memory.selectedProductId = first.product.id;
            memory.selectedProductTitle = first.product.title;
            memory.availableVariants = inStock.map((v) => ({
                id: v.id,
                name: [...new Set([(0, color_i18n_1.localizeColor)(v.color), v.size].filter(Boolean))].join(', ') || 'standard',
                color: v.color,
                size: v.size,
                imageUrl: v.imageUrl ?? null,
            }));
            memory.totalVariantsForSelectedProduct = first.variants.length;
            const captionEmpty = !(input.messageText ?? '').trim();
            if (captionEmpty) {
                ctx.trace.push(`5.5m: photo with empty caption → coerce intent=${classification.primaryIntent}/${classification.recommendedAction}→availability_check`);
                classification.primaryIntent = 'availability_check';
                classification.recommendedAction = 'show_products';
                classification.slotAction = 'new_inquiry';
                classification.entities.color = undefined;
                classification.entities.size = undefined;
                memory.selectedVariantId = undefined;
                memory.selectedVariantName = undefined;
                memory.selectionState = 'awaiting_product';
            }
            if (classification.entities.productName &&
                classification.entities.productName !== first.product.title) {
                ctx.trace.push(`5.5m: overrode classifier productName="${classification.entities.productName}" → media-resolved "${first.product.title}"`);
                classification.entities.productName = first.product.title;
            }
            const isSelectionIntent = ['availability_check', 'product_inquiry', 'general_question'].includes(classification.primaryIntent) ||
                classification.recommendedAction === 'show_products';
            if (isSelectionIntent) {
                const userColor = classification.entities.color;
                const userSize = classification.entities.size;
                if (userColor || userSize) {
                    const matched = this.matchVariant(inStock.map((v) => ({
                        id: v.id,
                        name: [...new Set([(0, color_i18n_1.localizeColor)(v.color), v.size].filter(Boolean))].join(', '),
                        color: v.color ?? null,
                        size: v.size ?? null,
                    })), userColor, userSize);
                    if (matched) {
                        memory.selectedVariantId = matched.id;
                        memory.selectedVariantName = matched.name;
                        memory.selectionState = 'awaiting_confirmation';
                        const intent = userSize ? 'confirm_variant_available' : 'confirm_choice';
                        const action = userSize ? 'confirm_variant_available' : 'confirm_selection';
                        classification.primaryIntent = intent;
                        classification.recommendedAction = action;
                        ctx.trace.push(`5.5m: matched "${matched.name}" → awaiting_confirmation`);
                        this.logger.log(`5.5m: Story reply — variant matched: ${matched.name}`);
                    }
                    else {
                        const colorForms = userColor ? this.translateColor(userColor) : [];
                        const sizeExists = userSize && inStock.some(v => v.size?.toLowerCase() === userSize.toLowerCase());
                        const colorExists = userColor && inStock.some(v => {
                            if (!v.color)
                                return false;
                            const vc = v.color.toLowerCase();
                            return colorForms.some(f => vc === f || vc.includes(f) || f.includes(vc));
                        });
                        if (sizeExists || colorExists) {
                            memory.selectionState = 'awaiting_variant';
                            memory.selectedVariantId = undefined;
                            memory.selectedVariantName = undefined;
                            classification.primaryIntent = 'ask_variant_choice';
                            classification.recommendedAction = 'ask_variant_choice';
                            ctx.trace.push(`5.5m: "${userSize || userColor}" exists but multiple options → ask_variant_choice`);
                            this.logger.log(`5.5m: Story reply — dimension exists, asking for other dimension`);
                        }
                        else {
                            memory.selectionState = 'awaiting_variant';
                            memory.selectedVariantId = undefined;
                            memory.selectedVariantName = undefined;
                            memory.requestedVariant = userSize || userColor;
                            classification.primaryIntent = 'variant_not_available';
                            classification.recommendedAction = 'variant_not_available';
                            ctx.trace.push(`5.5m: "${userSize || userColor}" not available → variant_not_available`);
                            this.logger.log(`5.5m: Story reply — variant not available, showing alternatives`);
                        }
                    }
                }
                else if (inStock.length === 1) {
                    memory.selectedVariantId = inStock[0].id;
                    memory.selectedVariantName = memory.availableVariants[0].name;
                    memory.selectionState = 'awaiting_confirmation';
                    const isLastInStockMedia = (memory.totalVariantsForSelectedProduct ?? 0) > 1;
                    if (isLastInStockMedia) {
                        classification.primaryIntent = 'confirm_last_in_stock';
                        classification.recommendedAction = 'confirm_last_in_stock';
                        ctx.trace.push(`5.5m: last-in-stock (1 of ${memory.totalVariantsForSelectedProduct}) → confirm_last_in_stock`);
                    }
                    else {
                        classification.primaryIntent = 'confirm_choice';
                        classification.recommendedAction = 'confirm_selection';
                    }
                    this.logger.log(`5.5m: Story reply — single variant auto-selected: ${memory.selectedVariantName} (intent=${classification.primaryIntent})`);
                }
                else {
                    memory.selectionState = 'awaiting_variant';
                    classification.primaryIntent = 'ask_variant_choice';
                    classification.recommendedAction = 'ask_variant_choice';
                    this.logger.log(`5.5m: Story reply — product pre-seeded, no variant → ask_variant_choice`);
                }
            }
        }
        if (!productData && this.isNarrowingSlotFill(classification, memory)) {
            const narrowed = this.narrowLastPresentedInMemory(memory.lastPresentedProducts, classification, ctx);
            ctx.trace.push(`narrow_gate: fired, ${narrowed.length} products survived (from ${memory.lastPresentedProducts.length})`);
            if (narrowed.length === 0) {
                return await this.handleNarrowingNoMatch(input, ctx);
            }
            productData = narrowed;
        }
        const needsSearch = !productData && this.shouldSearchProducts(classification, memory);
        ctx.trace.push(`search: needsSearch=${needsSearch}`);
        if (needsSearch) {
            if (classification.slotAction === 'correction') {
                memory.selectedVariantId = undefined;
                memory.selectedVariantName = undefined;
                ctx.trace.push('search: correction — cleared selectedVariantId for re-matching');
            }
            const searchKeywords = this.extractSearchKeywords(classification);
            productData = await this.searchProducts(input.tenantId, input.conversationId, searchKeywords, classification.entities.category);
            this.logToFile({
                event: 'product_search',
                conversationId: input.conversationId,
                keywords: searchKeywords,
                found: productData ? productData.length : 0,
            });
            if (memory.selectedCategory &&
                productData &&
                productData.length > 1) {
                const cat = memory.selectedCategory.toLowerCase();
                const inCategory = productData.filter((p) => p.product.category?.toLowerCase() === cat);
                if (inCategory.length > 0) {
                    ctx.trace.push(`search: narrowed by selectedCategory="${memory.selectedCategory}" (${productData.length} → ${inCategory.length})`);
                    productData = inCategory;
                }
            }
            if (Array.isArray(memory.lastPresentedProducts) &&
                memory.lastPresentedProducts.length > 0 &&
                productData &&
                productData.length > 1) {
                const shownTitles = new Set(memory.lastPresentedProducts.map((p) => p.title.toLowerCase()));
                const inShown = productData.filter((p) => shownTitles.has(p.product.title.toLowerCase()));
                if (inShown.length > 0) {
                    ctx.trace.push(`search: narrowed to lastPresentedProducts (${productData.length} → ${inShown.length})`);
                    productData = inShown;
                }
            }
            const isCorrection = classification.slotAction === 'correction';
            const userSpecifiedSize = !!classification.entities.size;
            if (productData && productData.length > 0 && memory.recommendedSize && !isCorrection && !userSpecifiedSize) {
                const recSize = memory.recommendedSize;
                const filtered = productData
                    .map(p => ({
                    ...p,
                    variants: p.variants.filter(v => !v.size || v.size.toLowerCase() === recSize.toLowerCase()),
                }))
                    .filter(p => p.variants.length > 0);
                if (filtered.length > 0) {
                    productData = filtered;
                    this.logger.log(`Filtered products by recommended size ${recSize}: ${filtered.length} products`);
                }
            }
            const userProductName = classification.entities.productName;
            if (userProductName && productData && productData.length > 1) {
                const narrowed = this.narrowByProductName(productData, userProductName);
                if (narrowed && narrowed.length < productData.length) {
                    ctx.trace.push(`search: narrowed by productName="${userProductName}" (${productData.length} → ${narrowed.length})`);
                    productData = narrowed;
                }
            }
            const userColor = classification.entities.color;
            const userSize = classification.entities.size;
            if (productData && productData.length > 0 && (userColor || userSize)) {
                const userColorForms = userColor ? this.translateColor(userColor) : [];
                const userSizeLower = userSize?.toLowerCase().trim();
                const filtered = productData
                    .map(p => {
                    const productHasColorDim = p.variants.some(v => !!v.color);
                    const titleLower = p.product.title.toLowerCase();
                    const skLower = (p.product.searchKeywords ?? '').toLowerCase();
                    const productMatchesColorByMetadata = !!userColor &&
                        userColorForms.some(f => titleLower.includes(f) || skLower.includes(f));
                    if (userColor && !productHasColorDim) {
                        if (!productMatchesColorByMetadata) {
                            return { ...p, variants: [] };
                        }
                    }
                    return {
                        ...p,
                        variants: p.variants.filter(v => {
                            if (userColor && productHasColorDim) {
                                if (productMatchesColorByMetadata) {
                                }
                                else {
                                    if (!v.color)
                                        return false;
                                    const variantColorForms = this.translateColor(v.color);
                                    const overlap = userColorForms.some(uf => variantColorForms.some(vf => vf === uf || vf.includes(uf) || uf.includes(vf)));
                                    if (!overlap)
                                        return false;
                                }
                            }
                            if (userSizeLower) {
                                if (!v.size)
                                    return false;
                                if (v.size.toLowerCase().trim() !== userSizeLower)
                                    return false;
                            }
                            return true;
                        }),
                    };
                })
                    .filter(p => p.variants.length > 0);
                if (filtered.length > 0) {
                    productData = filtered;
                    ctx.trace.push(`search: filtered by user color="${userColor ?? ''}" size="${userSize ?? ''}" → ${filtered.length} products`);
                }
            }
            ctx.trace.push(`search: found ${productData?.length ?? 0} products`);
            if ((!productData || productData.length === 0) &&
                ['product_inquiry', 'ready_to_order', 'availability_check', 'category_browse'].includes(classification.primaryIntent)) {
                ctx.trace.push('search: product not found → handoff');
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
                if (productData.length > 1 && memory.selectedProductId) {
                    const selectedIdx = productData.findIndex(p => p.product.id === memory.selectedProductId);
                    if (selectedIdx > 0) {
                        const [selected] = productData.splice(selectedIdx, 1);
                        productData.unshift(selected);
                    }
                }
                isFirstProductPresentation = !memory.lastPresentedProducts?.length;
                ctx.trace.push(`search: isFirstPres=${isFirstProductPresentation} selState=${memory.selectionState}`);
                const lockedProductInResults = memory.selectedProductId
                    ? productData.find((p) => p.product.id === memory.selectedProductId) ?? null
                    : null;
                const searchCandidate = lockedProductInResults ??
                    (productData.length === 1 ? productData[0] : null);
                let lockDecision;
                if (!memory.selectedProductId) {
                    lockDecision = searchCandidate
                        ? { adopt: true, reason: 'no prior lock' }
                        : { adopt: false, reason: 'no candidate' };
                }
                else if (lockedProductInResults) {
                    lockDecision = { adopt: true, reason: 'same product' };
                }
                else if (searchCandidate) {
                    lockDecision = this.shouldAdoptSearchLock(searchCandidate, memory, classification);
                }
                else {
                    lockDecision = { adopt: false, reason: 'lock held (no candidate)' };
                }
                const lockHolds = !!memory.selectedProductId && !lockDecision.adopt;
                const toPresented = (p) => ({
                    title: p.product.title,
                    variants: [...new Set(p.variants.map((v) => [...new Set([v.size, (0, color_i18n_1.localizeColor)(v.color)].filter(Boolean))].join(', ') || 'standard'))],
                    price: [
                        ...new Set(p.variants.map((v) => `${v.price} ${(0, format_1.formatCurrency)(v.currency)}`)),
                    ].join(' / '),
                    productId: p.product.id,
                    rawVariants: p.variants.map((v) => ({
                        id: v.id,
                        color: v.color,
                        size: v.size,
                        price: v.price,
                        salePrice: null,
                        available: v.effectiveAvailable > 0,
                    })),
                    searchKeywords: p.product.searchKeywords ?? null,
                });
                if (lockHolds) {
                    if (lockedProductInResults) {
                        memory.lastPresentedProducts = [toPresented(lockedProductInResults)];
                    }
                }
                else {
                    memory.lastPresentedProducts = productData.map(toPresented);
                }
                memory.selectedCategory =
                    classification.entities.category ?? searchKeywords[0];
                ctx.trace.push(`search: searchCandidate=${searchCandidate?.product?.title ?? 'none'}, availableVariants=${memory.availableVariants ? memory.availableVariants.length : 0}, lockDecision=${lockDecision.reason}, lockHolds=${lockHolds}`);
                if (searchCandidate && lockDecision.adopt) {
                    memory.availableVariants = searchCandidate.variants
                        .filter((v) => v.effectiveAvailable > 0)
                        .map((v) => ({
                        id: v.id,
                        name: [...new Set([(0, color_i18n_1.localizeColor)(v.color), v.size].filter(Boolean))].join(', ') || 'standard',
                        color: v.color ?? null,
                        size: v.size ?? null,
                        imageUrl: v.imageUrl ?? null,
                    }));
                    memory.selectedProductId = searchCandidate.product.id;
                    memory.selectedProductTitle = searchCandidate.product.title;
                }
                else if (lockHolds) {
                    const candidateNote = searchCandidate
                        ? `search candidate was ${searchCandidate.product.id.slice(0, 8)}`
                        : 'no candidate';
                    ctx.trace.push(`search: kept locked product ${memory.selectedProductId.slice(0, 8)} ` +
                        `(${candidateNote} — ${lockDecision.reason})`);
                    if (lockedProductInResults) {
                        memory.availableVariants = lockedProductInResults.variants
                            .filter((v) => v.effectiveAvailable > 0)
                            .map((v) => ({
                            id: v.id,
                            name: [...new Set([(0, color_i18n_1.localizeColor)(v.color), v.size].filter(Boolean))].join(', ') || 'standard',
                            color: v.color ?? null,
                            size: v.size ?? null,
                            imageUrl: v.imageUrl ?? null,
                        }));
                    }
                    else {
                        productData = [];
                    }
                    const userColor = classification.entities.color;
                    const userSize = classification.entities.size;
                    if ((userColor || userSize) &&
                        Array.isArray(memory.availableVariants) &&
                        memory.availableVariants.length > 0 &&
                        !memory.selectedVariantId) {
                        const variantsForMatch = memory.availableVariants.map((v) => ({
                            id: v.id,
                            name: v.name,
                            color: v.color ?? null,
                            size: v.size ?? null,
                        }));
                        const matched = this.matchVariant(variantsForMatch, userColor, userSize);
                        if (matched) {
                            memory.selectedVariantId = matched.id;
                            memory.selectedVariantName = matched.name;
                            memory.selectionState = 'awaiting_confirmation';
                            this.setConfirmIntent(classification, userColor, userSize);
                            ctx.trace.push(`lock-held: matched variant ${matched.name} from memory.availableVariants`);
                        }
                        else {
                            ctx.trace.push(`lock-held: no variant matched for color="${userColor ?? ''}" size="${userSize ?? ''}"`);
                        }
                    }
                }
                if (classification.slotAction === 'new_inquiry' &&
                    memory.selectedProductId &&
                    searchCandidate &&
                    memory.selectedProductId !== searchCandidate.product.id &&
                    lockDecision.adopt) {
                    ctx.trace.push(`lock dropped due to new_inquiry: ${searchCandidate.product.id.slice(0, 8)}`);
                }
                if (isFirstProductPresentation) {
                    memory.selectionState = 'awaiting_product';
                }
                ctx.trace.push(`search: upgrade check selState=${memory.selectionState} prodId=${!!memory.selectedProductId} varId=${!!memory.selectedVariantId}`);
                if (memory.selectionState === 'awaiting_product' && memory.selectedProductId && memory.selectedVariantId) {
                    memory.selectionState = 'awaiting_confirmation';
                    classification.recommendedAction = 'confirm_selection';
                    ctx.trace.push('search: upgraded awaiting_product → awaiting_confirmation (variant matched during search)');
                    this.logger.log('Variant already matched during search — upgrading to awaiting_confirmation');
                }
            }
        }
        ctx.productData = productData;
        ctx.isFirstProductPresentation = isFirstProductPresentation;
        return null;
    }
    resolveVariantSelection(input, ctx) {
        const { memory, effectiveConfig, productData } = ctx;
        const classification = ctx.classification;
        if (classification.slotAction === 'rejection' &&
            memory.selectionState === 'awaiting_confirmation' &&
            memory.selectedProductId &&
            !classification.entities.productName &&
            !classification.entities.category) {
            memory.selectionState = 'awaiting_product';
            memory.selectedVariantId = undefined;
            memory.selectedVariantName = undefined;
            classification.primaryIntent = 'decline_selection';
            classification.recommendedAction = 'decline_selection';
            ctx.trace.push('5.5a-rej: rejection on selected product → decline_selection');
            this.logger.log('5.5a-rej: customer declined the offered variant → decline_selection');
        }
        if (memory.selectionState === 'awaiting_confirmation' &&
            memory.selectedProductId &&
            classification.slotAction !== 'confirmation' &&
            classification.slotAction !== 'rejection' &&
            Array.isArray(memory.availableVariants) &&
            memory.availableVariants.length > 0) {
            const available = memory.availableVariants;
            const askedSize = classification.entities.size;
            const askedColor = classification.entities.color;
            const sizeMissing = askedSize &&
                !available.some((v) => v.size && v.size.toLowerCase() === askedSize.toLowerCase());
            const colorMissing = askedColor &&
                !available.some((v) => v.color && v.color.toLowerCase() === askedColor.toLowerCase());
            const genericVariantQuery = !askedSize &&
                !askedColor &&
                classification.primaryIntent === 'ask_variant_choice' &&
                available.length <= 1;
            if (sizeMissing || colorMissing || genericVariantQuery) {
                memory.requestedVariant = askedSize || askedColor || undefined;
                classification.primaryIntent = 'variant_not_available';
                classification.recommendedAction = 'variant_not_available';
                ctx.trace.push(`5.5a-pre: post-selection variant query (asked=${memory.requestedVariant ?? 'generic'}) → variant_not_available`);
                this.logger.log(`5.5a-pre: customer asked about unavailable variant (${memory.requestedVariant ?? 'generic'}) on selected product → variant_not_available`);
            }
        }
        this.logger.log(`5.5a check: slotAction=${classification.slotAction} selState=${memory.selectionState} prodId=${!!memory.selectedProductId} varId=${!!memory.selectedVariantId}`);
        if (classification.slotAction === 'confirmation' &&
            memory.selectionState === 'awaiting_confirmation' &&
            memory.selectedProductId &&
            memory.selectedVariantId) {
            if (!memory.cartItems)
                memory.cartItems = [];
            let itemPrice = 0;
            let itemCurrency = 'UAH';
            const currentProduct = productData?.find(p => p.product.id === memory.selectedProductId);
            const currentVariant = currentProduct?.variants.find(v => v.id === memory.selectedVariantId);
            if (currentVariant) {
                itemPrice = currentVariant.price;
                itemCurrency = currentVariant.currency;
            }
            else if (Array.isArray(memory.availableVariants)) {
                const memVariant = memory.availableVariants.find(v => v.id === memory.selectedVariantId);
                if (memVariant?.price) {
                    itemPrice = memVariant.price;
                    itemCurrency = memVariant.currency ?? 'UAH';
                }
            }
            if (itemPrice === 0 && memory.lastPresentedProducts?.length) {
                const priceStr = memory.lastPresentedProducts[0].price;
                const priceMatch = priceStr?.match(/[\d.]+/);
                if (priceMatch)
                    itemPrice = parseFloat(priceMatch[0]);
            }
            let variantName = memory.selectedVariantName;
            if (!variantName && currentVariant) {
                variantName = [...new Set([currentVariant.color, currentVariant.size].filter(Boolean))].join(', ') || 'standard';
            }
            if (!variantName && Array.isArray(memory.availableVariants)) {
                const memVar = memory.availableVariants.find(v => v.id === memory.selectedVariantId);
                if (memVar)
                    variantName = memVar.name;
            }
            const alreadyInCart = memory.cartItems.some(item => item.variantId === memory.selectedVariantId);
            if (!alreadyInCart) {
                memory.cartItems.push({
                    productId: memory.selectedProductId,
                    variantId: memory.selectedVariantId,
                    externalProductId: null,
                    externalVariantId: null,
                    title: memory.selectedProductTitle,
                    variantName: variantName ?? 'standard',
                    price: itemPrice,
                    currency: itemCurrency,
                });
            }
            memory.selectionState = 'cart_item_added';
            classification.primaryIntent = 'confirm_choice';
            classification.recommendedAction = 'ask_continue_or_checkout';
            ctx.trace.push(`5.5a: cart add ${memory.selectedProductTitle} (${memory.selectedVariantName}), cart=${memory.cartItems.length}`);
            this.logger.log(`5.5a FIRED: Item added to cart: ${memory.selectedProductTitle} (${memory.selectedVariantName}). Cart has ${memory.cartItems.length} items.`);
            this.logToFile({
                event: 'cart_item_added',
                conversationId: input.conversationId,
                selectionState: memory.selectionState,
                selectedProductId: memory.selectedProductId,
                selectedVariantId: memory.selectedVariantId,
                cartSize: memory.cartItems.length,
                action: 'ask_continue_or_checkout',
            });
        }
        if ((classification.slotAction === 'confirmation' || classification.primaryIntent === 'ready_to_order' || classification.primaryIntent === 'provide_details') &&
            memory.selectionState === 'cart_item_added' &&
            memory.cartItems?.length &&
            memory.lastAction === 'asked_continue_or_checkout') {
            memory.selectionState = 'confirmed';
            classification.primaryIntent = 'ready_to_order';
            classification.recommendedAction = 'start_checkout';
            classification.conversationStage = 'checkout_started';
            ctx.trace.push(`5.5a-2: checkout with ${memory.cartItems.length} items`);
            this.logger.log('Cart checkout: proceeding with ' + memory.cartItems.length + ' items');
        }
        const variantsFlowConfig = effectiveConfig?.flowConfig?.variants;
        const needsTwoStepVariants = variantsFlowConfig?.askSequence?.length === 2 &&
            variantsFlowConfig.askSequence.includes('color') &&
            variantsFlowConfig.askSequence.includes('size');
        if (classification.slotAction === 'confirmation' &&
            (memory.selectionState === 'awaiting_confirmation' ||
                (memory.selectionState === 'awaiting_variant' && !memory.variantStep)) &&
            memory.selectedProductId &&
            !memory.selectedVariantId) {
            const rawVariants = memory.availableVariants;
            const variants = Array.isArray(rawVariants) ? rawVariants : [];
            const userColor = classification.entities.color;
            const userSize = classification.entities.size;
            const hasBothDimensions = needsTwoStepVariants &&
                variants.some((v) => v.color) && variants.some((v) => v.size);
            if (variants.length === 1) {
                memory.selectedVariantId = variants[0].id;
                memory.selectedVariantName = variants[0].name;
                memory.selectionState = 'awaiting_confirmation';
                this.setConfirmIntent(classification, userColor, userSize);
                ctx.trace.push('5.5b: single variant auto-selected');
                this.logger.log('Single variant → auto-selected, proceeding to confirm_selection');
            }
            else if (hasBothDimensions && !memory.variantStep) {
                memory.selectionState = 'awaiting_variant';
                memory.variantStep = 'color';
                classification.primaryIntent = 'ask_variant_choice';
                classification.recommendedAction = 'ask_variant_choice';
                ctx.trace.push('5.5b: two-step start with color');
                this.logger.log(`Two-step variant: starting with color (${variants.length} variants)`);
            }
            else if (variants.length > 1 && (userColor || userSize)) {
                const matched = this.matchVariant(variants, userColor, userSize);
                if (matched) {
                    memory.selectedVariantId = matched.id;
                    memory.selectedVariantName = matched.name;
                    memory.selectionState = 'awaiting_confirmation';
                    this.setConfirmIntent(classification, userColor, userSize);
                    ctx.trace.push(`5.5b: variant matched ${matched.name}`);
                    this.logger.log(`Variant matched: ${matched.name}`);
                }
                else {
                    memory.selectionState = 'awaiting_variant';
                    classification.primaryIntent = 'ask_variant_choice';
                    classification.recommendedAction = 'ask_variant_choice';
                    ctx.trace.push('5.5b: variant not matched → ask_variant_choice');
                    this.logger.log('Variant not matched confidently, asking user');
                }
            }
            else if (variants.length > 1) {
                memory.selectionState = 'awaiting_variant';
                classification.primaryIntent = 'ask_variant_choice';
                classification.recommendedAction = 'ask_variant_choice';
                ctx.trace.push(`5.5b: ${variants.length} variants → ask_variant_choice`);
                this.logger.log(`Multiple variants (${variants.length}), asking user to choose`);
            }
        }
        if (memory.selectionState === 'awaiting_variant' &&
            memory.variantStep &&
            memory.selectedProductId &&
            !memory.selectedVariantId &&
            (classification.slotAction === 'fills_missing_slot' || classification.slotAction === 'confirmation')) {
            const rawVariants = memory.availableVariants;
            const variants = Array.isArray(rawVariants) ? rawVariants : [];
            const userColor = classification.entities.color;
            const userSize = classification.entities.size;
            if (memory.variantStep === 'color' && (userColor || input.messageText.trim())) {
                const colorInput = userColor || input.messageText.trim();
                const colorVariants = variants.filter((v) => v.color);
                const uniqueColors = [...new Set(colorVariants.map((v) => v.color))];
                const matchedColor = this.matchColorOrSize(colorInput, uniqueColors);
                if (matchedColor) {
                    ctx.trace.push(`5.5b-2: color=${matchedColor}`);
                    memory.selectedColor = matchedColor;
                    if (memory.selectedSize) {
                        const exactVariant = variants.find((v) => v.color && v.color.toLowerCase() === matchedColor.toLowerCase() &&
                            v.size && v.size.toLowerCase() === memory.selectedSize.toLowerCase());
                        if (exactVariant) {
                            memory.selectedVariantId = exactVariant.id;
                            memory.selectedVariantName = exactVariant.name;
                            memory.variantStep = null;
                            memory.selectionState = 'awaiting_confirmation';
                            this.setConfirmIntent(classification, matchedColor, memory.selectedSize);
                            ctx.trace.push(`5.5b-2: color+selectedSize matched → resolved`);
                            return;
                        }
                    }
                    const sizesForColor = variants.filter((v) => v.color && v.color.toLowerCase() === matchedColor.toLowerCase() && v.size);
                    if (sizesForColor.length > 1) {
                        memory.variantStep = 'size';
                        classification.primaryIntent = 'ask_size_for_color';
                        classification.recommendedAction = 'ask_size_for_color';
                        this.logger.log(`Two-step variant: color=${matchedColor}, asking for size (${sizesForColor.length} options)`);
                    }
                    else if (sizesForColor.length === 1) {
                        memory.selectedVariantId = sizesForColor[0].id;
                        memory.selectedVariantName = sizesForColor[0].name;
                        memory.variantStep = null;
                        memory.selectionState = 'awaiting_confirmation';
                        this.setConfirmIntent(classification, matchedColor, sizesForColor[0].size ?? undefined);
                        this.logger.log(`Two-step variant: color=${matchedColor}, single size → auto-selected`);
                    }
                    else {
                        const colorOnlyVariant = variants.find((v) => v.color && v.color.toLowerCase() === matchedColor.toLowerCase());
                        if (colorOnlyVariant) {
                            memory.selectedVariantId = colorOnlyVariant.id;
                            memory.selectedVariantName = colorOnlyVariant.name;
                            memory.variantStep = null;
                            memory.selectionState = 'awaiting_confirmation';
                            this.setConfirmIntent(classification, matchedColor, undefined);
                        }
                    }
                }
                else {
                    classification.primaryIntent = 'ask_variant_choice';
                    classification.recommendedAction = 'ask_variant_choice';
                    this.logger.log(`Two-step variant: color not matched for "${colorInput}", re-asking`);
                }
            }
            else if (memory.variantStep === 'size' && memory.selectedColor && (userSize || (!userColor && input.messageText.trim()))) {
                const sizeInput = userSize || input.messageText.trim();
                const sizesForColor = variants.filter((v) => v.color && v.color.toLowerCase() === memory.selectedColor.toLowerCase() && v.size);
                const uniqueSizes = [...new Set(sizesForColor.map((v) => v.size))];
                const matchedSize = this.matchColorOrSize(sizeInput, uniqueSizes);
                if (matchedSize) {
                    const exactVariant = variants.find((v) => v.color && v.color.toLowerCase() === memory.selectedColor.toLowerCase() &&
                        v.size && v.size.toLowerCase() === matchedSize.toLowerCase());
                    if (exactVariant) {
                        memory.selectedVariantId = exactVariant.id;
                        memory.selectedVariantName = exactVariant.name;
                        memory.variantStep = null;
                        memory.selectionState = 'awaiting_confirmation';
                        this.setConfirmIntent(classification, memory.selectedColor ?? undefined, matchedSize);
                        ctx.trace.push(`5.5b-2: size=${matchedSize} → resolved`);
                        this.logger.log(`Two-step variant: color=${memory.selectedColor}, size=${matchedSize} → resolved`);
                    }
                }
                else {
                    classification.primaryIntent = 'ask_variant_choice';
                    classification.recommendedAction = 'ask_variant_choice';
                    this.logger.log(`Two-step variant: size not matched for "${sizeInput}", re-asking`);
                }
            }
        }
        if ((classification.slotAction === 'fills_missing_slot' ||
            classification.slotAction === 'correction' ||
            (classification.slotAction === 'confirmation' &&
                (classification.entities.color || classification.entities.size))) &&
            memory.selectedProductId &&
            !memory.selectedVariantId &&
            !memory.variantStep &&
            productData && productData.length === 1) {
            const variants = productData[0].variants.filter(v => v.effectiveAvailable > 0);
            ctx.trace.push(`5.5c: fills_missing_slot, ${variants.length} variants`);
            const hasBothDimensions = needsTwoStepVariants &&
                variants.some(v => v.color) && variants.some(v => v.size);
            if (variants.length > 1) {
                const userColor = classification.entities.color;
                const userSize = classification.entities.size;
                if (hasBothDimensions && !userColor && !userSize) {
                    memory.selectionState = 'awaiting_variant';
                    memory.variantStep = 'color';
                    memory.availableVariants = this.buildAvailableVariantsList(variants);
                    classification.primaryIntent = 'ask_variant_choice';
                    classification.recommendedAction = 'ask_variant_choice';
                    this.logger.log(`5.5c two-step: Product selected, starting with color (${variants.length} variants)`);
                }
                else if (userColor || userSize) {
                    const matched = this.matchVariant(variants.map(v => ({ id: v.id, name: [...new Set([v.color, v.size].filter(Boolean))].join(', '), color: v.color, size: v.size })), userColor, userSize);
                    if (matched) {
                        memory.selectedVariantId = matched.id;
                        memory.selectedVariantName = matched.name;
                        memory.selectionState = 'awaiting_confirmation';
                        this.setConfirmIntent(classification, userColor, userSize);
                    }
                    else {
                        memory.selectionState = 'awaiting_variant';
                        memory.availableVariants = this.buildAvailableVariantsList(variants);
                        const hasColorAxis = variants.some(v => v.color);
                        if (userColor && !userSize && !hasColorAxis) {
                            memory.variantStep = null;
                            memory.selectedColor = undefined;
                            memory.selectedSize = undefined;
                            classification.primaryIntent = 'ask_variant_choice';
                            classification.recommendedAction = 'ask_variant_choice';
                            ctx.trace.push('5.5c: color-in-title product (no color axis) → ask_variant_choice (sizes only)');
                        }
                        else if (userColor && !userSize) {
                            memory.selectedColor = userColor;
                            memory.selectedSize = undefined;
                            memory.variantStep = 'size';
                            classification.primaryIntent = 'ask_size_for_color';
                            classification.recommendedAction = 'ask_size_for_color';
                            ctx.trace.push('5.5c: color matched, size ambiguous → ask_size_for_color');
                        }
                        else if (userSize && !userColor) {
                            memory.selectedSize = userSize;
                            memory.selectedColor = undefined;
                            memory.variantStep = 'color';
                            classification.primaryIntent = 'ask_color_for_size';
                            classification.recommendedAction = 'ask_color_for_size';
                            ctx.trace.push('5.5c: size matched, color ambiguous → ask_color_for_size');
                        }
                        else {
                            classification.primaryIntent = 'ask_variant_choice';
                            classification.recommendedAction = 'ask_variant_choice';
                        }
                    }
                }
                else {
                    memory.selectionState = 'awaiting_variant';
                    memory.availableVariants = this.buildAvailableVariantsList(variants);
                    classification.primaryIntent = 'ask_variant_choice';
                    classification.recommendedAction = 'ask_variant_choice';
                    this.logger.log(`5.5c: Product selected, ${variants.length} variants — asking user`);
                }
            }
            else if (variants.length === 1) {
                memory.selectedVariantId = variants[0].id;
                memory.selectedVariantName = [...new Set([variants[0].color, variants[0].size].filter(Boolean))].join(', ') || 'standard';
                memory.selectionState = 'awaiting_confirmation';
                this.setConfirmIntent(classification, classification.entities.color, classification.entities.size);
            }
        }
        if (memory.selectionState === 'awaiting_product' &&
            memory.selectedProductId &&
            !memory.selectedVariantId &&
            Array.isArray(memory.availableVariants) &&
            memory.availableVariants.length > 0) {
            const variants = memory.availableVariants;
            let effectiveVariants = variants;
            if (memory.recommendedSize) {
                const sizeFiltered = variants.filter((v) => !v.size || v.size.toLowerCase() === memory.recommendedSize.toLowerCase());
                if (sizeFiltered.length > 0)
                    effectiveVariants = sizeFiltered;
            }
            const userColor = classification.entities.color;
            const userSize = classification.entities.size;
            ctx.trace.push(`5.5d: selState=${memory.selectionState} prodId=${!!memory.selectedProductId} varId=${!!memory.selectedVariantId} variants=${effectiveVariants.length}`);
            if (effectiveVariants.length === 1) {
                memory.selectedVariantId = effectiveVariants[0].id;
                memory.selectedVariantName = effectiveVariants[0].name;
                memory.selectionState = 'awaiting_confirmation';
                this.setConfirmIntent(classification, userColor, userSize);
                const isVariantQuery = !!(userColor || userSize);
                const isLastInStock = !isVariantQuery &&
                    (memory.totalVariantsForSelectedProduct ?? 0) > 1;
                if (isLastInStock) {
                    classification.primaryIntent = 'confirm_last_in_stock';
                    classification.recommendedAction = 'confirm_last_in_stock';
                    ctx.trace.push(`5.5d: last-in-stock (1 of ${memory.totalVariantsForSelectedProduct}) → confirm_last_in_stock`);
                }
                ctx.trace.push(`5.5d: matched ${effectiveVariants[0].name} → awaiting_confirmation (intent=${classification.primaryIntent})`);
                this.logger.log(`5.5d: Single variant after filter → auto-selected: ${effectiveVariants[0].name}`);
            }
            else if (userColor || userSize) {
                const matched = this.matchVariant(effectiveVariants.map(v => ({ id: v.id, name: v.name, color: v.color ?? null, size: v.size ?? null })), userColor, userSize);
                if (matched) {
                    memory.selectedVariantId = matched.id;
                    memory.selectedVariantName = matched.name;
                    memory.selectionState = 'awaiting_confirmation';
                    this.setConfirmIntent(classification, userColor, userSize);
                    ctx.trace.push(`5.5d: matched ${matched.name} → awaiting_confirmation (intent=${classification.primaryIntent})`);
                    this.logger.log(`5.5d: Variant matched from user input: ${matched.name}`);
                }
                else {
                    memory.selectionState = 'awaiting_variant';
                    if (memory.recommendedSize)
                        memory.variantStep = 'color';
                    classification.primaryIntent = 'ask_variant_choice';
                    classification.recommendedAction = 'ask_variant_choice';
                    ctx.trace.push('5.5d: not matched → awaiting_variant');
                    this.logger.log(`5.5d: Variant not matched, asking user`);
                }
            }
            else if (effectiveVariants.length > 1) {
                memory.selectionState = 'awaiting_variant';
                if (memory.recommendedSize) {
                    memory.variantStep = 'color';
                }
                else if (needsTwoStepVariants) {
                    memory.variantStep = 'color';
                }
                classification.primaryIntent = 'ask_variant_choice';
                classification.recommendedAction = 'ask_variant_choice';
                ctx.trace.push(`5.5d: ${effectiveVariants.length} variants → ask_variant_choice`);
                this.logger.log(`5.5d: Product picked, ${effectiveVariants.length} variants — asking user (variantStep=${memory.variantStep ?? 'all'})`);
            }
        }
    }
    async buildResponse(input, ctx) {
        const { memory, settings, effectiveConfig, examples, categories, productData, isFirstProductPresentation, flowConfig, policy } = ctx;
        const classification = ctx.classification;
        const recentTemplateIds = memory.recentTemplateIds ?? [];
        const templateResult = await this.templateEngine.render({
            tenantId: input.tenantId,
            classification,
            productData,
            memory,
            recentTemplateIds,
            isFirstProductPresentation,
            messageText: input.messageText,
            flowConfig,
        });
        let finalReply;
        let usedTemplateId;
        let actualAction;
        if (templateResult) {
            ctx.trace.push(`template: ${templateResult.scenario} (${templateResult.templateId})`);
            finalReply = templateResult.text;
            usedTemplateId = templateResult.templateId;
            actualAction = this.scenarioToAction(templateResult.scenario);
            const buildResponseBusinessType = effectiveConfig?.flowConfig?.businessType ?? 'clothing';
            if (buildResponseBusinessType === 'clothing') {
                if (memory.recommendedSize && memory.lastAction === 'recommended_size') {
                    finalReply = `${RECOMMENDED_SIZE_PREFIX(memory.recommendedSize)}\n\n${finalReply}`;
                }
            }
            if (buildResponseBusinessType === 'cosmetics') {
                if (memory.recommendedSkinType && memory.lastAction === 'recommended_skin_type') {
                    const SKIN_TYPE_GENITIVE = {
                        'жирна': 'жирної',
                        'суха': 'сухої',
                        'нормальна': 'нормальної',
                        'комбінована': 'комбінованої',
                        'чутлива': 'чутливої',
                    };
                    const skinTypeGenitive = SKIN_TYPE_GENITIVE[memory.recommendedSkinType.toLowerCase()] ??
                        memory.recommendedSkinType;
                    finalReply = `Для ${skinTypeGenitive} шкіри підбираю варіанти 💛\n\n${finalReply}`;
                }
            }
            const buildResponseFlowConfig = effectiveConfig?.flowConfig;
            const buildResponsePreQualifyEnabled = !!buildResponseFlowConfig?.preQualify?.enabled;
            const buildResponseStrategy = buildResponseFlowConfig?.preQualifyStrategy ??
                'after_search_offered';
            const justAnsweredPreQualify = memory.lastAction === 'recommended_size' ||
                memory.lastAction === 'recommended_skin_type' ||
                memory.lastAction === 'asked_pre_qualify';
            const userAlreadyGavePreQualifyInfo = (buildResponseBusinessType === 'clothing' && !!classification.entities.size) ||
                (buildResponseBusinessType === 'cosmetics' && !!classification.entities.skinType);
            if (buildResponsePreQualifyEnabled &&
                buildResponseStrategy === 'after_search_offered' &&
                templateResult.scenario === 'show_products' &&
                !memory.shouldOfferSizeHelp &&
                !justAnsweredPreQualify &&
                !userAlreadyGavePreQualifyInfo &&
                ((buildResponseBusinessType === 'clothing' && !memory.recommendedSize) ||
                    (buildResponseBusinessType === 'cosmetics' && !memory.recommendedSkinType))) {
                const offerSuffix = buildResponseBusinessType === 'cosmetics'
                    ? '\n\nХочете, допоможу підібрати під ваш тип шкіри? 💛'
                    : '\n\nХочете, допоможу з розміром? 💛';
                finalReply = `${finalReply}${offerSuffix}`;
                memory.shouldOfferSizeHelp = true;
                memory.awaitingPreQualifyAnswer = true;
                ctx.trace.push(`offer_suffix: appended (${buildResponseBusinessType})`);
            }
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
            ctx.trace.push('template: none found');
            if (classification.primaryIntent === 'general_question' ||
                classification.recommendedAction === 'answer_faq') {
                ctx.trace.push('handoff: general_question_no_template');
                this.logger.log('general_question with no template → handoff');
                return this.doHandoff(input, 'Клієнт поставив питання, на яке бот не знає відповіді');
            }
            const productIntents = ['product_inquiry', 'ready_to_order', 'availability_check', 'category_browse', 'ask_price'];
            if (productIntents.includes(classification.primaryIntent) && (!productData || productData.length === 0)) {
                ctx.trace.push('handoff: product_not_found');
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
                ctx.trace.push('fallback: AI reply');
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
                ctx.trace.push('handoff: no_template_strict_mode');
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
        ctx.trace.push(`action: ${actualAction}`);
        this.updateMemoryFromAction(actualAction, memory, templateResult, classification, productData);
        const skipVariantUpdate = ['variant_not_available', 'ask_variant_choice', 'ask_size_for_color', 'ask_color_for_size'].includes(templateResult?.scenario ?? '');
        if (templateResult?.matchedVariantId && !skipVariantUpdate) {
            memory.selectedVariantId = templateResult.matchedVariantId;
            memory.selectedVariantName = classification.entities.color ?? classification.entities.size ?? memory.selectedVariantName;
        }
        if (productData && productData.length > 0) {
            const first = productData[0];
            const askingForProduct = memory.selectionState === 'awaiting_product' && productData.length > 1;
            if (!askingForProduct) {
                const lockDecision = this.shouldAdoptSearchLock(first, memory, classification);
                if (lockDecision.adopt) {
                    stateUpdate.selectedProductId = first.product.id;
                    memory.selectedProductId = first.product.id;
                    memory.selectedProductTitle = memory.selectedProductTitle || first.product.title;
                }
                else {
                    ctx.trace.push(`buildResponse: kept locked product ${memory.selectedProductId.slice(0, 8)} ` +
                        `(productData[0] was ${first.product.id.slice(0, 8)} — ${lockDecision.reason})`);
                    stateUpdate.selectedProductId = memory.selectedProductId ?? null;
                }
            }
            else {
                stateUpdate.selectedProductId = memory.selectedProductId ?? null;
            }
            const variantAskingScenarios = ['ask_variant_choice', 'ask_size_for_color', 'ask_color_for_size'];
            const askingForVariant = memory.selectionState === 'awaiting_variant' ||
                variantAskingScenarios.includes(classification.recommendedAction) ||
                variantAskingScenarios.includes(templateResult?.scenario ?? '');
            if (!askingForProduct && !askingForVariant) {
                const inStockVariant = first.variants.find((v) => v.effectiveAvailable > 0);
                stateUpdate.selectedVariantId =
                    inStockVariant?.id ?? first.variants[0]?.id;
            }
            else if (askingForProduct) {
                stateUpdate.selectedVariantId = null;
                memory.selectedVariantId = undefined;
            }
            else {
                stateUpdate.selectedVariantId = memory.selectedVariantId ?? null;
            }
        }
        stateUpdate.contextJson = memory;
        const alreadyOrdered = memory.orderCreated === true;
        if (actualAction === 'confirm_order' && !alreadyOrdered) {
            ctx.trace.push('order: create_draft_order');
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
                reply: { text: finalReply, sendNow: true, imageUrls: templateResult?.imageUrls },
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
            imageUrls: templateResult?.imageUrls,
            templateId: usedTemplateId ?? 'ai_fallback',
            templateScenario: templateResult?.scenario ?? 'ai_fallback',
            stage: classification.conversationStage,
            action: classification.recommendedAction,
            memory,
        });
        const extraReplies = await this.maybeAttachSizeChart(input, ctx, templateResult?.scenario);
        return {
            decision: shared_1.ReplyDecision.Reply,
            reply: { text: finalReply, sendNow: true, imageUrls: templateResult?.imageUrls },
            extraReplies,
            handoff: { required: false, reason: null },
            stateUpdate,
            classification,
            templateScenario: templateResult?.scenario ?? 'ai_fallback',
        };
    }
    async maybeAttachSizeChart(input, ctx, scenario) {
        if (!scenario)
            return undefined;
        if (!ctx.productData || ctx.productData.length !== 1)
            return undefined;
        const isSizeForColor = scenario === 'ask_size_for_color';
        const isVariantChoiceSizeStep = scenario === 'ask_variant_choice' && ctx.memory.variantStep === 'size';
        const productHasColors = ctx.productData[0].variants.some((v) => v.color);
        const productHasSizes = ctx.productData[0].variants.some((v) => v.size);
        const isVariantChoiceSizeOnly = scenario === 'ask_variant_choice' && productHasSizes && !productHasColors;
        if (!isSizeForColor && !isVariantChoiceSizeStep && !isVariantChoiceSizeOnly) {
            return undefined;
        }
        const productId = ctx.productData[0].product.id;
        const { brand, category } = await this.sizeChartsService.getBrandAndCategoryForProduct(input.tenantId, productId);
        const chart = await this.sizeChartsService.resolveForContext(input.tenantId, {
            brand,
            category,
        });
        if (!chart) {
            ctx.trace.push('size_chart auto-attach: no chart matched (silent skip)');
            return undefined;
        }
        ctx.trace.push(`size_chart auto-attach: ${chart.id} (brand=${brand ?? '-'}, category=${category ?? '-'})`);
        const chartImageUrl = chart.imagePath.startsWith('/')
            ? chart.imagePath
            : `/${chart.imagePath}`;
        return [
            {
                text: 'Надсилаю вам розмірну сітку 💛',
                sendNow: true,
                imageUrls: [chartImageUrl],
            },
        ];
    }
    scenarioToAction(scenario) {
        const map = {
            greeting: 'greet',
            show_products: 'show_products',
            show_price: 'show_price',
            recommend_product: 'recommend',
            ask_recommendation_from_shown: 'recommend',
            confirm_selection: 'confirm_selection',
            confirm_last_in_stock: 'confirm_selection',
            decline_selection: 'decline_selection',
            collect_checkout_info: 'start_checkout',
            order_confirmed_ask_delivery: 'ask_delivery',
            confirm_order: 'confirm_order',
            answer_delivery: 'answer_faq',
            answer_payment: 'answer_faq',
            out_of_stock: 'show_products',
            ask_variant_choice: 'ask_variant_choice',
            variant_not_available: 'ask_variant_choice',
            product_not_found: 'ai_fallback_clarification',
            ask_continue_or_checkout: 'ask_continue_or_checkout',
        };
        return map[scenario] ?? scenario;
    }
    setConfirmIntent(classification, userColor, userSize) {
        const isVariantQuery = !!(userSize || userColor);
        classification.primaryIntent = isVariantQuery ? 'confirm_variant_available' : 'confirm_choice';
        classification.recommendedAction = isVariantQuery ? 'confirm_variant_available' : 'confirm_selection';
    }
    buildAvailableVariantsList(variants) {
        return variants.map((v) => ({
            id: v.id,
            name: [...new Set([(0, color_i18n_1.localizeColor)(v.color), v.size].filter(Boolean))].join(', ') || 'standard',
            color: v.color,
            size: v.size,
            imageUrl: v.imageUrl ?? null,
        }));
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
    translateColor(input) {
        const lower = input.toLowerCase().trim();
        const translated = ReplyEngineService_1.COLOR_TRANSLATIONS[lower];
        return translated ? [lower, translated] : [lower];
    }
    matchVariant(variants, userColor, userSize) {
        if (!userColor && !userSize)
            return null;
        const colorForms = userColor ? this.translateColor(userColor) : [];
        const normalize = (s) => s.toLowerCase().replace(/[ʼ'ьіїєґ]/g, '').replace(/\s+/g, ' ').trim();
        let candidates = variants;
        const hasColorAxis = variants.some(v => v.color);
        if (userColor && colorForms.length > 0 && hasColorAxis) {
            const colorMatched = variants.filter(v => {
                if (!v.color)
                    return false;
                const vc = v.color.toLowerCase().trim();
                const vcNorm = normalize(vc);
                const variantColorForms = this.translateColor(v.color);
                return colorForms.some(f => vc === f ||
                    vcNorm === normalize(f) ||
                    vc.includes(f) ||
                    f.includes(vc) ||
                    variantColorForms.some(vf => vf === f));
            });
            if (colorMatched.length > 0) {
                candidates = colorMatched;
            }
            else {
                return null;
            }
        }
        if (userSize) {
            const us = userSize.toLowerCase().trim();
            const sizeMatched = candidates.filter(v => {
                if (!v.size)
                    return false;
                return v.size.toLowerCase().trim() === us;
            });
            if (sizeMatched.length > 0) {
                candidates = sizeMatched;
            }
            else if (userColor) {
                return null;
            }
            else {
                const sizeFuzzy = candidates.filter(v => {
                    if (!v.size)
                        return false;
                    return normalize(v.size).includes(normalize(us)) || normalize(us).includes(normalize(v.size));
                });
                if (sizeFuzzy.length > 0) {
                    candidates = sizeFuzzy;
                }
                else {
                    return null;
                }
            }
        }
        if (candidates.length === 1)
            return candidates[0];
        return null;
    }
    matchColorOrSize(userInput, options) {
        const input = userInput.toLowerCase().trim();
        if (!input || options.length === 0)
            return null;
        const inputForms = this.translateColor(userInput);
        const exact = options.find(o => inputForms.some(f => o.toLowerCase() === f));
        if (exact)
            return exact;
        const partial = options.filter(o => inputForms.some(f => o.toLowerCase().includes(f) || f.includes(o.toLowerCase())));
        if (partial.length === 1)
            return partial[0];
        const normalize = (s) => s.toLowerCase().replace(/[ʼ'ьіїєґ]/g, '').replace(/\s+/g, ' ').trim();
        const normalizedInput = normalize(input);
        const normMatch = options.find(o => normalize(o) === normalizedInput);
        if (normMatch)
            return normMatch;
        const inputWords = normalizedInput.split(/[\s-]+/);
        const wordMatches = options
            .map(o => {
            const labelWords = normalize(o).split(/[\s-]+/);
            const overlap = inputWords.filter(w => labelWords.some(lw => lw.includes(w) || w.includes(lw))).length;
            return { option: o, overlap };
        })
            .filter(x => x.overlap > 0)
            .sort((a, b) => b.overlap - a.overlap);
        if (wordMatches.length === 1)
            return wordMatches[0].option;
        if (wordMatches.length > 1 && wordMatches[0].overlap > wordMatches[1].overlap) {
            return wordMatches[0].option;
        }
        return null;
    }
    async maybeMidFlowSizeHelp(input, ctx) {
        const { memory, effectiveConfig, mediaProductData } = ctx;
        const classification = ctx.classification;
        const flowConfig = effectiveConfig?.flowConfig;
        if (!flowConfig?.preQualify?.enabled)
            return null;
        const numericChart = flowConfig.sizeChart;
        if (!numericChart || Object.keys(numericChart).length === 0)
            return null;
        if (memory.orderCreated)
            return null;
        if (memory.cartItems?.length)
            return null;
        if (mediaProductData)
            return null;
        if (classification.entities.size)
            return null;
        if (classification.slotAction === 'correction')
            return null;
        if (memory.selectionState === 'awaiting_confirmation' &&
            classification.slotAction === 'confirmation') {
            return null;
        }
        const fields = flowConfig.preQualify.fields ?? ['height', 'weight'];
        const hasMeasurements = this.looksLikePreQualifyData(input.messageText, fields);
        const isRecommendation = classification.primaryIntent === 'ask_recommendation';
        const SIZE_KEYWORDS = ['розмір', 'зріст', 'вага'];
        const lowerText = input.messageText.toLowerCase();
        const hasSizeKeyword = SIZE_KEYWORDS.some((k) => lowerText.includes(k));
        if (!hasMeasurements && !(isRecommendation && hasSizeKeyword))
            return null;
        ctx.trace.push('handlePreQualifyClothing: mid-flow size-help branch fired');
        if (!hasMeasurements) {
            memory.lastAction = 'asked_pre_qualify';
            memory.awaitingField = 'pre_qualify_data';
            return {
                decision: shared_1.ReplyDecision.Reply,
                reply: { text: ASK_FOR_MEASUREMENTS_HELP, sendNow: true },
                handoff: { required: false, reason: null },
                stateUpdate: { contextJson: memory },
            };
        }
        const params = this.extractPreQualifyData(input.messageText, fields);
        const recommended = this.recommendSize(params, numericChart);
        if (!recommended)
            return null;
        memory.preQualifyData = params;
        memory.preQualifyCollected = true;
        memory.recommendedSize = recommended;
        memory.lastAction = 'recommended_size';
        if (memory.selectedProductId) {
            const productData = await this.availabilityService.findAllByProductId(memory.selectedProductId);
            if (productData.length > 0) {
                const product = productData[0];
                const matching = product.variants.filter((v) => v.effectiveAvailable > 0 && v.size && v.size.toLowerCase() === recommended.toLowerCase());
                if (matching.length === 1) {
                    const v = matching[0];
                    memory.selectedVariantId = v.id;
                    memory.selectedVariantName = [v.color, v.size].filter(Boolean).join(', ') || recommended;
                    memory.selectedColor = v.color ?? undefined;
                    memory.selectedSize = v.size ?? recommended;
                    memory.selectionState = 'awaiting_confirmation';
                    classification.primaryIntent = 'confirm_selection';
                    classification.recommendedAction = 'confirm_selection';
                    ctx.trace.push(`mid-flow: single variant matched (${memory.selectedVariantName}) → confirm_selection`);
                    return null;
                }
                if (matching.length > 1) {
                    memory.selectedSize = recommended;
                    memory.selectedColor = undefined;
                    memory.variantStep = 'color';
                    memory.selectionState = 'awaiting_variant';
                    memory.availableVariants = this.buildAvailableVariantsList(matching);
                    classification.primaryIntent = 'ask_color_for_size';
                    classification.recommendedAction = 'ask_color_for_size';
                    ctx.trace.push(`mid-flow: ${matching.length} colors at size ${recommended} → ask_color_for_size`);
                    return null;
                }
            }
        }
        if (!classification.entities.category && memory.selectedCategory) {
            classification.entities.category = memory.selectedCategory;
        }
        classification.primaryIntent = 'category_browse';
        classification.recommendedAction = 'show_products';
        classification.dialogueAct = 'general_chat';
        ctx.trace.push(`mid-flow: no product context → show_products filtered by ${recommended}`);
        return null;
    }
    looksLikePreQualifyData(text, fields) {
        if (!fields || fields.length === 0)
            return false;
        const numbers = text.match(/\d+/g);
        if (!numbers || numbers.length === 0)
            return false;
        const plausible = numbers.some(n => {
            const num = parseInt(n, 10);
            return (num >= 30 && num <= 250);
        });
        return plausible;
    }
    extractPreQualifyData(text, fields) {
        const result = {};
        const numbers = text.match(/\d+/g) || [];
        if (fields.includes('height') && fields.includes('weight')) {
            const nums = numbers.map(n => parseInt(n, 10)).filter(n => n > 0);
            if (nums.length >= 2) {
                const sorted = [...nums].sort((a, b) => b - a);
                result['height'] = String(sorted[0]);
                result['weight'] = String(sorted[1]);
            }
            else if (nums.length === 1) {
                const n = nums[0];
                if (n >= 100) {
                    result['height'] = String(n);
                }
                else {
                    result['weight'] = String(n);
                }
            }
        }
        else {
            for (let i = 0; i < fields.length && i < numbers.length; i++) {
                result[fields[i]] = numbers[i];
            }
        }
        return result;
    }
    recommendSize(params, sizeChart) {
        const height = parseInt(params.height, 10);
        const weight = parseInt(params.weight, 10);
        if (!height && !weight)
            return null;
        let bestSize = null;
        let bestScore = -1;
        for (const [size, range] of Object.entries(sizeChart)) {
            let score = 0;
            if (height && height >= range.heightMin && height <= range.heightMax)
                score++;
            if (weight && weight >= range.weightMin && weight <= range.weightMax)
                score++;
            if (score > bestScore) {
                bestScore = score;
                bestSize = size;
            }
        }
        if (bestScore === 0 && height) {
            let closestDist = Infinity;
            for (const [size, range] of Object.entries(sizeChart)) {
                const mid = (range.heightMin + range.heightMax) / 2;
                const dist = Math.abs(height - mid);
                if (dist < closestDist) {
                    closestDist = dist;
                    bestSize = size;
                }
            }
        }
        return bestSize;
    }
    shouldSearchProducts(classification, memory) {
        if (memory.selectionState === 'awaiting_confirmation' && memory.selectedProductId && memory.selectedVariantId
            && classification.slotAction !== 'correction') {
            return false;
        }
        if (this.isNarrowingSlotFill(classification, memory)) {
            return false;
        }
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
    isNarrowingSlotFill(classification, memory) {
        if (classification.slotAction !== 'fills_missing_slot')
            return false;
        if (memory.selectionState !== 'awaiting_product')
            return false;
        const presented = memory.lastPresentedProducts;
        if (!presented?.length)
            return false;
        const anyHasRawVariants = presented.some((p) => (p.rawVariants?.length ?? 0) > 0);
        if (!anyHasRawVariants)
            return false;
        const { color, size, productName } = classification.entities;
        const hasNarrowingEntity = nonEmptyStr(color) || nonEmptyStr(size);
        if (!hasNarrowingEntity)
            return false;
        if (nonEmptyStr(productName))
            return false;
        return true;
    }
    narrowLastPresentedInMemory(presented, classification, ctx) {
        const { color: userColor, size: userSize } = classification.entities;
        const userColorForms = nonEmptyStr(userColor)
            ? this.translateColor(userColor)
            : [];
        const userSizeLower = nonEmptyStr(userSize)
            ? userSize.toLowerCase().trim()
            : '';
        const out = [];
        for (const p of presented) {
            if (!p.rawVariants?.length || !p.productId)
                continue;
            const titleLower = p.title.toLowerCase();
            const skLower = (p.searchKeywords ?? '').toLowerCase();
            const productHasColorDim = p.rawVariants.some((v) => !!v.color);
            const productMatchesColorByMetadata = userColorForms.length > 0 &&
                userColorForms.some((f) => titleLower.includes(f) || skLower.includes(f));
            if (userColorForms.length > 0 &&
                !productHasColorDim &&
                !productMatchesColorByMetadata) {
                continue;
            }
            const matchedVariants = p.rawVariants.filter((v) => {
                if (userColorForms.length > 0 && productHasColorDim) {
                    if (productMatchesColorByMetadata) {
                    }
                    else {
                        if (!v.color)
                            return false;
                        const variantForms = this.translateColor(v.color);
                        const overlap = userColorForms.some((uf) => variantForms.some((vf) => vf === uf || vf.includes(uf) || uf.includes(vf)));
                        if (!overlap)
                            return false;
                    }
                }
                if (userSizeLower) {
                    if (!v.size)
                        return false;
                    if (v.size.toLowerCase().trim() !== userSizeLower)
                        return false;
                }
                return true;
            });
            if (matchedVariants.length === 0)
                continue;
            out.push({
                product: {
                    id: p.productId,
                    title: p.title,
                    imageUrl: null,
                    category: null,
                    searchKeywords: p.searchKeywords ?? null,
                },
                variants: matchedVariants.map((v) => ({
                    id: v.id,
                    color: v.color,
                    size: v.size,
                    price: v.price,
                    currency: 'UAH',
                    effectiveAvailable: v.available ? 1 : 0,
                    imageUrl: null,
                })),
            });
        }
        if (out.length === 0) {
            ctx.trace.push(`narrow: no product satisfied color="${userColor ?? ''}" size="${userSize ?? ''}"`);
        }
        return out;
    }
    async handleNarrowingNoMatch(input, ctx) {
        const { memory, classification } = ctx;
        classification.recommendedAction = 'narrowing_no_match';
        const templateResult = await this.templateEngine.render({
            tenantId: input.tenantId,
            classification,
            memory,
            recentTemplateIds: memory.recentTemplateIds ?? [],
            messageText: input.messageText,
        });
        const reply = templateResult?.text ??
            'Серед показаних варіантів немає такого 💛 Пошукати ширше в каталозі?';
        memory.lastAction = 'narrow_no_match';
        const stateUpdate = {};
        stateUpdate.contextJson = memory;
        ctx.trace.push(`narrow_no_match: rendered ${templateResult?.scenario ?? 'fallback-string'}`);
        return {
            decision: shared_1.ReplyDecision.Reply,
            reply: { text: reply, sendNow: true },
            handoff: { required: false, reason: null },
            stateUpdate,
            templateScenario: templateResult?.scenario ?? 'narrowing_no_match',
        };
    }
    extractSearchKeywords(classification) {
        const keywords = [];
        if (classification.entities.productName)
            keywords.push(classification.entities.productName);
        if (classification.entities.color)
            keywords.push(classification.entities.color);
        return keywords;
    }
    narrowByProductName(productData, productName) {
        const PRODUCT_NAME_STOP_WORDS = new Set([
            'енд', 'and', '&', 'і', 'та', 'the', 'of', 'для',
        ]);
        const nameTerms = productName
            .toLowerCase()
            .split(/\s+/)
            .map(t => t.trim())
            .filter(t => t.length > 2 && !PRODUCT_NAME_STOP_WORDS.has(t));
        if (nameTerms.length === 0)
            return productData;
        const narrowed = productData.filter(p => {
            const titleLower = p.product.title.toLowerCase();
            return nameTerms.every(t => titleLower.includes(t));
        });
        if (narrowed.length === 0)
            return productData;
        return narrowed;
    }
    titlesOverlap(a, b) {
        const tokenize = (s) => s
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter((t) => t.length >= 2 &&
            !ReplyEngineService_1.TITLE_STOP_WORDS.has(t) &&
            !ReplyEngineService_1.TITLE_GENERIC_NOUNS.has(t));
        const ta = new Set(tokenize(a));
        const tb = new Set(tokenize(b));
        if (ta.size === 0 || tb.size === 0) {
            return true;
        }
        for (const t of ta)
            if (tb.has(t))
                return true;
        return false;
    }
    shouldAdoptSearchLock(candidate, memory, classification) {
        if (!memory.selectedProductId) {
            return { adopt: true, reason: 'no prior lock' };
        }
        if (memory.selectedProductId === candidate.product.id) {
            return { adopt: true, reason: 'same product' };
        }
        const productNameMismatch = !!classification.entities.productName &&
            !!memory.selectedProductTitle &&
            !this.titlesOverlap(classification.entities.productName, memory.selectedProductTitle);
        const userChangedProduct = classification.slotAction === 'correction' ||
            classification.slotAction === 'new_inquiry' ||
            productNameMismatch;
        if (userChangedProduct) {
            const why = productNameMismatch
                ? `productName mismatch (${classification.entities.productName} vs ${memory.selectedProductTitle})`
                : `slotAction=${classification.slotAction}`;
            return { adopt: true, reason: `user changed: ${why}` };
        }
        return { adopt: false, reason: 'lock held' };
    }
    async searchProducts(tenantId, conversationId, keywords, category) {
        if (category && keywords.length === 0) {
            const results = await this.availabilityService.checkAll(tenantId, {
                query: '',
                category,
            });
            await this.auditService.log({
                tenantId,
                conversationId,
                type: shared_1.AuditLogType.AvailabilityCheck,
                details: { keyword: '', category, productsFound: results.length },
            });
            if (results.length > 0) {
                return results.map((r) => ({
                    product: r.product,
                    variants: r.variants,
                }));
            }
            return undefined;
        }
        if (category && keywords.length > 1) {
            const combined = keywords.filter(Boolean).join(' ');
            const results = await this.availabilityService.checkAll(tenantId, {
                query: combined,
                category,
            });
            await this.auditService.log({
                tenantId,
                conversationId,
                type: shared_1.AuditLogType.AvailabilityCheck,
                details: { keyword: combined, category, productsFound: results.length },
            });
            if (results.length > 0) {
                return results.map((r) => ({
                    product: r.product,
                    variants: r.variants,
                }));
            }
        }
        for (const keyword of keywords) {
            if (!keyword)
                continue;
            const results = await this.availabilityService.checkAll(tenantId, {
                query: keyword,
                category,
            });
            await this.auditService.log({
                tenantId,
                conversationId,
                type: shared_1.AuditLogType.AvailabilityCheck,
                details: { keyword, category, productsFound: results.length },
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
        if (templateResult?.scenario === 'variant_not_available') {
            memory.lastAction = 'told_variant_not_available';
            return;
        }
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
                        name: [...new Set([(0, color_i18n_1.localizeColor)(v.color), v.size].filter(Boolean))].join(', ') || 'standard',
                        color: v.color,
                        size: v.size,
                        imageUrl: v.imageUrl ?? null,
                    }));
                }
                break;
            case 'confirm_variant_available':
                memory.lastAction = 'confirmed_product';
                memory.awaitingField = 'order_confirmation';
                memory.selectionState = 'awaiting_confirmation';
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
                memory.awaitingField = memory.variantStep === 'size' ? 'size_selection' : 'variant_selection';
                memory.selectionState = 'awaiting_variant';
                memory.selectedVariantId = undefined;
                memory.selectedVariantName = undefined;
                break;
            case 'answer_faq':
                memory.lastAction = 'answered_faq';
                break;
            case 'confirm_order':
                memory.lastAction = 'confirmed_order';
                memory.awaitingField = 'order_finalized';
                break;
            case 'ask_continue_or_checkout':
                memory.lastAction = 'asked_continue_or_checkout';
                memory.awaitingField = 'add_more_or_checkout';
                break;
        }
    }
    buildOrderPayload(input, memory, classification) {
        const cartItems = memory.cartItems ?? [];
        if (cartItems.length === 0) {
            const productId = memory.selectedProductId;
            const variantId = memory.selectedVariantId;
            if (!productId || !variantId) {
                this.logger.warn(`Cannot build order payload: no cart items and missing productId=${productId} variantId=${variantId}`);
                return null;
            }
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
            cartItems.push({
                productId,
                variantId,
                externalProductId,
                externalVariantId,
                title: memory.selectedProductTitle ?? '',
                variantName: memory.selectedVariantName ?? '',
                price: unitPrice,
                currency: 'UAH',
            });
        }
        if (cartItems.length === 0)
            return null;
        const customerName = classification.entities.customerName ?? '';
        const phone = classification.entities.phone ?? '';
        const city = classification.entities.city ?? '';
        const deliveryBranch = classification.entities.deliveryBranch ?? '';
        const items = cartItems.map(item => ({
            productId: item.productId,
            variantId: item.variantId,
            externalProductId: item.externalProductId,
            externalVariantId: item.externalVariantId,
            title: item.title,
            variantTitle: item.variantName,
            quantity: 1,
            unitPrice: item.price,
            currency: item.currency,
        }));
        return {
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            customerId: input.state.conversationId,
            items,
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
            `6. If a product (or a specific attribute like color/size/material) was not found, say so plainly and offer to check — do NOT name a product from memory unless its listed variants exactly match what the customer asked for.`,
            `7. Lead the conversation forward.`,
            `8. NEVER greet mid-conversation.`,
            `9. Keep replies SHORT (1-3 sentences max).`,
            `10. NEVER confirm an order, say "замовлення оформлено", "в обробці", "дані отримала", or imply an order exists unless ALL of these are true: selectedProductId exists, checkout is in progress, system is expecting delivery details.`,
            `11. NEVER invent product variants, colors, prices, sizes, materials, or any product detail that does not appear verbatim in the "Products shown" memory or "Product data from database" section above. If the customer asks for an attribute (color, size, material) that none of the listed products have, say so plainly and offer to check the broader catalog. Examples of correct replies: "У показаних немає чорних — пошукати в каталозі ширше?" / "Серед цих немає вашого розміру." Examples of FORBIDDEN replies: claiming a color, size, or material exists for a product when its listed variants don't include it.`,
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
                return `${details || 'standard'}: ${v.price} ${(0, format_1.formatCurrency)(v.currency)} (${stock})`;
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
    async handleSizeChartRequest(input, ctx) {
        if (ctx.classification.primaryIntent !== 'size_chart_request')
            return null;
        const memory = ctx.memory;
        const entities = ctx.classification.entities;
        let brand = null;
        let category = entities.category ?? memory.selectedCategory ?? null;
        const contextProductId = ctx.mediaProductData?.[0]?.product?.id ?? memory.selectedProductId ?? null;
        if (contextProductId) {
            const info = await this.sizeChartsService.getBrandAndCategoryForProduct(input.tenantId, contextProductId);
            brand = info.brand ?? brand;
            category = info.category ?? category;
        }
        const chart = await this.sizeChartsService.resolveForContext(input.tenantId, {
            brand,
            category,
        });
        const flowConfig = ctx.effectiveConfig?.flowConfig;
        const businessType = flowConfig?.businessType ?? 'clothing';
        const numericChart = flowConfig?.sizeChart;
        const askingForHelp = ctx.classification.dialogueAct === 'ask_recommendation';
        if (askingForHelp &&
            businessType === 'clothing' &&
            flowConfig?.preQualify?.enabled &&
            !memory.preQualifyCollected &&
            numericChart &&
            Object.keys(numericChart).length > 0) {
            memory.lastAction = 'asked_pre_qualify';
            memory.awaitingField = 'pre_qualify_data';
            ctx.trace.push('size_chart_request: help-style → ask for measurements');
            let extraReplies;
            if (chart) {
                const chartUrl = chart.imagePath.startsWith('/')
                    ? chart.imagePath
                    : `/${chart.imagePath}`;
                extraReplies = [
                    {
                        text: 'Надсилаю вам розмірну сітку 💛',
                        sendNow: true,
                        imageUrls: [chartUrl],
                    },
                ];
            }
            return {
                decision: shared_1.ReplyDecision.Reply,
                reply: { text: ASK_FOR_MEASUREMENTS_HELP, sendNow: true },
                extraReplies,
                handoff: { required: false, reason: null },
                stateUpdate: { contextJson: memory },
            };
        }
        if (!chart) {
            ctx.trace.push('size_chart_request: no chart matched → silent handoff');
            this.logToFile({
                event: 'size_chart_no_match',
                conversationId: input.conversationId,
                inbound: input.messageText,
                brand,
                category,
            });
            return this.doHandoff(input, 'size_chart_not_available');
        }
        const variables = { name: chart.name };
        if (brand)
            variables.brand = brand;
        const rendered = await this.templateEngine.renderCustomScenario(input.tenantId, 'show_size_chart', variables);
        const text = rendered?.text ?? 'Ось наша розмірна сітка 💛';
        const publicUrl = this.sizeChartsService.publicUrl(chart.imagePath);
        ctx.trace.push(`size_chart_request: resolved chart ${chart.id} (brand=${brand ?? '-'}, category=${category ?? '-'})`);
        await this.auditService.log({
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            type: shared_1.AuditLogType.AiDecision,
            details: {
                decision: shared_1.ReplyDecision.Reply,
                intent: 'size_chart_request',
                templateId: rendered?.templateId ?? 'no_template',
                chartId: chart.id,
            },
        });
        this.logToFile({
            event: 'size_chart_sent',
            conversationId: input.conversationId,
            inbound: input.messageText,
            chartId: chart.id,
            chartName: chart.name,
            imageUrl: publicUrl,
            brand,
            category,
        });
        return {
            decision: shared_1.ReplyDecision.Reply,
            reply: { text, sendNow: true, imageUrls: [publicUrl] },
            handoff: { required: false, reason: null },
            stateUpdate: null,
            templateScenario: rendered?.scenario ?? 'show_size_chart',
        };
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
ReplyEngineService.TITLE_STOP_WORDS = new Set([
    'енд', 'and', '&', 'і', 'та', 'для', 'від', 'з', 'на',
]);
ReplyEngineService.TITLE_GENERIC_NOUNS = new Set([
    'топ', 'сукня', 'штани', 'светр', 'сорочка', 'футболка',
    'куртка', 'юбка', 'блуза', 'спідниця', 'жакет',
]);
ReplyEngineService.COLOR_TRANSLATIONS = {
    'чорний': 'black', 'чорна': 'black', 'чорне': 'black',
    'білий': 'white', 'біла': 'white', 'біле': 'white',
    'синій': 'blue', 'синя': 'blue', 'синє': 'blue',
    'червоний': 'red', 'червона': 'red', 'червоне': 'red',
    'зелений': 'green', 'зелена': 'green', 'зелене': 'green',
    'сірий': 'grey', 'сіра': 'grey', 'сіре': 'grey',
    'рожевий': 'pink', 'рожева': 'pink', 'рожеве': 'pink',
    'бежевий': 'beige', 'бежева': 'beige', 'бежеве': 'beige',
    'коричневий': 'brown', 'коричнева': 'brown', 'коричневе': 'brown',
    'жовтий': 'yellow', 'жовта': 'yellow', 'жовте': 'yellow',
    'фіолетовий': 'purple', 'фіолетова': 'purple', 'фіолетове': 'purple',
    'помаранчевий': 'orange', 'помаранчева': 'orange', 'помаранчеве': 'orange',
    'кремовий': 'cream', 'кремова': 'cream', 'кремове': 'cream',
    'хакі': 'khaki',
    'black': 'чорний', 'white': 'білий', 'blue': 'синій',
    'red': 'червоний', 'green': 'зелений', 'grey': 'сірий', 'gray': 'сірий',
    'pink': 'рожевий', 'beige': 'бежевий', 'brown': 'коричневий',
    'yellow': 'жовтий', 'purple': 'фіолетовий', 'orange': 'помаранчевий',
    'cream': 'кремовий', 'khaki': 'хакі',
};
exports.ReplyEngineService = ReplyEngineService = ReplyEngineService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(tenant_settings_entity_1.TenantSettings)),
    __param(1, (0, typeorm_1.InjectRepository)(manager_example_entity_1.ManagerExample)),
    __param(2, (0, typeorm_1.InjectRepository)(store_config_entity_1.StoreConfig)),
    __param(10, (0, common_1.Inject)((0, common_1.forwardRef)(() => subscriptions_service_1.SubscriptionsService))),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        availability_service_1.AvailabilityService,
        audit_service_1.AuditService,
        classifier_service_1.ClassifierService,
        template_engine_service_1.TemplateEngineService,
        policy_engine_service_1.PolicyEngineService,
        config_1.ConfigService,
        instagram_content_service_1.InstagramContentService,
        subscriptions_service_1.SubscriptionsService,
        size_charts_service_1.SizeChartsService])
], ReplyEngineService);
//# sourceMappingURL=reply-engine.service.js.map