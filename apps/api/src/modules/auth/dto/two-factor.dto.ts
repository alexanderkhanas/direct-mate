import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** A code from the authenticator app, or a recovery code. */
export class TwoFactorProofDto {
  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @ApiPropertyOptional({ example: 'abcde-fghij' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  recoveryCode?: string;
}

export class ChallengeDto {
  @ApiProperty({ description: 'The challenge the login answered with' })
  @IsString()
  @MaxLength(2000)
  challenge!: string;
}

export class VerifyTwoFactorDto extends TwoFactorProofDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  challenge!: string;
}

export class EnableTwoFactorDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  challenge!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MaxLength(20)
  code!: string;
}

export class CodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @MaxLength(20)
  code!: string;
}
