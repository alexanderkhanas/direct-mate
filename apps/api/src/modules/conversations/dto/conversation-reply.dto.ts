import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ConversationReplyDto {
  @ApiProperty({ example: 'uuid-tenant-id' })
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @ApiProperty({ example: 'instagram' })
  @IsString()
  @IsNotEmpty()
  channel!: string;

  @ApiProperty({ example: '123456789' })
  @IsString()
  @IsNotEmpty()
  channelAccountId!: string;

  @ApiProperty({ example: 'ig_user_789' })
  @IsString()
  @IsNotEmpty()
  externalUserId!: string;

  @ApiProperty({ example: 'mid_123' })
  @IsString()
  @IsNotEmpty()
  messageId!: string;

  @ApiProperty({ example: 'Do you have this dress in M?' })
  @IsString()
  @IsNotEmpty()
  messageText!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  messageTimestamp?: string;
}
