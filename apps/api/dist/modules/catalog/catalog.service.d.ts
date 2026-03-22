import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { StockBalance } from './entities/stock-balance.entity';
import { SearchProductsDto } from './dto/search-products.dto';
export declare class CatalogService {
    private readonly productRepo;
    private readonly variantRepo;
    private readonly stockRepo;
    private readonly logger;
    constructor(productRepo: Repository<Product>, variantRepo: Repository<ProductVariant>, stockRepo: Repository<StockBalance>);
    searchProducts(tenantId: string, dto: SearchProductsDto): Promise<any[]>;
    upsertProduct(tenantId: string, data: Partial<Product> & {
        externalProductId: string;
    }): Promise<Product>;
    upsertVariant(productId: string, data: Partial<ProductVariant> & {
        externalVariantId: string;
    }): Promise<ProductVariant>;
    listProducts(tenantId: string, q?: string): Promise<{
        id: string;
        title: string;
        category: string | null;
        variantCount: number;
        updatedAt: Date;
        variants: {
            id: string;
            size: string | null;
            color: string | null;
            price: number;
            currency: string;
            effectiveAvailable: number;
            lastSyncedAt: Date | null;
        }[];
    }[]>;
    upsertStockBalance(variantId: string, availableQty: number): Promise<StockBalance>;
    importCatalog(tenantId: string, products: Array<{
        externalProductId: string;
        title: string;
        description?: string;
        category?: string;
        brand?: string;
        status?: string;
        variants: Array<{
            externalVariantId: string;
            sku?: string;
            size?: string;
            color?: string;
            price: number;
            currency?: string;
            inventoryQty?: number;
        }>;
    }>): Promise<{
        created: number;
        updated: number;
        skipped: number;
        errors: string[];
    }>;
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
