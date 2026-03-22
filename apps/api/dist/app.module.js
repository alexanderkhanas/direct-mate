"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const database_module_1 = require("./database/database.module");
const configuration_1 = require("./config/configuration");
const validation_schema_1 = require("./config/validation.schema");
const auth_module_1 = require("./modules/auth/auth.module");
const tenants_module_1 = require("./modules/tenants/tenants.module");
const conversations_module_1 = require("./modules/conversations/conversations.module");
const catalog_module_1 = require("./modules/catalog/catalog.module");
const availability_module_1 = require("./modules/availability/availability.module");
const reservations_module_1 = require("./modules/reservations/reservations.module");
const orders_module_1 = require("./modules/orders/orders.module");
const channels_module_1 = require("./modules/channels/channels.module");
const integrations_module_1 = require("./modules/integrations/integrations.module");
const settings_module_1 = require("./modules/settings/settings.module");
const audit_module_1 = require("./modules/audit/audit.module");
const internal_module_1 = require("./modules/internal/internal.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [configuration_1.default],
                validationSchema: validation_schema_1.validationSchema,
                validationOptions: { allowUnknown: true },
            }),
            schedule_1.ScheduleModule.forRoot(),
            database_module_1.DatabaseModule,
            auth_module_1.AuthModule,
            tenants_module_1.TenantsModule,
            conversations_module_1.ConversationsModule,
            catalog_module_1.CatalogModule,
            availability_module_1.AvailabilityModule,
            reservations_module_1.ReservationsModule,
            orders_module_1.OrdersModule,
            channels_module_1.ChannelsModule,
            integrations_module_1.IntegrationsModule,
            settings_module_1.SettingsModule,
            audit_module_1.AuditModule,
            internal_module_1.InternalModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map