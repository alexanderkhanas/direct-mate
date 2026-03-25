import { IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class SyncErrorDto {
  @IsString()
  code!: string;

  @IsString()
  message!: string;

  @IsString()
  platform!: string;

  @IsOptional()
  retryable?: boolean;
}

export class SyncCallbackDto {
  @IsString()
  orderId!: string;

  @IsIn(['success', 'failed'])
  status!: 'success' | 'failed';

  @IsString()
  platform!: string;

  @IsOptional()
  @IsString()
  externalOrderId?: string;

  @IsOptional()
  @IsString()
  externalOrderUrl?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => SyncErrorDto)
  error?: SyncErrorDto;

  @IsString()
  idempotencyKey!: string;
}
