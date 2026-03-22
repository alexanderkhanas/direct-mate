import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateReservationDto {
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

  @ApiPropertyOptional({ default: 20 })
  @IsNumber()
  @Min(5)
  @Max(60)
  ttlMinutes?: number = 20;
}
