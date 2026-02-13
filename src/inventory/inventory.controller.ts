import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InventoryService } from './inventory.service';
import { UPLOAD_UI_CLIENT_JS } from './upload-ui.client';
import { UPLOAD_UI_HTML } from './upload-ui.page';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('upload-ui')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getUploadUi(): string {
    return UPLOAD_UI_HTML;
  }

  @Get('upload-ui.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  getUploadUiClient(): string {
    return UPLOAD_UI_CLIENT_JS;
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
      fileFilter: (_req, file, callback) => {
        const allowed =
          file.originalname.toLowerCase().endsWith('.xlsx') ||
          file.originalname.toLowerCase().endsWith('.xls') ||
          file.originalname.toLowerCase().endsWith('.csv');

        callback(
          allowed
            ? null
            : new BadRequestException('Only .xlsx, .xls, or .csv files are supported'),
          allowed,
        );
      },
    }),
  )
  async uploadInventoryFile(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<unknown> {
    if (!file?.buffer) {
      throw new BadRequestException('No input file uploaded');
    }

    return this.inventoryService.processUpload(file.buffer);
  }
}
