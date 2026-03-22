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
exports.SettingsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const tenant_settings_entity_1 = require("../tenants/entities/tenant-settings.entity");
const manager_example_entity_1 = require("./entities/manager-example.entity");
let SettingsService = class SettingsService {
    constructor(settingsRepo, examplesRepo) {
        this.settingsRepo = settingsRepo;
        this.examplesRepo = examplesRepo;
    }
    async getSettings(tenantId) {
        return this.settingsRepo.findOne({ where: { tenantId } });
    }
    async updateSettings(tenantId, dto) {
        const existing = await this.settingsRepo.findOne({ where: { tenantId } });
        const patch = {};
        if (dto.brandTone !== undefined)
            patch.brandTonePrompt = dto.brandTone;
        if (dto.businessHours !== undefined)
            patch.businessHours = dto.businessHours;
        if (dto.handoffRules !== undefined)
            patch.handoffRules = dto.handoffRules;
        if (dto.supportedLanguages !== undefined)
            patch.supportedLanguages = dto.supportedLanguages;
        if (existing) {
            await this.settingsRepo.update(existing.id, patch);
        }
        else {
            const settings = this.settingsRepo.create({ tenantId, ...patch });
            await this.settingsRepo.save(settings);
        }
        return { success: true };
    }
    async getExamples(tenantId) {
        return this.examplesRepo.find({ where: { tenantId, isActive: true } });
    }
    async createExample(tenantId, data) {
        const example = this.examplesRepo.create({ tenantId, ...data });
        return this.examplesRepo.save(example);
    }
    async deleteExample(id) {
        await this.examplesRepo.update(id, { isActive: false });
        return { success: true };
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(tenant_settings_entity_1.TenantSettings)),
    __param(1, (0, typeorm_1.InjectRepository)(manager_example_entity_1.ManagerExample)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], SettingsService);
//# sourceMappingURL=settings.service.js.map