"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentUser = void 0;
const common_1 = require("@nestjs/common");
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
exports.CurrentUser = (0, common_1.createParamDecorator)((_data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    if (user?.role === 'superadmin') {
        const overrideTenantId = request.headers['x-tenant-id'];
        if (overrideTenantId && UUID_REGEX.test(overrideTenantId)) {
            return { ...user, tenantId: overrideTenantId };
        }
    }
    return user;
});
//# sourceMappingURL=current-user.decorator.js.map