import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SizeChart } from './size-chart.entity';
import { SizeChartsService } from './size-charts.service';
import { SizeChartsController } from './size-charts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SizeChart])],
  controllers: [SizeChartsController],
  providers: [SizeChartsService],
  exports: [SizeChartsService],
})
export class SizeChartsModule {}
