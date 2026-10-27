export { createInventoryController, type InventoryController } from './inventory.controller.js';
export {
  createInventoryMetricsService,
  type InventoryMetricsService,
} from './inventory-metrics.service.js';
export { createPrismaInventoryRepository } from './inventory.prisma-repository.js';
export {
  InsufficientStockError,
  type InventoryRepository,
  type LotRecord,
  type MovementRecord,
} from './inventory.repository.js';
export { inventoryRoutes, type InventoryRoutesOptions } from './inventory.routes.js';
export { nonNegativeQuantitySchema, positiveQuantitySchema } from './inventory.schemas.js';
export { createInventoryService, type InventoryService } from './inventory.service.js';
export { toLotDto, type LotDto, type MovementDto } from './inventory.dto.js';
