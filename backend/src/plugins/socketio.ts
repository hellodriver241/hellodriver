import { Server } from 'socket.io';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Server as HTTPServer } from 'http';
import { config } from '../core/config.js';

let io: Server | null = null;

/**
 * Initialize Socket.io server
 * Uses WebSocket transport only (per CLAUDE.md rule 8)
 */
export function initializeSocketIO(httpServer: HTTPServer): Server {
  if (io) {
    return io;
  }

  // HS256 JWT verifier using Node.js built-in crypto.
  // Validates algorithm header to prevent alg:none / algorithm-confusion attacks.
  function verifyJwt(token: string): { sub: string; role: string } {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');
    const [headerB64, payloadB64, signature] = parts;

    // Reject tokens that are not HS256 — prevents alg:none attack
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    if (header.alg !== 'HS256') throw new Error('Unsupported algorithm');

    const expected = createHmac('sha256', config.JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    // timingSafeEqual requires equal-length buffers
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new Error('Invalid JWT signature');
    }

    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (decoded.exp && Date.now() / 1000 > decoded.exp) {
      throw new Error('JWT expired');
    }
    return decoded;
  }

  io = new Server(httpServer, {
    transports: ['websocket'],
    cors: {
      // Lock down to known client origins; default to localhost for development
      origin: process.env.CLIENT_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
    },
  });

  // JWT authentication middleware — every socket must present a valid Bearer token
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = verifyJwt(token);
      if (!decoded?.sub) {
        return next(new Error('Invalid token'));
      }
      socket.data.userId = decoded.sub;
      socket.data.role = decoded.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    // Driver/client joins their trip room to receive real-time updates
    socket.on('join:trip', (tripId: string) => {
      socket.join(`trip:${tripId}`);
    });

    socket.on('leave:trip', (tripId: string) => {
      socket.leave(`trip:${tripId}`);
    });
  });

  console.log('✓ Socket.io initialized');
  return io;
}

/**
 * Get Socket.io instance (must call initializeSocketIO first)
 */
export function getIO(): Server {
  if (!io) {
    throw new Error('Socket.io not initialized. Call initializeSocketIO() first.');
  }
  return io;
}

/**
 * Close Socket.io server
 */
export async function closeSocketIO(): Promise<void> {
  if (io) {
    await io.close();
    io = null;
  }
}
