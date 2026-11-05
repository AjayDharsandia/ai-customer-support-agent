import type { RequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';
import type { ApiSuccess, HealthData } from '../types/api.js';

export interface Readiness {
  databaseConnected: boolean;
  indexesInitialized: boolean;
}
export type ReadinessProbe = () => Readiness;

export function createHealthController(probe: ReadinessProbe): RequestHandler {
  return (request, response) => {
    if (
      Object.keys(request.query).length !== 0 ||
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding'] !== undefined
    ) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Health checks accept no query parameters or body.');
    }
    const state = probe();
    if (!state.databaseConnected || !state.indexesInitialized) {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not ready.');
    }
    const body: ApiSuccess<HealthData> = { success: true, data: { status: 'ok' } };
    response.status(200).json(body);
  };
}
