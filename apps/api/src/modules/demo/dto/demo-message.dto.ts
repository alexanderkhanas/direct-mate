import { IsString, MinLength, MaxLength } from 'class-validator';

export class DemoMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  sessionKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500, { message: 'too_long' })
  text!: string;
}
