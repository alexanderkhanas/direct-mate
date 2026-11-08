import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SizeChart } from './size-chart.entity';
import { SizeChartsService } from './size-charts.service';
import { SizeChartReaderService } from './size-chart-reader.service';
import { SizeChartsController } from './size-charts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SizeChart])],
  controllers: [SizeChartsController],
  providers: [SizeChartsService, SizeChartReaderService],
  exports: [SizeChartsService],
})
export class SizeChartsModule {}
