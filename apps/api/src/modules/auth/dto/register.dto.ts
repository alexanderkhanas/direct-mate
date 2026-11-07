import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'My Beauty Store' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  storeName!: string;

  // 'barber' stays a valid BusinessType for existing stores, but isn't offered at sign-up.
  @ApiProperty({ example: 'fashion', enum: ['fashion', 'beauty'] })
  @IsString()
  @IsIn(['fashion', 'beauty'])
  businessType!: string;

  @ApiProperty({ example: 'owner@store.com' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password!: string;
}
