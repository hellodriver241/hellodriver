import { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, errors } from './AppError.js';

/**
 * Global error handler for Fastify
 */
export async function errorHandler(err: Error, request: FastifyRequest, reply: FastifyReply) {
  const logger = request.server.log;

  // Zod validation error
  if (err instanceof ZodError) {
    const details = err.errors.reduce(
      (acc, error) => {
        const path = error.path.join('.');
        acc[path] = error.message;
        return acc;
      },
      {} as Record<string, string>
    );

    const appErr = errors.validationFailed(details);
    logger.warn({ err: appErr }, 'Validation error');
    return reply.code(appErr.statusCode).send(appErr.toJSON());
  }

  // App error
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err }, err.message);
    } else {
      logger.warn({ err }, err.message);
    }
    return reply.code(err.statusCode).send(err.toJSON());
  }

  // Unknown error
  logger.error({ err }, 'Unexpected error');
  const appErr = errors.internalError();
  return reply.code(500).send(appErr.toJSON());
}

/**
 * Authenticate middleware - verify JWT
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    throw errors.unauthorized();
  }
}

/**
 * Admin guard middleware
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply);

  const user = request.user!;
  if (user.role !== 'admin') {
    throw errors.accessDenied();
  }
}

/**
 * Driver role guard
 */
export async function requireDriver(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply);

  const user = request.user!;
  if (user.role !== 'driver') {
    throw errors.accessDenied();
  }
}

/**
 * Client role guard
 */
export async function requireClient(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply);

  const user = request.user!;
  if (user.role !== 'client') {
    throw errors.accessDenied();
  }
}
