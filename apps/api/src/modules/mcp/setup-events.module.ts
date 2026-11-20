import { Module } from '@nestjs/common';
import { SetupEventsService } from './setup-events.service';

/** On its own, with no imports, so any module can record a funnel step without an import cycle. */
@Module({ providers: [SetupEventsService], exports: [SetupEventsService] })
export class SetupEventsModule {}
