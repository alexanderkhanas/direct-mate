import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { ScreenshotImportJob } from './entities/screenshot-import-job.entity';
import { ScreenshotImportFile } from './entities/screenshot-import-file.entity';
import { ScreenshotExtractionService } from './screenshot-extraction.service';

const uploadsDir = join(process.cwd(), 'uploads');

const storage = diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const unique = randomUUID();
    const ext = extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

@ApiTags('training')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('training/screenshots')
export class ScreenshotUploadController {
  constructor(
    @InjectRepository(ScreenshotImportJob)
    private readonly jobRepo: Repository<ScreenshotImportJob>,
    @InjectRepository(ScreenshotImportFile)
    private readonly fileRepo: Repository<ScreenshotImportFile>,
    private readonly extractionService: ScreenshotExtractionService,
  ) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage,
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
          return cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
    }),
  )
  async uploadScreenshots(
    @CurrentUser() user: JwtPayload,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const job = this.jobRepo.create({
      tenantId: user.tenantId,
      createdByUserId: user.sub,
      status: 'pending',
      totalFiles: files.length,
      processedFiles: 0,
    });
    const savedJob = await this.jobRepo.save(job);

    const fileEntities: ScreenshotImportFile[] = [];
    for (const file of files) {
      fileEntities.push(
        this.fileRepo.create({
          jobId: savedJob.id,
          tenantId: user.tenantId,
          fileUrl: file.path,
          fileName: file.originalname,
          mimeType: file.mimetype,
          ocrStatus: 'pending',
          extractionStatus: 'pending',
        }),
      );
    }
    await this.fileRepo.save(fileEntities);

    // Fire-and-forget: trigger extraction asynchronously
    this.extractionService.processJob(savedJob.id).catch((err) => {
      console.error(`Job ${savedJob.id} processing failed:`, err);
    });

    return {
      jobId: savedJob.id,
      status: 'pending',
      totalFiles: files.length,
    };
  }

  @Get('jobs')
  async listJobs(@CurrentUser() user: JwtPayload) {
    return this.jobRepo.find({
      where: { tenantId: user.tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  @Get('jobs/:id')
  async getJob(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const job = await this.jobRepo.findOne({
      where: { id, tenantId: user.tenantId },
      relations: ['files'],
    });
    if (!job) {
      throw new BadRequestException('Job not found');
    }
    return job;
  }
}
