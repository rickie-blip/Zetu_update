import { Module } from '@nestjs/common';
import { ExcelService } from '../services/excel.service';
import { ShopifyService } from '../services/shopify.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  controllers: [InventoryController],
  providers: [ExcelService, ShopifyService, InventoryService],
})
export class InventoryModule {}
