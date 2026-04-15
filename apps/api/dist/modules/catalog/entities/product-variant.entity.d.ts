import { Product } from './product.entity';
import { StockBalance } from './stock-balance.entity';
export declare class ProductVariant {
    id: string;
    productId: string;
    externalVariantId: string | null;
    sku: string | null;
    color: string | null;
    size: string | null;
    price: number;
    currency: string;
    active: boolean;
    imageUrl: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
    product: Product;
    stockBalance: StockBalance;
}
