import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  bookTrip,
  submitBid,
  acceptBid,
  updateTripStatus,
  getTripById,
  getAvailableTrips,
} from './trip.service.js';
import {
  bookTripSchema,
  submitBidSchema,
  acceptBidSchema,
  updateTripStatusSchema,
} from './trip.validators.js';
import {
  authenticate,
  requireClient,
  requireDriver,
} from '../../shared/errors/handlers.js';

export async function registerTripRoutes(app: FastifyInstance) {
  // POST /trips/book — client books a trip
  app.post(
    '/trips/book',
    { onRequest: [requireClient] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      try {
        const body = bookTripSchema.parse(request.body);
        const result = await bookTrip(userId, body);
        return reply.status(201).send(result);
      } catch (err: any) {
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: err.message },
        });
      }
    }
  );

  // POST /trips/:id/bid — driver submits bid
  app.post(
    '/trips/:id/bid',
    { onRequest: [requireDriver] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      const tripId = (request.params as any).id;
      try {
        const body = submitBidSchema.parse(request.body);
        const bid = await submitBid(userId, tripId, body);
        return reply.status(201).send(bid);
      } catch (err: any) {
        if (err.message.includes('already bid')) {
          return reply.status(409).send({
            error: { code: 'CONFLICT', message: err.message },
          });
        }
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: err.message },
        });
      }
    }
  );

  // PATCH /trips/:id/accept-bid — client accepts a bid
  app.patch(
    '/trips/:id/accept-bid',
    { onRequest: [requireClient] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      const tripId = (request.params as any).id;
      try {
        const body = acceptBidSchema.parse(request.body);
        const trip = await acceptBid(userId, tripId, body.bidId);
        return reply.send(trip);
      } catch (err: any) {
        if (err.message === 'Unauthorized') {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: err.message },
          });
        }
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: err.message },
        });
      }
    }
  );

  // PATCH /trips/:id/status — update trip status (driver or client depending on transition)
  app.patch(
    '/trips/:id/status',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      const tripId = (request.params as any).id;
      try {
        const body = updateTripStatusSchema.parse(request.body);
        const trip = await updateTripStatus(userId, tripId, body);
        return reply.send(trip);
      } catch (err: any) {
        if (err.message === 'Unauthorized' || err.message.includes('Only the')) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: err.message },
          });
        }
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: err.message },
        });
      }
    }
  );

  // GET /trips/available — list available trips for driver (must be before /:id)
  app.get(
    '/trips/available',
    { onRequest: [requireDriver] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      const { latitude, longitude } = request.query as {
        latitude?: string;
        longitude?: string;
      };

      if (!latitude || !longitude) {
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: 'latitude and longitude required' },
        });
      }

      try {
        const availableTrips = await getAvailableTrips(
          userId,
          Number(latitude),
          Number(longitude)
        );
        return reply.send(availableTrips);
      } catch (err: any) {
        return reply.status(500).send({
          error: { code: 'INTERNAL_SERVER_ERROR', message: err.message },
        });
      }
    }
  );

  // GET /trips/:id — get trip details
  app.get(
    '/trips/:id',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      const tripId = (request.params as any).id as string;
      try {
        const result = await getTripById(userId, tripId);
        return reply.send(result);
      } catch (err: any) {
        if (err.message === 'Unauthorized') {
          // Return 404 to avoid leaking that the trip exists
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Trip not found' },
          });
        }
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: err.message },
        });
      }
    }
  );
}
