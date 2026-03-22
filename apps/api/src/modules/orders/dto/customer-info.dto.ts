import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class CustomerInfoDto {
  @ApiProperty()
  @IsString()
  fullName!: string;

  @ApiProperty({ example: '+380991112233' })
  @IsString()
  @Matches(/^\+?[0-9\s\-()]{7,20}$/, { message: 'Invalid phone number' })
  phone!: string;

  @ApiProperty()
  @IsString()
  city!: string;

  @ApiProperty({ example: 'nova_poshta' })
  @IsString()
  deliveryProvider!: string;

  @ApiProperty({ example: 'Branch 12' })
  @IsString()
  branch!: string;

  @ApiProperty({ example: 'cod' })
  @IsString()
  paymentMethod!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}
