export { createProductController, type ProductController } from './product.controller.js';
export type { ProductDetailDto, ProductDto } from './product.dto.js';
export { createPrismaProductRepository } from './product.prisma-repository.js';
export {
  DuplicateProductNameError,
  type ProductRecord,
  type ProductRepository,
} from './product.repository.js';
export { productRoutes, type ProductRoutesOptions } from './product.routes.js';
export { createProductService, type ProductService } from './product.service.js';
