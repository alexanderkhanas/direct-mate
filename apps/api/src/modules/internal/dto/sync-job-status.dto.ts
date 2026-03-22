import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum SyncJobUpdateStatus {
  Success = 'success',
  Failed = 'failed',
}

export class SyncJobStatusDto {
  @ApiProperty({ enum: SyncJobUpdateStatus })
  @IsEnum(SyncJobUpdateStatus)
  status!: SyncJobUpdateStatus;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  summary?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  errorMessage?: string;
}
