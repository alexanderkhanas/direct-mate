import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CheckAvailabilityDto {
  @ApiProperty()
  @IsString()
  query!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  /**
   * Tenant category name extracted by the classifier. When set, the
   * search prefilters products via the `categories` + `product_
   * categories` M2M (case-insensitive exact match), then narrows by
   * `query` keywords on title. Bypasses the legacy ILIKE-on-
   * `products.category` substring match that produced false positives
   * (e.g. "Верхній одяг" matching "комплект домашнього одягу").
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;
}
