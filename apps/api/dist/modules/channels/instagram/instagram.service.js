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
var InstagramService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstagramService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const crypto = require("crypto");
const conversations_service_1 = require("../../conversations/conversations.service");
const reply_engine_service_1 = require("../../conversations/reply-engine.service");
const integrations_service_1 = require("../../integrations/integrations.service");
const orders_service_1 = require("../../orders/orders.service");
const crypto_service_1 = require("../../../common/crypto.service");
const telegram_service_1 = require("../../notifications/telegram.service");
const pending_message_entity_1 = require("./entities/pending-message.entity");
const conversation_entity_1 = require("../../conversations/entities/conversation.entity");
const store_config_entity_1 = require("../../engine/entities/store-config.entity");
const learning_observer_service_1 = require("../../screenshot-training/learning-observer.service");
const shared_1 = require("@direct-mate/shared");
const retry_1 = require("../../../common/retry");
const DEBOUNCE_MS = 10_000;
let InstagramService = InstagramService_1 = class InstagramService {
    constructor(config, conversationsService, replyEngineService, integrationsService, ordersService, cryptoService, telegramService, pendingMessageRepo, conversationRepo, storeConfigRepo, learningObserver, dataSource) {
        this.config = config;
        this.conversationsService = conversationsService;
        this.replyEngineService = replyEngineService;
        this.integrationsService = integrationsService;
        this.ordersService = ordersService;
        this.cryptoService = cryptoService;
        this.telegramService = telegramService;
        this.pendingMessageRepo = pendingMessageRepo;
        this.conversationRepo = conversationRepo;
        this.storeConfigRepo = storeConfigRepo;
        this.learningObserver = learningObserver;
        this.dataSource = dataSource;
        this.logger = new common_1.Logger(InstagramService_1.name);
        this.recentSentMids = new Set();
        this.pollInterval = null;
    }
    async onModuleInit() {
        const overdue = await this.conversationRepo.find({
            where: {
                status: shared_1.ConversationStatus.HumanInControl,
                autoResumeAt: (0, typeorm_2.LessThanOrEqual)(new Date()),
            },
        });
        for (const conv of overdue) {
            await this.conversationsService.release(conv.id);
            await this.conversationRepo.update(conv.id, { autoResumeAt: null });
            this.logger.log(`Startup recovery: auto-resumed conversation ${conv.id}`);
        }
        this.pollInterval = setInterval(() => this.pollTasks(), 2_000);
    }
    onModuleDestroy() {
        if (this.pollInterval)
            clearInterval(this.pollInterval);
    }
    async pollTasks() {
        try {
            await this.flushReadyMessages();
            await this.autoResumeExpired();
        }
        catch (err) {
            this.logger.error('Poll tasks error', err.message);
        }
    }
    async flushReadyMessages() {
        const ready = await this.pendingMessageRepo
            .createQueryBuilder('pm')
            .select('DISTINCT pm.debounce_key', 'debounceKey')
            .where('pm.flush_at <= :now', { now: new Date() })
            .getRawMany();
        for (const { debounceKey } of ready) {
            await this.flushPending(debounceKey);
        }
    }
    async autoResumeExpired() {
        const expired = await this.conversationRepo.find({
            where: {
                status: shared_1.ConversationStatus.HumanInControl,
                autoResumeAt: (0, typeorm_2.LessThanOrEqual)(new Date()),
            },
        });
        for (const conv of expired) {
            try {
                await this.conversationsService.release(conv.id);
                await this.conversationRepo.update(conv.id, { autoResumeAt: null });
                this.logger.log(`Auto-resumed conversation ${conv.id} after timeout`);
            }
            catch (err) {
                this.logger.error(`Auto-resume failed for ${conv.id}`, err);
            }
        }
    }
    async sendMetaMessage(recipientId, text, pageAccessToken) {
        const res = await fetch('https://graph.instagram.com/v21.0/me/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${pageAccessToken}`,
            },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { text },
            }),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Meta API error ${res.status}: ${body}`);
        }
        const body = await res.json();
        const mid = body.message_id ?? null;
        if (mid) {
            this.recentSentMids.add(mid);
            setTimeout(() => this.recentSentMids.delete(mid), 5 * 60 * 1000);
        }
        return mid;
    }
    async sendMetaImages(recipientId, imageUrls, pageAccessToken) {
        const res = await fetch('https://graph.instagram.com/v21.0/me/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${pageAccessToken}`,
            },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: {
                    attachments: imageUrls.map((url) => ({
                        type: 'image',
                        payload: { url },
                    })),
                },
            }),
        });
        if (!res.ok) {
            const body = await res.text();
            this.logger.error(`Meta API images send error ${res.status}: ${body}`);
            return;
        }
        const body = await res.json();
        if (body.message_id) {
            this.recentSentMids.add(body.message_id);
            setTimeout(() => this.recentSentMids.delete(body.message_id), 5 * 60 * 1000);
        }
    }
    verifySignature(rawBody, signature) {
        const appSecret = this.config.get('meta.appSecret') ?? '';
        if (!appSecret) {
            this.logger.error('META_APP_SECRET is not configured — rejecting webhook');
            return false;
        }
        const expected = `sha256=${crypto
            .createHmac('sha256', appSecret)
            .update(rawBody)
            .digest('hex')}`;
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    }
    verifyWebhook(mode, token, challenge) {
        const verifyToken = this.config.get('meta.webhookVerifyToken') ?? '';
        if (mode === 'subscribe' && token === verifyToken) {
            return challenge;
        }
        throw new common_1.UnauthorizedException('Webhook verification failed');
    }
    async fetchMessageFromApi(messageId, accessToken) {
        try {
            const res = await fetch(`https://graph.instagram.com/v21.0/${messageId}?fields=from,to,message&access_token=${accessToken}`);
            if (!res.ok) {
                const errBody = await res.text();
                this.logger.warn(`Failed to fetch message ${messageId}: ${res.status} - ${errBody}`);
                return null;
            }
            return await res.json();
        }
        catch (err) {
            this.logger.error(`Error fetching message ${messageId}`, err);
            return null;
        }
    }
    extractMediaReference(message) {
        if (!message)
            return null;
        if (message.reply_to?.story?.id) {
            return { mediaId: message.reply_to.story.id, type: 'story_reply' };
        }
        if (message.reply_to?.mid) {
            return { mediaId: message.reply_to.mid, type: 'post_reply' };
        }
        if (message.attachments?.length) {
            const mediaAttachment = message.attachments.find((a) => a.type === 'image' || a.type === 'video');
            if (mediaAttachment) {
                return {
                    mediaId: mediaAttachment.payload?.url ?? 'unknown',
                    type: 'customer_photo',
                };
            }
        }
        return null;
    }
    async handleWebhook(payload) {
        if (payload.object !== 'instagram')
            return;
        for (const entry of payload.entry) {
            const entryId = entry.id;
            for (const messaging of entry.messaging ?? []) {
                this.logger.debug(`Webhook messaging: is_echo=${messaging.message?.is_echo}, sender=${messaging.sender?.id}, text="${messaging.message?.text?.substring(0, 30)}"`);
                if (messaging.message?.is_echo) {
                    const mid = messaging.message.mid;
                    if (this.recentSentMids.has(mid)) {
                        this.recentSentMids.delete(mid);
                        continue;
                    }
                    await this.handleManagerReply(messaging, entryId ?? '').catch(err => this.logger.error('handleManagerReply failed', err));
                    continue;
                }
                if (messaging.message && messaging.sender && messaging.recipient) {
                    const mediaRef = this.extractMediaReference(messaging.message);
                    const text = messaging.message.text ?? '';
                    if (!text && !mediaRef)
                        continue;
                    await this.handleIncomingMessage(messaging.sender.id, messaging.recipient.id, messaging.message.mid, text, mediaRef);
                    continue;
                }
                if (messaging.message_edit && messaging.message_edit.num_edit === 0) {
                    this.logger.log(`Received message_edit (num_edit=0), fetching message content...`);
                    const connection = await this.integrationsService.findByExternalAccountId(entryId ?? '', shared_1.ConnectionType.Instagram);
                    if (!connection) {
                        this.logger.warn(`No connection for entry id ${entryId}`);
                        continue;
                    }
                    if (!connection.accessTokenEncrypted) {
                        this.logger.warn(`No access token for connection ${connection.id}`);
                        continue;
                    }
                    const accessToken = this.cryptoService.decrypt(connection.accessTokenEncrypted);
                    const msgData = await this.fetchMessageFromApi(messaging.message_edit.mid, accessToken);
                    if (!msgData || !msgData.message) {
                        this.logger.warn(`Could not fetch message content for ${messaging.message_edit.mid}`);
                        continue;
                    }
                    const senderId = msgData.from?.id;
                    const recipientId = msgData.to?.data?.[0]?.id;
                    if (senderId === entryId || senderId === connection.externalAccountId) {
                        this.logger.log(`Skipping own message`);
                        continue;
                    }
                    if (senderId && recipientId) {
                        await this.handleIncomingMessage(senderId, recipientId, messaging.message_edit.mid, msgData.message);
                    }
                    continue;
                }
            }
        }
    }
    async handleIncomingMessage(externalUserId, channelAccountId, messageId, messageText, mediaReference) {
        let connection = await this.integrationsService.findByExternalAccountId(channelAccountId, shared_1.ConnectionType.Instagram);
        if (!connection) {
            connection = await this.integrationsService.findByExternalAccountId(externalUserId, shared_1.ConnectionType.Instagram);
            if (connection) {
                this.logger.log(`Skipping own outbound message`);
                return;
            }
            this.logger.warn(`No connected Instagram account for ${channelAccountId} — skipping`);
            return;
        }
        const customer = await this.conversationsService.findOrCreateCustomer(connection.tenantId, 'instagram', externalUserId);
        const { conversation, state } = await this.conversationsService.findOrCreateConversation(connection.tenantId, customer.id, 'instagram', channelAccountId);
        await this.conversationsService.saveMessage(conversation.id, connection.tenantId, shared_1.MessageDirection.Inbound, shared_1.MessageRole.User, messageText, messageId);
        if (messageText) {
            const storeConfig = await this.storeConfigRepo.findOne({ where: { tenantId: connection.tenantId } });
            if (storeConfig?.operatingMode === 'learning') {
                this.learningObserver.recordCustomerMessage(conversation.id, messageText);
                this.runLearningDryRun(connection.tenantId, conversation.id, messageText, state).catch((err) => this.logger.error(`Learning dry-run failed: ${err}`));
            }
        }
        const debounceKey = `${externalUserId}:${channelAccountId}`;
        const flushAt = new Date(Date.now() + DEBOUNCE_MS);
        await this.pendingMessageRepo
            .createQueryBuilder()
            .update(pending_message_entity_1.PendingMessage)
            .set({ flushAt })
            .where('debounce_key = :debounceKey', { debounceKey })
            .execute();
        await this.pendingMessageRepo.save({
            debounceKey,
            tenantId: connection.tenantId,
            externalUserId,
            channelAccountId,
            connectionId: connection.id,
            messageId,
            messageText,
            mediaReference: mediaReference,
            flushAt,
        });
        this.logger.log(`Debounce: saved message for ${debounceKey}, flush at ${flushAt.toISOString()}`);
    }
    async flushPending(debounceKey) {
        const messages = await this.pendingMessageRepo.find({
            where: { debounceKey },
            order: { createdAt: 'ASC' },
        });
        if (messages.length === 0)
            return;
        await this.pendingMessageRepo.delete({ debounceKey });
        const combinedText = messages.map((m) => m.messageText).join('\n');
        const mediaRef = messages.find((m) => m.mediaReference)?.mediaReference ?? null;
        const first = messages[0];
        this.logger.log(`Debounce: processing ${messages.length} message(s) for ${debounceKey}: "${combinedText.substring(0, 100)}"`);
        const connection = await this.integrationsService.findById(first.connectionId);
        if (!connection) {
            this.logger.warn(`Connection ${first.connectionId} not found during flush — skipping`);
            return;
        }
        try {
            await this.processInbound({
                tenantId: first.tenantId,
                externalUserId: first.externalUserId,
                channelAccountId: first.channelAccountId,
                messageText: combinedText,
                connection,
                mediaReference: mediaRef,
            });
        }
        catch (err) {
            this.logger.error(`Failed to process debounced messages for ${debounceKey}`, err);
        }
    }
    async processInbound(params) {
        const customer = await this.conversationsService.findOrCreateCustomer(params.tenantId, 'instagram', params.externalUserId);
        if (!customer.username && params.connection.accessTokenEncrypted) {
            try {
                const token = this.cryptoService.decrypt(params.connection.accessTokenEncrypted);
                const res = await fetch(`https://graph.instagram.com/v21.0/${params.externalUserId}?fields=username,name`, { headers: { Authorization: `Bearer ${token}` } });
                if (res.ok) {
                    const profile = await res.json();
                    if (profile.username)
                        customer.username = profile.username;
                    if (profile.name)
                        customer.fullName = profile.name;
                    await this.conversationsService.updateCustomer(customer.id, {
                        username: profile.username ?? null,
                        fullName: profile.name ?? null,
                    });
                }
            }
            catch {
            }
        }
        const { conversation, state } = await this.conversationsService.findOrCreateConversation(params.tenantId, customer.id, 'instagram', params.channelAccountId);
        const lockKey = this.conversationLockKey(conversation.id);
        await this.dataSource.query(`SELECT pg_advisory_lock($1)`, [lockKey]);
        try {
            const freshState = await this.conversationsService.getState(conversation.id);
            const currentConv = await this.conversationRepo.findOne({ where: { id: conversation.id } });
            if (currentConv?.status === shared_1.ConversationStatus.HumanInControl) {
                this.logger.log(`Skipping bot reply — conversation ${conversation.id} is human_in_control`);
                return;
            }
            const storeConfig = await this.storeConfigRepo.findOne({ where: { tenantId: params.tenantId } });
            if (storeConfig?.operatingMode === 'learning') {
                return;
            }
            const recentMessages = (await this.conversationsService.findById(conversation.id)).messages
                .slice(-10)
                .map((m) => ({ role: m.role, text: m.text }));
            const result = await this.replyEngineService.process({
                tenantId: params.tenantId,
                conversationId: conversation.id,
                messageText: params.messageText,
                state: freshState ?? state,
                recentMessages,
                mediaReference: params.mediaReference ? {
                    mediaId: params.mediaReference.mediaId,
                    type: params.mediaReference.type,
                } : undefined,
            });
            if (result.stateUpdate) {
                await this.conversationsService.updateState(conversation.id, result.stateUpdate);
            }
            if (result.handoff.required) {
                await this.conversationsService.escalate(conversation.id, result.handoff.reason ?? 'unknown');
                const handoffMessage = 'Секунду, уточню для вас інформацію 🙏';
                await this.conversationsService.saveMessage(conversation.id, params.tenantId, shared_1.MessageDirection.Outbound, shared_1.MessageRole.Assistant, handoffMessage);
                const encryptedToken = params.connection.accessTokenEncrypted;
                if (encryptedToken) {
                    const pageAccessToken = this.cryptoService.decrypt(encryptedToken);
                    await this.sendMetaMessage(params.externalUserId, handoffMessage, pageAccessToken).catch((err) => {
                        this.logger.error('Failed to send handoff message', err);
                    });
                }
                (0, retry_1.withRetry)(() => this.telegramService.notifyHandoff({
                    tenantId: params.tenantId,
                    customerName: customer.username ? `@${customer.username}` : customer.fullName || params.externalUserId,
                    reason: result.handoff.reason ?? 'unknown',
                    conversationId: conversation.id,
                    lastMessage: params.messageText,
                }), { label: `telegram-handoff-${conversation.id}` }).catch(err => this.logger.error('Telegram notification failed after retries', err));
                this.logger.log(`HANDOFF: conversation ${conversation.id}, reason: ${result.handoff.reason}`);
                return;
            }
            if (result.reply?.sendNow && result.reply.text) {
                await this.conversationsService.saveMessage(conversation.id, params.tenantId, shared_1.MessageDirection.Outbound, shared_1.MessageRole.Assistant, result.reply.text);
                const encryptedToken = params.connection.accessTokenEncrypted;
                if (encryptedToken) {
                    const pageAccessToken = this.cryptoService.decrypt(encryptedToken);
                    try {
                        if (result.reply.imageUrls?.length) {
                            await this.sendMetaImages(params.externalUserId, result.reply.imageUrls, pageAccessToken);
                            this.logger.log(`Sent ${result.reply.imageUrls.length} product image(s) in one message to ${params.externalUserId}`);
                        }
                        await this.sendMetaMessage(params.externalUserId, result.reply.text, pageAccessToken);
                        this.logger.log(`Message sent to ${params.externalUserId} via Meta Graph API`);
                    }
                    catch (err) {
                        this.logger.error(`Failed to send to Meta API for conversation ${conversation.id}`, err);
                        await this.conversationsService.escalate(conversation.id, 'send_failed');
                    }
                }
                else {
                    this.logger.warn(`No access token for connection — cannot send message to Meta`);
                }
            }
            if (result.decision === shared_1.ReplyDecision.CreateDraftOrder && result.orderPayload) {
                try {
                    const orderPayload = {
                        ...result.orderPayload,
                        customerId: customer.id,
                    };
                    const order = await this.ordersService.createFromConversation(orderPayload);
                    this.logger.log(`Order created: ${order.id} for conversation ${conversation.id}`);
                    (0, retry_1.withRetry)(() => this.ordersService.triggerExternalSync(order), { label: `order-sync-${order.id}` }).catch((err) => {
                        this.logger.error(`External sync trigger failed for order ${order.id} after retries`, err.message);
                    });
                }
                catch (err) {
                    this.logger.error(`Order creation failed for conversation ${conversation.id}`, err.message);
                }
            }
        }
        finally {
            await this.dataSource.query(`SELECT pg_advisory_unlock($1)`, [lockKey]);
        }
    }
    async runLearningDryRun(tenantId, conversationId, messageText, state) {
        const recentMessages = (await this.conversationsService.findById(conversationId)).messages
            .slice(-10)
            .map((m) => ({ role: m.role, text: m.text }));
        const dryRun = await this.replyEngineService.process({
            tenantId,
            conversationId,
            messageText,
            state,
            recentMessages,
        });
        this.learningObserver.recordBotAnalysis(conversationId, {
            classification: dryRun.classification
                ? dryRun.classification
                : null,
            botReply: dryRun.reply?.text ?? (dryRun.handoff.required ? `[handoff: ${dryRun.handoff.reason}]` : null),
            templateScenario: dryRun.templateScenario ?? (dryRun.handoff.required ? 'handoff' : null),
        });
        this.logger.log(`Learning dry-run complete for conversation ${conversationId}: template=${dryRun.templateScenario ?? 'none'}`);
    }
    conversationLockKey(conversationId) {
        let hash = 0;
        for (let i = 0; i < conversationId.length; i++) {
            hash = ((hash << 5) - hash + conversationId.charCodeAt(i)) | 0;
        }
        return hash;
    }
    async handleManagerReply(messaging, channelAccountId) {
        const customerId = messaging.recipient?.id;
        if (!customerId)
            return;
        const connection = await this.integrationsService.findByExternalAccountId(channelAccountId, shared_1.ConnectionType.Instagram);
        if (!connection)
            return;
        const customer = await this.conversationsService.findCustomer(connection.tenantId, 'instagram', customerId);
        if (!customer)
            return;
        const conversation = await this.conversationsService.findConversationByCustomer(connection.tenantId, customer.id, 'instagram', channelAccountId);
        if (!conversation)
            return;
        const managerText = messaging.message?.text ?? '';
        await this.conversationsService.saveMessage(conversation.id, connection.tenantId, shared_1.MessageDirection.Outbound, shared_1.MessageRole.Manager, managerText, messaging.message?.mid);
        const storeConfig = await this.storeConfigRepo.findOne({ where: { tenantId: connection.tenantId } });
        if (storeConfig?.operatingMode === 'learning' && managerText) {
            await this.learningObserver.recordManagerReply(connection.tenantId, conversation.id, managerText);
        }
        if (conversation.status !== shared_1.ConversationStatus.HumanInControl) {
            await this.conversationsService.takeover(conversation.id, null, 'auto_detected');
            this.logger.log(`Manager reply detected → conversation ${conversation.id} set to human_in_control`);
        }
        await this.setAutoResumeDeadline(conversation.id);
    }
    async setAutoResumeDeadline(conversationId, delayMs = 30 * 60 * 1000) {
        const autoResumeAt = new Date(Date.now() + delayMs);
        await this.conversationRepo.update(conversationId, { autoResumeAt });
        this.logger.log(`Auto-resume set for ${conversationId} at ${autoResumeAt.toISOString()}`);
    }
};
exports.InstagramService = InstagramService;
exports.InstagramService = InstagramService = InstagramService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(7, (0, typeorm_1.InjectRepository)(pending_message_entity_1.PendingMessage)),
    __param(8, (0, typeorm_1.InjectRepository)(conversation_entity_1.Conversation)),
    __param(9, (0, typeorm_1.InjectRepository)(store_config_entity_1.StoreConfig)),
    __metadata("design:paramtypes", [config_1.ConfigService,
        conversations_service_1.ConversationsService,
        reply_engine_service_1.ReplyEngineService,
        integrations_service_1.IntegrationsService,
        orders_service_1.OrdersService,
        crypto_service_1.CryptoService,
        telegram_service_1.TelegramService,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        learning_observer_service_1.LearningObserverService,
        typeorm_2.DataSource])
], InstagramService);
//# sourceMappingURL=instagram.service.js.map