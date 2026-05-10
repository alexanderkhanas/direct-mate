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
exports.CatalogImportDto = exports.ImportProductDto = exports.ImportImageDto = exports.ImportVariantDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
function IsSalePriceValid(validationOptions) {
    return function (object, propertyName) {
        (0, class_validator_1.registerDecorator)({
            name: 'isSalePriceValid',
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: {
                validate(value, args) {
                    if (value === null || value === undefined)
                        return true;
                    if (typeof value !== 'number')
                        return false;
                    if (value < 0)
                        return false;
                    const price = args.object.price;
                    if (typeof price !== 'number')
                        return true;
                    return value <= price;
                },
                defaultMessage(args) {
                    const v = args.value;
                    if (v === null || v === undefined)
                        return '';
                    if (typeof v !== 'number')
                        return 'salePrice must be a number';
                    if (v < 0)
                        return 'salePrice must be ≥ 0';
                    return 'salePrice must be ≤ price';
                },
            },
        });
    };
}
const GENDER_VALUES = ['male', 'female', 'unisex', 'kids'];
class ImportVariantDto {
}
exports.ImportVariantDto = ImportVariantDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'gid://shopify/ProductVariant/111' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ImportVariantDto.prototype, "externalVariantId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'RGC-150' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], ImportVariantDto.prototype, "sku", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '2907010005972' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], ImportVariantDto.prototype, "barcode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '150ml' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], ImportVariantDto.prototype, "size", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Red' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], ImportVariantDto.prototype, "color", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 24 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ImportVariantDto.prototype, "price", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 18 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(),
    IsSalePriceValid(),
    __metadata("design:type", Object)
], ImportVariantDto.prototype, "salePrice", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'UAH' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], ImportVariantDto.prototype, "currency", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 18 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], ImportVariantDto.prototype, "inventoryQty", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'https://cdn.shopify.com/s/files/variant-black.jpg' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], ImportVariantDto.prototype, "imageUrl", void 0);
class ImportImageDto {
}
exports.ImportImageDto = ImportImageDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'https://cdn.shopify.com/s/files/product.jpg' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ImportImageDto.prototype, "url", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Red' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], ImportImageDto.prototype, "color", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 0 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ImportImageDto.prototype, "sortOrder", void 0);
class ImportProductDto {
}
exports.ImportProductDto = ImportProductDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'gid://shopify/Product/123' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ImportProductDto.prototype, "externalProductId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Radiance Gel Cleanser' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ImportProductDto.prototype, "title", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Gentle gel cleanser for sensitive skin' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], ImportProductDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Skincare' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], ImportProductDto.prototype, "category", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [String], example: ['Верхній одяг', 'Куртки'] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(10, { message: 'categories: max 10 entries' }),
    (0, class_validator_1.IsString)({ each: true }),
    (0, class_validator_1.MaxLength)(100, { each: true, message: 'categories: each name max 100 chars' }),
    __metadata("design:type", Array)
], ImportProductDto.prototype, "categories", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Radiance' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], ImportProductDto.prototype, "brand", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Cotton 100%' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], ImportProductDto.prototype, "material", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'female',
        enum: GENDER_VALUES,
        nullable: true,
        description: 'Normalized gender. n8n side maps Torgsoft codes; on failure, sends null.',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)([...GENDER_VALUES, null], { message: `gender must be one of: ${GENDER_VALUES.join(', ')} or null` }),
    __metadata("design:type", Object)
], ImportProductDto.prototype, "gender", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'winter' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], ImportProductDto.prototype, "season", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Bottega Veneta Stretch Strap Sandal' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], ImportProductDto.prototype, "modelName", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'чорна black mesh-jersey сітчастий джерсі коктейльна без рукавів міні',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], ImportProductDto.prototype, "searchKeywords", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'https://cdn.directmate.app/luxespace/images/178.jpg' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], ImportProductDto.prototype, "image", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'active', default: 'active' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], ImportProductDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [ImportVariantDto] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => ImportVariantDto),
    __metadata("design:type", Array)
], ImportProductDto.prototype, "variants", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [ImportImageDto] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => ImportImageDto),
    __metadata("design:type", Array)
], ImportProductDto.prototype, "images", void 0);
class CatalogImportDto {
}
exports.CatalogImportDto = CatalogImportDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CatalogImportDto.prototype, "tenantId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CatalogImportDto.prototype, "connectionId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [ImportProductDto] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(10000, { message: 'products: max 10000 entries per request' }),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => ImportProductDto),
    __metadata("design:type", Array)
], CatalogImportDto.prototype, "products", void 0);
//# sourceMappingURL=catalog-import.dto.js.map