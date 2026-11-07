import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreConfig } from './entities/store-config.entity';
import { StoreConfigController } from './store-config.controller';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([StoreConfig]), OnboardingModule, NotificationsModule],
  controllers: [StoreConfigController],
})
export class EngineModule {}
