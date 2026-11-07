import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreConfig } from './entities/store-config.entity';
import { StoreConfigController } from './store-config.controller';

@Module({
  imports: [TypeOrmModule.forFeature([StoreConfig])],
  controllers: [StoreConfigController],
})
export class EngineModule {}
