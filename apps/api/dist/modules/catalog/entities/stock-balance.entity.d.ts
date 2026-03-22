import { ProductVariant } from './product-variant.entity';
export declare class StockBalance {
    id: string;
    variantId: string;
    warehouseCode: string | null;
    availableQty: number;
    reservedQty: number;
    pendingCheckoutQty: number;
    lastSyncedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    get effectiveAvailable(): number;
    variant: ProductVariant;
}
