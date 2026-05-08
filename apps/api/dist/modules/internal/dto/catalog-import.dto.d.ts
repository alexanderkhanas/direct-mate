declare const GENDER_VALUES: readonly ["male", "female", "unisex", "kids"];
export type Gender = (typeof GENDER_VALUES)[number];
export declare class ImportVariantDto {
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
}
export declare class ImportImageDto {
    url: string;
    color?: string;
    sortOrder?: number;
}
export declare class ImportProductDto {
    externalProductId: string;
    title: string;
    description?: string | null;
    category?: string | null;
    categories?: string[];
    brand?: string | null;
    material?: string | null;
    gender?: Gender | null;
    season?: string | null;
    modelName?: string | null;
    image?: string;
    status?: string;
    variants: ImportVariantDto[];
    images?: ImportImageDto[];
}
export declare class CatalogImportDto {
    tenantId: string;
    connectionId: string;
    products: ImportProductDto[];
}
export {};
