import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { BusinessHours, HandoffRules } from '../entities/tenant-settings-types';

export class UpdateSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brandTone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  businessHours?: BusinessHours;

  @ApiPropertyOptional()
  @IsOptional()
  handoffRules?: HandoffRules;

  @ApiPropertyOptional()
  @IsOptional()
  supportedLanguages?: string[];
}
