import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class TakeoverDto {
  @ApiProperty()
  @IsUUID()
  managerUserId!: string;
}
