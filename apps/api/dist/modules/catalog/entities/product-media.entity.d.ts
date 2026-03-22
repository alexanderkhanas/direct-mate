import { Product } from './product.entity';
export declare class ProductMedia {
    id: string;
    productId: string;
    url: string;
    color: string | null;
    sortOrder: number;
    createdAt: Date;
    product: Product;
}
