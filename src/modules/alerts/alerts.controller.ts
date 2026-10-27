import type { Alert } from './domain/index.js';
import type { AlertsService } from './alerts.service.js';

export interface AlertsController {
  list: () => Promise<{ data: Alert[] }>;
}

export function createAlertsController(service: AlertsService): AlertsController {
  return {
    list: async () => ({ data: await service.list() }),
  };
}
