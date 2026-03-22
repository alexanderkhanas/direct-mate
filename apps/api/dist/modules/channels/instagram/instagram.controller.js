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
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstagramController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const instagram_service_1 = require("./instagram.service");
let InstagramController = class InstagramController {
    constructor(instagramService) {
        this.instagramService = instagramService;
    }
    verifyWebhook(mode, token, challenge) {
        console.log('[WEBHOOK] GET verify:', { mode, token, challenge });
        return this.instagramService.verifyWebhook(mode, token, challenge);
    }
    async handleWebhook(req, signature, body) {
        console.log('[WEBHOOK] POST /channels/instagram/webhook', JSON.stringify(body).substring(0, 800));
        console.log('[WEBHOOK] signature:', signature ? 'present' : 'none');
        if (req.rawBody && signature) {
            const valid = this.instagramService.verifySignature(req.rawBody, signature);
            console.log('[WEBHOOK] signature valid:', valid);
            if (!valid) {
                console.log('[WEBHOOK] REJECTED - invalid signature');
                throw new common_1.UnauthorizedException('Invalid webhook signature');
            }
        }
        this.instagramService.handleWebhook(body).catch((err) => {
            console.error('[WEBHOOK] handleWebhook error:', err);
        });
        return { received: true };
    }
};
exports.InstagramController = InstagramController;
__decorate([
    (0, common_1.Get)('webhook'),
    __param(0, (0, common_1.Query)('hub.mode')),
    __param(1, (0, common_1.Query)('hub.verify_token')),
    __param(2, (0, common_1.Query)('hub.challenge')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], InstagramController.prototype, "verifyWebhook", null);
__decorate([
    (0, common_1.Post)('webhook'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Headers)('x-hub-signature-256')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], InstagramController.prototype, "handleWebhook", null);
exports.InstagramController = InstagramController = __decorate([
    (0, swagger_1.ApiTags)('channels'),
    (0, common_1.Controller)('channels/instagram'),
    __metadata("design:paramtypes", [instagram_service_1.InstagramService])
], InstagramController);
//# sourceMappingURL=instagram.controller.js.map