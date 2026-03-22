import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateVoiceSignalDto {
  @IsString()
  @IsIn(['approved', 'rejected', 'pending'])
  approvalStatus!: string;

  @IsOptional()
  @IsString()
  signalType?: string;

  @IsOptional()
  @IsString()
  signalValue?: string;

  @IsOptional()
  @IsString()
  evidenceText?: string;
}
