import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Cross-field validator: salePrice (when present) must be ≤ price.
 * Applied at the variant level since price/salePrice live on variants.
 */
function IsSalePriceValid(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSalePriceValid',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (value === null || value === undefined) return true;
          if (typeof value !== 'number') return false;
          if (value < 0) return false;
          const price = (args.object as ImportVariantDto).price;
          if (typeof price !== 'number') return true; // price validator will catch
          return value <= price;
        },
        defaultMessage(args: ValidationArguments) {
          const v = args.value as number | null | undefined;
          if (v === null || v === undefined) return '';
          if (typeof v !== 'number') return 'salePrice must be a number';
          if (v < 0) return 'salePrice must be ≥ 0';
          return 'salePrice must be ≤ price';
        },
      },
    });
  };
}

const GENDER_VALUES = ['male', 'female', 'unisex', 'kids'] as const;
export type Gender = (typeof GENDER_VALUES)[number];

export class ImportVariantDto {
  @ApiProperty({ example: 'gid://shopify/ProductVariant/111' })
  @IsString()
  @IsNotEmpty()
  externalVariantId!: string;

  @ApiPropertyOptional({ example: 'RGC-150' })
  @IsString()
  @IsOptional()
  sku?: string;

  /** EAN-13 / UPC / brand SKU. Tenant-scoped unique when present. */
  @ApiPropertyOptional({ example: '2907010005972' })
  @IsString()
  @IsOptional()
  barcode?: string | null;

  @ApiPropertyOptional({ example: '150ml' })
  @IsString()
  @IsOptional()
  size?: string | null;

  @ApiPropertyOptional({ example: 'Red' })
  @IsString()
  @IsOptional()
  color?: string | null;

  @ApiProperty({ example: 24 })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: 18 })
  @IsOptional()
  @IsNumber()
  @IsSalePriceValid()
  salePrice?: number | null;

  @ApiPropertyOptional({ example: 'UAH' })
  @IsString()
  @IsOptional()
  currency?: string;

  // Negative values do appear in Torgsoft data (oversold / backorder /
  // legacy quirks). For DirectMate's purposes any non-positive qty means
  // "out of stock", and the catalog service clamps to 0 when writing to
  // stock_balances. So we accept any number here rather than reject the
  // batch.
  @ApiPropertyOptional({ example: 18 })
  @IsNumber()
  @IsOptional()
  inventoryQty?: number;

  @ApiPropertyOptional({ example: 'https://cdn.shopify.com/s/files/variant-black.jpg' })
  @IsString()
  @IsOptional()
  imageUrl?: string;
}

export class ImportImageDto {
  @ApiProperty({ example: 'https://cdn.shopify.com/s/files/product.jpg' })
  @IsString()
  @IsNotEmpty()
  url!: string;

  @ApiPropertyOptional({ example: 'Red' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  sortOrder?: number;
}

export class ImportProductDto {
  @ApiProperty({ example: 'gid://shopify/Product/123' })
  @IsString()
  @IsNotEmpty()
  externalProductId!: string;

  @ApiProperty({ example: 'Radiance Gel Cleanser' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ example: 'Gentle gel cleanser for sensitive skin' })
  @IsString()
  @IsOptional()
  description?: string | null;

  /**
   * Legacy single-category text field. Sync continues to accept this
   * for older Shopify connectors that still emit a single category. New
   * Torgsoft connector uses `categories[]` instead. If both are present
   * `categories[]` wins; `category` is ignored.
   */
  @ApiPropertyOptional({ example: 'Skincare' })
  @IsString()
  @IsOptional()
  category?: string | null;

  /**
   * Multi-category. Empty array OK. Names matched case-insensitively
   * against existing tenant categories (e.g. "Верхній одяг" and
   * "верхній одяг" map to the same row).
   */
  @ApiPropertyOptional({ type: [String], example: ['Верхній одяг', 'Куртки'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'categories: max 10 entries' })
  @IsString({ each: true })
  @MaxLength(100, { each: true, message: 'categories: each name max 100 chars' })
  categories?: string[];

  @ApiPropertyOptional({ example: 'Radiance' })
  @IsString()
  @IsOptional()
  brand?: string | null;

  @ApiPropertyOptional({ example: 'Cotton 100%' })
  @IsString()
  @IsOptional()
  material?: string | null;

  @ApiPropertyOptional({
    example: 'female',
    enum: GENDER_VALUES,
    nullable: true,
    description: 'Normalized gender. n8n side maps Torgsoft codes; on failure, sends null.',
  })
  @IsOptional()
  @IsIn([...GENDER_VALUES, null], { message: `gender must be one of: ${GENDER_VALUES.join(', ')} or null` })
  gender?: Gender | null;

  @ApiPropertyOptional({ example: 'winter' })
  @IsString()
  @IsOptional()
  season?: string | null;

  @ApiPropertyOptional({ example: 'Bottega Veneta Stretch Strap Sandal' })
  @IsString()
  @IsOptional()
  modelName?: string | null;

  /**
   * Single primary image URL (Torgsoft style). Translated to a
   * one-element images array under the hood. Coexists with the legacy
   * `images?[]` array — if both are present, `images[]` wins.
   */
  @ApiPropertyOptional({ example: 'https://cdn.directmate.app/luxespace/images/178.jpg' })
  @IsString()
  @IsOptional()
  image?: string;

  @ApiPropertyOptional({ example: 'active', default: 'active' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ type: [ImportVariantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportVariantDto)
  variants!: ImportVariantDto[];

  @ApiPropertyOptional({ type: [ImportImageDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImportImageDto)
  images?: ImportImageDto[];
}

export class CatalogImportDto {
  @ApiProperty()
  @IsUUID()
  tenantId!: string;

  @ApiProperty()
  @IsUUID()
  connectionId!: string;

  @ApiProperty({ type: [ImportProductDto] })
  @IsArray()
  @ArrayMaxSize(10000, { message: 'products: max 10000 entries per request' })
  @ValidateNested({ each: true })
  @Type(() => ImportProductDto)
  products!: ImportProductDto[];
}
