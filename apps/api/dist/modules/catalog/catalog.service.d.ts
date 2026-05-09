import { DataSource, Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductMedia } from './entities/product-media.entity';
import { StockBalance } from './entities/stock-balance.entity';
import { Category } from './entities/category.entity';
import { SearchProductsDto } from './dto/search-products.dto';
import { ImageHashService } from './image-hash.service';
import { ImageEmbeddingService } from './image-embedding.service';
export interface ImportProductInput {
    externalProductId: string;
    title: string;
    description?: string | null;
    category?: string | null;
    categories?: string[];
    brand?: string | null;
    material?: string | null;
    gender?: 'male' | 'female' | 'unisex' | 'kids' | null;
    season?: string | null;
    modelName?: string | null;
    image?: string;
    status?: string;
    variants: Array<{
        externalVariantId: string;
        sku?: string;
        barcode?: string | null;
        size?: string | null;
        color?: string | null;
        price: number;
        salePrice?: number | null;
        currency?: string;
        inventoryQty?: number;
        imageUrl?: string;
    }>;
    images?: Array<{
        url: string;
        color?: string;
        sortOrder?: number;
    }>;
}
export interface ImportCatalogResult {
    productsCreated: number;
    productsUpdated: number;
    productsArchived: number;
    variantsCreated: number;
    variantsUpdated: number;
    categoriesCreated: number;
    errors: string[];
}
export declare class CatalogService {
    private readonly productRepo;
    private readonly variantRepo;
    private readonly stockRepo;
    private readonly mediaRepo;
    private readonly categoryRepo;
    private readonly dataSource;
    private readonly imageHashService;
    private readonly imageEmbeddingService;
    private readonly logger;
    constructor(productRepo: Repository<Product>, variantRepo: Repository<ProductVariant>, stockRepo: Repository<StockBalance>, mediaRepo: Repository<ProductMedia>, categoryRepo: Repository<Category>, dataSource: DataSource, imageHashService: ImageHashService, imageEmbeddingService: ImageEmbeddingService);
    searchProducts(tenantId: string, dto: SearchProductsDto): Promise<any[]>;
    upsertProduct(tenantId: string, data: Partial<Product> & {
        externalProductId: string;
    }): Promise<Product>;
    upsertVariant(productId: string, data: Partial<ProductVariant> & {
        externalVariantId: string;
        tenantId: string;
    }): Promise<ProductVariant>;
    listProducts(tenantId: string, q?: string): Promise<{
        id: string;
        sku: string | null;
        title: string;
        category: string | null;
        imageUrl: string;
        variantCount: number;
        updatedAt: Date;
        lastSyncedAt: Date;
        variants: {
            id: string;
            sku: string | null;
            size: string | null;
            color: string | null;
            price: number;
            currency: string;
            imageUrl: string;
            effectiveAvailable: number;
            lastSyncedAt: Date | null;
        }[];
    }[]>;
    upsertStockBalance(variantId: string, availableQty: number): Promise<StockBalance>;
    importCatalog(tenantId: string, products: ImportProductInput[]): Promise<ImportCatalogResult>;
    private importCatalogTx;
    private upsertCategories;
    private toProductRow;
    private firstSalePriceFromVariants;
    private diffProduct;
    private normalizedNeq;
    private pickProductUpdate;
    private upsertVariants;
    private diffVariant;
    private syncProductCategories;
    private collectImageRows;
    private upsertStockBalanceTx;
    importStock(tenantId: string, items: Array<{
        externalVariantId: string;
        availableQty: number;
    }>): Promise<{
        processed: number;
        updated: number;
        skipped: number;
        errors: string[];
    }>;
}
