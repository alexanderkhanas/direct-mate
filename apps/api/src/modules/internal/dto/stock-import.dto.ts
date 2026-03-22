import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StockItemDto {
  @ApiProperty({ example: 'gid://shopify/ProductVariant/111' })
  @IsString()
  @IsNotEmpty()
  externalVariantId!: string;

  @ApiProperty({ example: 18 })
  @IsNumber()
  @Min(0)
  availableQty!: number;
}

export class StockImportDto {
  @ApiProperty()
  @IsUUID()
  tenantId!: string;

  @ApiProperty()
  @IsUUID()
  connectionId!: string;

  @ApiProperty({ type: [StockItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockItemDto)
  items!: StockItemDto[];
}
