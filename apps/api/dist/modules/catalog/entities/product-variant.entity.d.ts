import { Product } from './product.entity';
import { StockBalance } from './stock-balance.entity';
export declare class ProductVariant {
    id: string;
    productId: string;
    tenantId: string;
    externalVariantId: string | null;
    sku: string | null;
    barcode: string | null;
    color: string | null;
    size: string | null;
    price: number;
    salePrice: number | null;
    currency: string;
    active: boolean;
    imageUrl: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
    lastSyncedAt: Date | null;
    product: Product;
    stockBalance: StockBalance;
}
