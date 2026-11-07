import { Module } from '@nestjs/common';
import { OnboardingReadiness } from './onboarding-readiness.service';

@Module({
  providers: [OnboardingReadiness],
  exports: [OnboardingReadiness],
})
export class OnboardingModule {}
