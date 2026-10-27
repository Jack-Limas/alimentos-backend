import type { CustomerStatus, CustomerType } from '@prisma/client';

export interface CustomerItem {
  name: string;
  type: CustomerType;
  address: string;
  phone: string | null;
  email: string | null;
  status: CustomerStatus;
}

const customer = (
  name: string,
  type: CustomerType,
  address: string,
  phone: string | null,
  email: string | null,
  status: CustomerStatus = 'ACTIVE',
): CustomerItem => ({ name, type, address, phone, email, status });

/**
 * Fictional customers of a Bogota distributor, one of every type and at least
 * two food banks. Emails use the reserved example.com domain.
 */
export const CUSTOMERS: readonly CustomerItem[] = [
  // Supermercados
  customer(
    'Supermercado La Canasta',
    'SUPERMARKET',
    'Cra 13 # 63-27, Chapinero, Bogotá',
    '601 345 1200',
    'compras.lacanasta@example.com',
  ),
  customer(
    'Mercados El Vecino',
    'SUPERMARKET',
    'Av Suba # 115-40, Suba, Bogotá',
    '601 682 4410',
    'pedidos.elvecino@example.com',
  ),
  customer(
    'Autoservicio Don Pedro',
    'SUPERMARKET',
    'Cl 38 Sur # 78-15, Kennedy, Bogotá',
    '310 455 2318',
    null,
  ),
  customer(
    'Superahorro Fontibón',
    'SUPERMARKET',
    'Cra 100 # 17-52, Fontibón, Bogotá',
    '601 418 9033',
    'superahorro@example.com',
  ),

  // Restaurantes
  customer(
    'Restaurante Sabor Santafereño',
    'RESTAURANT',
    'Cl 11 # 4-21, La Candelaria, Bogotá',
    '601 281 7754',
    'cocina.santafereno@example.com',
  ),
  customer(
    'Asadero El Fogón de Usaquén',
    'RESTAURANT',
    'Cra 6A # 119-12, Usaquén, Bogotá',
    '315 802 6671',
    null,
  ),
  customer(
    'Corrientazo La Sazón',
    'RESTAURANT',
    'Cl 45 # 19-08, Teusaquillo, Bogotá',
    '320 117 4590',
    null,
  ),
  customer(
    'Restaurante Mar y Tierra',
    'RESTAURANT',
    'Cra 11 # 93-45, Chicó, Bogotá',
    '601 636 2287',
    'reservas.marytierra@example.com',
    'INACTIVE',
  ),

  // Colegios
  customer(
    'Colegio Distrital Nueva Esperanza',
    'SCHOOL',
    'Cl 68 Sur # 49-30, Ciudad Bolívar, Bogotá',
    '601 779 1045',
    'alimentacion.nuevaesperanza@example.com',
  ),
  customer(
    'Colegio Campestre Los Pinos',
    'SCHOOL',
    'Km 3 vía La Calera, Usaquén, Bogotá',
    '601 860 3321',
    'compras.lospinos@example.com',
  ),
  customer(
    'Jardín Infantil Pequeños Pasos',
    'SCHOOL',
    'Cra 24 # 1-60 Sur, Santa Isabel, Bogotá',
    '313 640 7782',
    null,
  ),

  // Hospitales y clínicas
  customer(
    'Clínica San Rafael del Norte',
    'HOSPITAL',
    'Cl 134 # 9-51, Usaquén, Bogotá',
    '601 589 6600',
    'nutricion.sanrafael@example.com',
  ),
  customer(
    'Hospital Comunitario El Tunal',
    'HOSPITAL',
    'Cra 20 # 47B-35 Sur, Tunjuelito, Bogotá',
    '601 762 2010',
    'suministros.eltunal@example.com',
  ),

  // Bancos de alimentos
  customer(
    'Banco de Alimentos Comunidad Solidaria',
    'FOOD_BANK',
    'Cl 19 # 32-50, Puente Aranda, Bogotá',
    '601 247 3390',
    'donaciones.solidaria@example.com',
  ),
  customer(
    'Fundación Mesa Compartida',
    'FOOD_BANK',
    'Cra 72 # 2-15, Bosa, Bogotá',
    '311 908 5527',
    'contacto.mesacompartida@example.com',
  ),
];
