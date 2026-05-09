"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const product_entity_1 = require("./entities/product.entity");
const product_variant_entity_1 = require("./entities/product-variant.entity");
const stock_balance_entity_1 = require("./entities/stock-balance.entity");
const product_media_entity_1 = require("./entities/product-media.entity");
const category_entity_1 = require("./entities/category.entity");
const catalog_service_1 = require("./catalog.service");
const catalog_controller_1 = require("./catalog.controller");
const image_hash_service_1 = require("./image-hash.service");
const image_embedding_service_1 = require("./image-embedding.service");
let CatalogModule = class CatalogModule {
};
exports.CatalogModule = CatalogModule;
exports.CatalogModule = CatalogModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                product_entity_1.Product,
                product_variant_entity_1.ProductVariant,
                stock_balance_entity_1.StockBalance,
                product_media_entity_1.ProductMedia,
                category_entity_1.Category,
            ]),
        ],
        controllers: [catalog_controller_1.CatalogController],
        providers: [catalog_service_1.CatalogService, image_hash_service_1.ImageHashService, image_embedding_service_1.ImageEmbeddingService],
        exports: [
            catalog_service_1.CatalogService,
            image_hash_service_1.ImageHashService,
            image_embedding_service_1.ImageEmbeddingService,
            typeorm_1.TypeOrmModule,
        ],
    })
], CatalogModule);
//# sourceMappingURL=catalog.module.js.map