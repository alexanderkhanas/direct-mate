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
exports.Product = void 0;
const typeorm_1 = require("typeorm");
const shared_1 = require("@direct-mate/shared");
const product_variant_entity_1 = require("./product-variant.entity");
const product_media_entity_1 = require("./product-media.entity");
const category_entity_1 = require("./category.entity");
let Product = class Product {
};
exports.Product = Product;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Product.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], Product.prototype, "tenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "externalProductId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "sku", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text' }),
    __metadata("design:type", String)
], Product.prototype, "title", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "searchKeywords", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "category", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "brand", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "material", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "gender", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "season", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'numeric', precision: 10, scale: 2, nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "salePrice", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "modelName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: shared_1.ProductStatus.Active }),
    __metadata("design:type", String)
], Product.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "metadata", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], Product.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], Product.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'last_synced_at', type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], Product.prototype, "lastSyncedAt", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => product_variant_entity_1.ProductVariant, (v) => v.product),
    __metadata("design:type", Array)
], Product.prototype, "variants", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => product_media_entity_1.ProductMedia, (m) => m.product),
    __metadata("design:type", Array)
], Product.prototype, "media", void 0);
__decorate([
    (0, typeorm_1.ManyToMany)(() => category_entity_1.Category, (c) => c.products),
    (0, typeorm_1.JoinTable)({
        name: 'product_categories',
        joinColumn: { name: 'product_id', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'category_id', referencedColumnName: 'id' },
    }),
    __metadata("design:type", Array)
], Product.prototype, "categories", void 0);
exports.Product = Product = __decorate([
    (0, typeorm_1.Entity)('products'),
    (0, typeorm_1.Index)(['tenantId']),
    (0, typeorm_1.Index)(['externalProductId'])
], Product);
//# sourceMappingURL=product.entity.js.map