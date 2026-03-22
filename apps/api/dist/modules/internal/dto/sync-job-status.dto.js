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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncJobStatusDto = exports.SyncJobUpdateStatus = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
var SyncJobUpdateStatus;
(function (SyncJobUpdateStatus) {
    SyncJobUpdateStatus["Success"] = "success";
    SyncJobUpdateStatus["Failed"] = "failed";
})(SyncJobUpdateStatus || (exports.SyncJobUpdateStatus = SyncJobUpdateStatus = {}));
class SyncJobStatusDto {
}
exports.SyncJobStatusDto = SyncJobStatusDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: SyncJobUpdateStatus }),
    (0, class_validator_1.IsEnum)(SyncJobUpdateStatus),
    __metadata("design:type", String)
], SyncJobStatusDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SyncJobStatusDto.prototype, "summary", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ required: false }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SyncJobStatusDto.prototype, "errorMessage", void 0);
//# sourceMappingURL=sync-job-status.dto.js.map