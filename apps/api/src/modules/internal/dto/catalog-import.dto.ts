import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ImportVariantDto {
  @ApiProperty({ example: 'gid://shopify/ProductVariant/111' })
  @IsString()
  @IsNotEmpty()
  externalVariantId!: string;

  @ApiPropertyOptional({ example: 'RGC-150' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiPropertyOptional({ example: '150ml' })
  @IsString()
  @IsOptional()
  size?: string;

  @ApiPropertyOptional({ example: 'Red' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiProperty({ example: 24 })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: 'UAH' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ example: 18 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  inventoryQty?: number;
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
  description?: string;

  @ApiPropertyOptional({ example: 'Skincare' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ example: 'Radiance' })
  @IsString()
  @IsOptional()
  brand?: string;

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
  @ValidateNested({ each: true })
  @Type(() => ImportProductDto)
  products!: ImportProductDto[];
}
