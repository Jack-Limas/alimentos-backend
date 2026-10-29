import type { ReportLocale } from './domain/report-document.js';

/**
 * Texts of the downloadable reports. The API never sends translated text
 * (contract 3), but a CSV or PDF is read by a person outside the app, so the
 * report is the one place where the backend writes in the requested language.
 */
export const REPORT_LABELS = {
  es: {
    generated: 'Generado el {date} (hora de Bogotá)',
    page: 'Página {page} de {pages}',
    range: 'Del {from} al {to}',
    empty: 'Sin datos para este reporte.',
    inventory: {
      title: 'Reporte de inventario',
      file: 'inventario',
      columns: [
        'Producto',
        'Categoría',
        'Unidad',
        'Disponible',
        'Mínimo',
        'Estado',
        'Vence primero',
        'Días',
        'Salida diaria',
        'Riesgo de merma',
      ],
      totals: {
        products: 'Productos activos',
        available: 'Disponible',
        low: 'Con stock bajo',
        out: 'Sin stock',
        risk: 'Riesgo de merma alto',
      },
    },
    orders: {
      title: 'Reporte de pedidos',
      file: 'pedidos',
      columns: ['Pedido', 'Cliente', 'Tipo', 'Prioridad', 'Estado', 'Entrega', 'Creado', 'Ítems'],
      totals: { orders: 'Pedidos', byStatus: 'Por estado' },
    },
    waste: {
      title: 'Reporte de mermas',
      file: 'mermas',
      movementsTitle: 'Mermas registradas',
      riskTitle: 'Productos con riesgo de merma alto hoy',
      movementColumns: ['Fecha', 'Producto', 'Lote', 'Vencimiento', 'Cantidad', 'Unidad', 'Motivo'],
      riskColumns: [
        'Producto',
        'Categoría',
        'Disponible',
        'Unidad',
        'Vence primero',
        'Días',
        'Salida diaria',
      ],
      totals: {
        movements: 'Registros de merma',
        quantity: 'Cantidad dada de baja',
        products: 'Productos en riesgo',
      },
    },
    stockStatus: { OK: 'Normal', LOW: 'Bajo', OUT: 'Sin stock' },
    wasteRisk: { NONE: 'Ninguno', LOW: 'Bajo', HIGH: 'Alto' },
    units: { KG: 'kg', L: 'L', UNIT: 'und.', BOX: 'cajas' },
    categories: {
      FRUITS_VEGETABLES: 'Frutas y verduras',
      DAIRY: 'Lácteos',
      MEAT_POULTRY: 'Carnes y aves',
      FISH: 'Pescados',
      BAKERY: 'Panadería',
      GRAINS_LEGUMES: 'Granos y legumbres',
      CANNED: 'Enlatados',
      BEVERAGES: 'Bebidas',
      FROZEN: 'Congelados',
      OTHER: 'Otros',
    },
    customerTypes: {
      SUPERMARKET: 'Supermercado',
      RESTAURANT: 'Restaurante',
      SCHOOL: 'Colegio',
      HOSPITAL: 'Hospital',
      FOOD_BANK: 'Banco de alimentos',
    },
    priorities: { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', URGENT: 'Urgente' },
    statuses: {
      PENDING: 'Pendiente',
      IN_PREPARATION: 'En preparación',
      READY_FOR_DISPATCH: 'Listo para despacho',
      SHIPPED: 'Enviado',
      DELIVERED: 'Entregado',
      CANCELLED: 'Cancelado',
    },
  },
  en: {
    generated: 'Generated on {date} (Bogota time)',
    page: 'Page {page} of {pages}',
    range: 'From {from} to {to}',
    empty: 'No data for this report.',
    inventory: {
      title: 'Inventory report',
      file: 'inventory',
      columns: [
        'Product',
        'Category',
        'Unit',
        'Available',
        'Minimum',
        'Status',
        'Expires first',
        'Days',
        'Daily outflow',
        'Waste risk',
      ],
      totals: {
        products: 'Active products',
        available: 'Available',
        low: 'Low stock',
        out: 'Out of stock',
        risk: 'High waste risk',
      },
    },
    orders: {
      title: 'Orders report',
      file: 'orders',
      columns: ['Order', 'Customer', 'Type', 'Priority', 'Status', 'Due', 'Created', 'Items'],
      totals: { orders: 'Orders', byStatus: 'By status' },
    },
    waste: {
      title: 'Waste report',
      file: 'waste',
      movementsTitle: 'Recorded waste',
      riskTitle: 'Products with high waste risk today',
      movementColumns: ['Date', 'Product', 'Lot', 'Expiry', 'Quantity', 'Unit', 'Reason'],
      riskColumns: [
        'Product',
        'Category',
        'Available',
        'Unit',
        'Expires first',
        'Days',
        'Daily outflow',
      ],
      totals: {
        movements: 'Waste records',
        quantity: 'Quantity written off',
        products: 'Products at risk',
      },
    },
    stockStatus: { OK: 'Normal', LOW: 'Low', OUT: 'Out of stock' },
    wasteRisk: { NONE: 'None', LOW: 'Low', HIGH: 'High' },
    units: { KG: 'kg', L: 'L', UNIT: 'units', BOX: 'boxes' },
    categories: {
      FRUITS_VEGETABLES: 'Fruits and vegetables',
      DAIRY: 'Dairy',
      MEAT_POULTRY: 'Meat and poultry',
      FISH: 'Fish',
      BAKERY: 'Bakery',
      GRAINS_LEGUMES: 'Grains and legumes',
      CANNED: 'Canned',
      BEVERAGES: 'Beverages',
      FROZEN: 'Frozen',
      OTHER: 'Other',
    },
    customerTypes: {
      SUPERMARKET: 'Supermarket',
      RESTAURANT: 'Restaurant',
      SCHOOL: 'School',
      HOSPITAL: 'Hospital',
      FOOD_BANK: 'Food bank',
    },
    priorities: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' },
    statuses: {
      PENDING: 'Pending',
      IN_PREPARATION: 'In preparation',
      READY_FOR_DISPATCH: 'Ready for dispatch',
      SHIPPED: 'Shipped',
      DELIVERED: 'Delivered',
      CANCELLED: 'Cancelled',
    },
  },
} as const satisfies Record<ReportLocale, unknown>;

export type ReportLabels = (typeof REPORT_LABELS)[ReportLocale];

/** Replaces `{name}` placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
