import type { ProductCategory, Unit } from '@prisma/client';

/**
 * What the demo inventory of a product should show:
 * - HEALTHY: enough stock, distant expiry, normal rotation.
 * - LOW: below the minimum stock.
 * - OUT: no stock left (only dispatch history).
 * - EXPIRING: the only lot expires within a week.
 * - EXPIRED: an expired lot is still on the shelf next to a fresh one.
 * - WASTE: slow rotation; the stock will not sell before it expires.
 * - IDLE: no dispatches in the last 30 days.
 */
export type DemoScenario = 'HEALTHY' | 'LOW' | 'OUT' | 'EXPIRING' | 'EXPIRED' | 'WASTE' | 'IDLE';

export interface CatalogItem {
  name: string;
  category: ProductCategory;
  unit: Unit;
  minStock: number;
  /** Typical days from reception to expiry. */
  shelfLifeDays: number;
  /** Typical dispatched quantity per day (0 = no rotation). */
  dailyOut: number;
  scenario: DemoScenario;
}

const item = (
  name: string,
  category: ProductCategory,
  unit: Unit,
  minStock: number,
  shelfLifeDays: number,
  dailyOut: number,
  scenario: DemoScenario = 'HEALTHY',
): CatalogItem => ({ name, category, unit, minStock, shelfLifeDays, dailyOut, scenario });

/** Products of a Colombian food distributor. Names are unique. */
export const CATALOG: readonly CatalogItem[] = [
  // Granos y legumbres
  item('Arroz blanco', 'GRAINS_LEGUMES', 'KG', 200, 365, 40),
  item('Fríjol cargamanto', 'GRAINS_LEGUMES', 'KG', 60, 365, 8),
  item('Lenteja', 'GRAINS_LEGUMES', 'KG', 50, 365, 6, 'LOW'),
  item('Garbanzo', 'GRAINS_LEGUMES', 'KG', 30, 365, 3),
  item('Arveja seca', 'GRAINS_LEGUMES', 'KG', 25, 365, 0, 'IDLE'),
  item('Maíz pira', 'GRAINS_LEGUMES', 'KG', 15, 365, 1.5),
  item('Avena en hojuelas', 'GRAINS_LEGUMES', 'KG', 40, 270, 5),
  item('Harina de trigo', 'GRAINS_LEGUMES', 'KG', 80, 180, 12),
  item('Harina de maíz precocida', 'GRAINS_LEGUMES', 'KG', 100, 240, 18, 'LOW'),
  item('Pasta spaghetti', 'GRAINS_LEGUMES', 'KG', 60, 540, 9),

  // Despensa
  item('Azúcar blanca', 'OTHER', 'KG', 150, 720, 25),
  item('Sal refinada', 'OTHER', 'KG', 40, 1095, 4),
  item('Panela', 'OTHER', 'KG', 80, 180, 15),
  item('Aceite vegetal', 'OTHER', 'L', 80, 365, 14),
  item('Café molido', 'OTHER', 'KG', 30, 365, 4),
  item('Chocolate de mesa', 'OTHER', 'KG', 20, 365, 2),
  item('Huevos AA (cubeta x30)', 'OTHER', 'BOX', 40, 21, 9),

  // Lácteos
  item('Leche entera en bolsa', 'DAIRY', 'L', 150, 7, 45, 'EXPIRING'),
  item('Leche deslactosada UHT', 'DAIRY', 'L', 80, 90, 10),
  item('Queso campesino', 'DAIRY', 'KG', 25, 15, 2, 'WASTE'),
  item('Queso doble crema', 'DAIRY', 'KG', 15, 20, 2.5),
  item('Kumis', 'DAIRY', 'L', 30, 15, 0, 'IDLE'),
  item('Yogur natural', 'DAIRY', 'L', 40, 21, 6, 'EXPIRING'),
  item('Mantequilla', 'DAIRY', 'KG', 10, 60, 1),
  item('Arequipe', 'DAIRY', 'KG', 12, 120, 0.8),

  // Carnes y pollo
  item('Pechuga de pollo', 'MEAT_POULTRY', 'KG', 40, 5, 12, 'EXPIRING'),
  item('Pollo entero', 'MEAT_POULTRY', 'KG', 50, 5, 15, 'LOW'),
  item('Carne de res molida', 'MEAT_POULTRY', 'KG', 30, 4, 8, 'EXPIRED'),
  item('Costilla de cerdo', 'MEAT_POULTRY', 'KG', 20, 6, 3),
  item('Salchichas', 'MEAT_POULTRY', 'KG', 15, 30, 2),

  // Pescado
  item('Tilapia fresca', 'FISH', 'KG', 20, 4, 4, 'OUT'),
  item('Bagre fresco', 'FISH', 'KG', 15, 4, 2.5),

  // Frutas y verduras
  item('Papa pastusa', 'FRUITS_VEGETABLES', 'KG', 300, 30, 60),
  item('Papa criolla', 'FRUITS_VEGETABLES', 'KG', 80, 15, 15, 'LOW'),
  item('Plátano hartón', 'FRUITS_VEGETABLES', 'KG', 120, 10, 30, 'EXPIRING'),
  item('Tomate chonto', 'FRUITS_VEGETABLES', 'KG', 90, 10, 25),
  item('Cebolla cabezona', 'FRUITS_VEGETABLES', 'KG', 70, 30, 14),
  item('Zanahoria', 'FRUITS_VEGETABLES', 'KG', 60, 21, 10),
  item('Banano', 'FRUITS_VEGETABLES', 'KG', 60, 7, 10, 'EXPIRED'),
  item('Mango tommy', 'FRUITS_VEGETABLES', 'KG', 30, 8, 3, 'WASTE'),
  item('Naranja valencia', 'FRUITS_VEGETABLES', 'KG', 80, 21, 14),
  item('Limón tahití', 'FRUITS_VEGETABLES', 'KG', 25, 21, 4),
  item('Aguacate hass', 'FRUITS_VEGETABLES', 'KG', 40, 6, 7, 'OUT'),
  item('Yuca', 'FRUITS_VEGETABLES', 'KG', 60, 10, 10),

  // Panadería
  item('Pan tajado', 'BAKERY', 'UNIT', 60, 7, 18, 'EXPIRED'),
  item('Arepas de maíz (paquete x10)', 'BAKERY', 'UNIT', 80, 10, 22, 'LOW'),
  item('Galletas de soda (paquete)', 'BAKERY', 'UNIT', 100, 180, 12),

  // Enlatados
  item('Atún en lata 170 g', 'CANNED', 'UNIT', 120, 1095, 20),
  item('Sardinas en lata 425 g', 'CANNED', 'UNIT', 60, 1095, 6),
  item('Fríjoles enlatados', 'CANNED', 'UNIT', 40, 730, 0, 'IDLE'),
  item('Maíz tierno en lata', 'CANNED', 'UNIT', 30, 730, 3),

  // Bebidas
  item('Gaseosa cola 1,5 L', 'BEVERAGES', 'UNIT', 120, 180, 30),
  item('Agua potable 6 L', 'BEVERAGES', 'UNIT', 50, 365, 8),
  item('Jugo de naranja', 'BEVERAGES', 'L', 40, 30, 3, 'WASTE'),

  // Congelados
  item('Arveja congelada', 'FROZEN', 'KG', 20, 180, 2),
  item('Pulpa de mora', 'FROZEN', 'KG', 25, 180, 4, 'OUT'),
];
