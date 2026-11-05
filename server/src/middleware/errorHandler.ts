import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';
import type { ApiError } from '../types/api.js';

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && error.code === 11000) {
      return new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }
    if ('name' in error && typeof error.name === 'string' && (
      error.name.startsWith('Mongo') || error.name === 'MongooseServerSelectionError'
    )) {
      return new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not ready.');
    }
  }
  if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.too.large') {
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body exceeds 16 KiB.');
    }
    if (error.type === 'entity.parse.failed') {
      return new AppError(400, 'INVALID_JSON', 'The request body must be valid JSON.');
    }
    if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
      return new AppError(400, 'VALIDATION_ERROR', 'Use uncompressed UTF-8 JSON.');
    }
  }
  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  const normalized = normalizeError(error);
  if (normalized.status === 500) {
    // Never log an Axios/Mongoose error object: it may contain credentials or bodies.
    console.error(JSON.stringify({ event: 'http_error', code: normalized.code, status: normalized.status }));
  }
  const body: ApiError = {
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
  };
  response.status(normalized.status).json(body);
};
