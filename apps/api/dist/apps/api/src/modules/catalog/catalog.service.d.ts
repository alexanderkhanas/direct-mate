import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { StockBalance } from './entities/stock-balance.entity';
import { SearchProductsDto } from './dto/search-products.dto';
export declare class CatalogService {
    private readonly productRepo;
    private readonly variantRepo;
    private readonly stockRepo;
    constructor(productRepo: Repository<Product>, variantRepo: Repository<ProductVariant>, stockRepo: Repository<StockBalance>);
    searchProducts(tenantId: string, dto: SearchProductsDto): Promise<any[]>;
    upsertProduct(tenantId: string, data: Partial<Product> & {
        externalProductId: string;
    }): Promise<Product>;
    upsertVariant(productId: string, data: Partial<ProductVariant> & {
        externalVariantId: string;
    }): Promise<ProductVariant>;
    upsertStockBalance(variantId: string, availableQty: number): Promise<StockBalance>;
}
