import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsUUID, Min } from 'class-validator';

export class StartCheckoutDto {
  @ApiProperty()
  @IsUUID()
  conversationId!: string;

  @ApiProperty()
  @IsUUID()
  customerId!: string;

  @ApiProperty()
  @IsUUID()
  variantId!: string;

  @ApiProperty({ default: 1 })
  @IsNumber()
  @Min(1)
  qty!: number;
}
