import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { SizeChartsService, type UpdateSizeChartDto } from './size-charts.service';
import { SizeChartReaderService } from './size-chart-reader.service';

const uploadsDir = join(process.cwd(), 'uploads');

/** The extension comes from the type, not the file's name, so a saved chart always matches `uploads/<uuid>.<ext>`. */
const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

const storage = diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    cb(null, `${randomUUID()}${EXTENSIONS[file.mimetype] ?? '.jpg'}`);
  },
});

/** `?brands=a,b` (or the param repeated) → ['a', 'b']. */
function listParam(value: string | string[] | undefined): string[] {
  const parts = Array.isArray(value) ? value : value ? [value] : [];
  return parts.flatMap((p) => p.split(',')).map((s) => s.trim()).filter(Boolean);
}

@ApiTags('size-charts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('size-charts')
export class SizeChartsController {
  constructor(
    private readonly sizeChartsService: SizeChartsService,
    private readonly reader: SizeChartReaderService,
  ) {}

  /** Every chart with `productCount`: the active products its scope covers. */
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.sizeChartsService.listWithCounts(user.tenantId);
  }

  @Get('brands')
  async brands(@CurrentUser() user: JwtPayload) {
    return this.sizeChartsService.listTenantBrands(user.tenantId);
  }

  @Get('categories')
  async categories(@CurrentUser() user: JwtPayload) {
    return this.sizeChartsService.listTenantCategories(user.tenantId);
  }

  /** `{ count, total }`: active products a scope would cover. Empty lists mean «all». */
  @Get('match-count')
  matchCount(
    @CurrentUser() user: JwtPayload,
    @Query('brands') brands?: string | string[],
    @Query('categories') categories?: string | string[],
  ) {
    return this.sizeChartsService.matchCount(user.tenantId, {
      brands: listParam(brands),
      categories: listParam(categories),
    });
  }

  /** Active products with and without a ready chart. */
  @Get('coverage')
  coverage(@CurrentUser() user: JwtPayload) {
    return this.sizeChartsService.coverage(user.tenantId);
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage,
      fileFilter: (_req, file, cb) => {
        if (!EXTENSIONS[file.mimetype]) {
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

  /**
   * Reads the chart's image into a table with a vision model and saves it as
   * a draft. Synchronous; usually a few seconds. Errors carry
   * `details.reason`: `image_missing`, `not_a_chart` or `read_failed`.
   */
  @Post(':id/read')
  async read(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const sizes = await this.sizeChartsService.sizesInScope(user.tenantId, id);
    return this.reader.read(user.tenantId, id, sizes);
  }

  /** Scope, name and image as before, plus `table`, `status` (draft | ready) and `sendImage`. */
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: UpdateSizeChartDto,
  ) {
    return this.sizeChartsService.update(user.tenantId, id, body);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.sizeChartsService.delete(user.tenantId, id);
    return { ok: true };
  }
}
