import type { FastifyError, FastifyPluginCallback, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError, type ErrorCode, type ErrorDetails } from '../shared/errors/index.js';

export interface ErrorHandlerOptions {
  /** When true, stack traces and internal messages are never sent to clients. */
  isProduction: boolean;
}

interface ErrorBody {
  error: { code: ErrorCode; message: string; details: ErrorDetails };
}

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'DUPLICATE',
  429: 'TOO_MANY_REQUESTS',
};

function send(
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  message: string,
  details: ErrorDetails = {},
): FastifyReply {
  const body: ErrorBody = { error: { code, message, details } };
  return reply.status(statusCode).send(body);
}

function zodDetails(error: ZodError): ErrorDetails {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

function isFastifyError(error: unknown): error is FastifyError {
  return error instanceof Error && 'statusCode' in error;
}

const errorHandlerPlugin: FastifyPluginCallback<ErrorHandlerOptions> = (app, options, done) => {
  app.setNotFoundHandler((request, reply) =>
    send(reply, 404, 'NOT_FOUND', `Route ${request.method} ${request.url} not found`),
  );

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return send(reply, error.statusCode, error.code, error.message, error.details);
    }

    if (error instanceof ZodError) {
      return send(reply, 400, 'VALIDATION_ERROR', 'Invalid request', zodDetails(error));
    }

    if (isFastifyError(error) && error.validation) {
      return send(reply, 400, 'VALIDATION_ERROR', error.message, {
        issues: error.validation,
      });
    }

    const statusCode = isFastifyError(error) ? (error.statusCode ?? 500) : 500;
    if (statusCode >= 400 && statusCode < 500) {
      const code = STATUS_TO_CODE[statusCode] ?? 'VALIDATION_ERROR';
      return send(reply, statusCode, code, (error as Error).message);
    }

    request.log.error({ err: error }, 'Unhandled error');
    if (options.isProduction) {
      return send(reply, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
    const err = error instanceof Error ? error : new Error(String(error));
    return send(reply, 500, 'INTERNAL_ERROR', err.message, { stack: err.stack });
  });

  done();
};

export default fp(errorHandlerPlugin, { name: 'error-handler', fastify: '5.x' });
