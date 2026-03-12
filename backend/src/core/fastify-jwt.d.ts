import 'fastify';
import type { JwtPayload } from '../domains/auth/auth.types.js';

declare module 'fastify' {
  interface FastifyInstance {
    jwt: {
      sign(payload: JwtPayload, options?: any): string;
      verify(token: string): JwtPayload;
    };
  }

  interface FastifyRequest {
    user?: JwtPayload;
  }
}
