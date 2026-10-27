import type { FastifyPluginCallback } from 'fastify';
import type { InventoryController } from './inventory.controller.js';

export interface InventoryRoutesOptions {
  controller: InventoryController;
}

// Mounted under /api/v1/inventory. Roles from the contract, section 4.4.
export const inventoryRoutes: FastifyPluginCallback<InventoryRoutesOptions> = (
  app,
  options,
  done,
) => {
  const { controller } = options;
  const anyRole = { preHandler: [app.authenticate, app.authorize('ADMIN', 'OPERATOR')] };
  const adminOnly = { preHandler: [app.authenticate, app.authorize('ADMIN')] };

  app.get('/lots', anyRole, controller.listLots);
  app.get('/summary', anyRole, controller.summary);
  app.get('/movements', adminOnly, controller.listMovements);
  app.post('/entries', adminOnly, controller.createEntry);
  app.post('/exits', adminOnly, controller.createExit);

  done();
};
