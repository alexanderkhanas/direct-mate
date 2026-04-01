"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChannelsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const instagram_controller_1 = require("./instagram/instagram.controller");
const instagram_service_1 = require("./instagram/instagram.service");
const conversations_module_1 = require("../conversations/conversations.module");
const integrations_module_1 = require("../integrations/integrations.module");
const orders_module_1 = require("../orders/orders.module");
const crypto_service_1 = require("../../common/crypto.service");
const notifications_module_1 = require("../notifications/notifications.module");
const instagram_content_module_1 = require("./instagram/instagram-content.module");
const pending_message_entity_1 = require("./instagram/entities/pending-message.entity");
const conversation_entity_1 = require("../conversations/entities/conversation.entity");
let ChannelsModule = class ChannelsModule {
};
exports.ChannelsModule = ChannelsModule;
exports.ChannelsModule = ChannelsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([pending_message_entity_1.PendingMessage, conversation_entity_1.Conversation]),
            conversations_module_1.ConversationsModule, integrations_module_1.IntegrationsModule, orders_module_1.OrdersModule, notifications_module_1.NotificationsModule, instagram_content_module_1.InstagramContentModule,
        ],
        controllers: [instagram_controller_1.InstagramController],
        providers: [instagram_service_1.InstagramService, crypto_service_1.CryptoService],
    })
], ChannelsModule);
//# sourceMappingURL=channels.module.js.map