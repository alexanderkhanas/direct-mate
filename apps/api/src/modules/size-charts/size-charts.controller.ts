import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { SizeChartsService } from './size-charts.service';

const uploadsDir = join(process.cwd(), 'uploads');

const storage = diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const unique = randomUUID();
    const ext = extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

@ApiTags('size-charts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('size-charts')
export class SizeChartsController {
  constructor(private readonly sizeChartsService: SizeChartsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.sizeChartsService.listForTenant(user.tenantId);
  }

  @Get('brands')
  async brands(@CurrentUser() user: JwtPayload) {
    return this.sizeChartsService.listTenantBrands(user.tenantId);
  }

  @Get('categories')
  async categories(@CurrentUser() user: JwtPayload) {
    return this.sizeChartsService.listTenantCategories(user.tenantId);
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage,
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
          return cb(
            new BadRequestException(`Unsupported file type: ${file.mimetype}`),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return { imagePath: `uploads/${file.filename}` };
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      name: string;
      imagePath: string;
      categories?: string[];
      brands?: string[];
      isDefault?: boolean;
    },
  ) {
    if (!body.name || !body.imagePath) {
      throw new BadRequestException('name and imagePath are required');
    }
    return this.sizeChartsService.create(user.tenantId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      imagePath?: string;
      categories?: string[];
      brands?: string[];
      isDefault?: boolean;
    },
  ) {
    return this.sizeChartsService.update(user.tenantId, id, body);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.sizeChartsService.delete(user.tenantId, id);
    return { ok: true };
  }
}
