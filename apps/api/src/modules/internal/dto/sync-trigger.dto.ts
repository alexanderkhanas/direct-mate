import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class SyncTriggerDto {
  @ApiProperty()
  @IsUUID()
  tenantId!: string;

  @ApiProperty({ example: 'keycrm' })
  @IsString()
  source!: string;

  @ApiProperty({ example: 'full', enum: ['full', 'incremental', 'file_import'] })
  @IsString()
  mode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  connectionId?: string;
}
