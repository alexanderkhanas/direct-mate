import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'My Beauty Store' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  storeName!: string;

  @ApiProperty({ example: 'beauty', enum: ['fashion', 'beauty', 'barber'] })
  @IsString()
  @IsIn(['fashion', 'beauty', 'barber'])
  businessType!: string;

  @ApiProperty({ example: 'owner@store.com' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password!: string;
}
