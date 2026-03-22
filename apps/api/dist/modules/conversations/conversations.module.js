"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationsModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const conversation_entity_1 = require("./entities/conversation.entity");
const customer_entity_1 = require("./entities/customer.entity");
const message_entity_1 = require("./entities/message.entity");
const conversation_state_entity_1 = require("./entities/conversation-state.entity");
const tenant_settings_entity_1 = require("../tenants/entities/tenant-settings.entity");
const manager_example_entity_1 = require("../settings/entities/manager-example.entity");
const conversations_service_1 = require("./conversations.service");
const reply_engine_service_1 = require("./reply-engine.service");
const conversations_controller_1 = require("./conversations.controller");
const conversation_reply_controller_1 = require("./conversation-reply.controller");
const availability_module_1 = require("../availability/availability.module");
const audit_module_1 = require("../audit/audit.module");
let ConversationsModule = class ConversationsModule {
};
exports.ConversationsModule = ConversationsModule;
exports.ConversationsModule = ConversationsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                conversation_entity_1.Conversation,
                customer_entity_1.Customer,
                message_entity_1.Message,
                conversation_state_entity_1.ConversationState,
                tenant_settings_entity_1.TenantSettings,
                manager_example_entity_1.ManagerExample,
            ]),
            availability_module_1.AvailabilityModule,
            audit_module_1.AuditModule,
        ],
        controllers: [conversations_controller_1.ConversationsController, conversation_reply_controller_1.ConversationReplyController],
        providers: [conversations_service_1.ConversationsService, reply_engine_service_1.ReplyEngineService],
        exports: [conversations_service_1.ConversationsService, reply_engine_service_1.ReplyEngineService],
    })
], ConversationsModule);
//# sourceMappingURL=conversations.module.js.map