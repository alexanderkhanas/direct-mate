import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdatePhraseDto {
  @IsString()
  @IsIn(['approved', 'rejected', 'pending'])
  approvalStatus!: string;

  @IsOptional()
  @IsString()
  phrase?: string;

  @IsOptional()
  @IsString()
  scenario?: string;
}
