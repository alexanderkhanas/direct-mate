import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class InboundMessageDto {
  @ApiProperty()
  @IsString()
  tenantId!: string;

  @ApiProperty({ default: 'instagram' })
  @IsString()
  channel!: string;

  @ApiProperty()
  @IsString()
  channelAccountId!: string;

  @ApiProperty()
  @IsString()
  externalUserId!: string;

  @ApiProperty()
  @IsString()
  messageId!: string;

  @ApiProperty()
  @IsString()
  messageText!: string;

  @ApiProperty()
  @IsISO8601()
  messageTimestamp!: string;
}
