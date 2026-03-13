import { z } from 'zod';

export const bookTripSchema = z.object({
  originLatitude: z.number().min(-90).max(90, 'Invalid latitude'),
  originLongitude: z.number().min(-180).max(180, 'Invalid longitude'),
  originAddress: z.string().max(255).optional(),

  destinationLatitude: z.number().min(-90).max(90, 'Invalid latitude'),
  destinationLongitude: z.number().min(-180).max(180, 'Invalid longitude'),
  destinationAddress: z.string().max(255).optional(),
});

export const submitBidSchema = z.object({
  amountXaf: z.number().int().min(500).max(50000, 'Bid amount must be between 500–50,000 XAF'),
  etaMinutes: z.number().int().min(1).max(60, 'ETA must be between 1–60 minutes'),
});

export const acceptBidSchema = z.object({
  bidId: z.string().uuid('Invalid bid ID'),
});

export const updateTripStatusSchema = z.object({
  status: z.enum([
    'driver_en_route',
    'driver_arrived',
    'in_transit',
    'completed',
    'cancelled_by_client',
    'cancelled_by_driver',
  ]),
});

export type BookTripInput = z.infer<typeof bookTripSchema>;
export type SubmitBidInput = z.infer<typeof submitBidSchema>;
export type AcceptBidInput = z.infer<typeof acceptBidSchema>;
export type UpdateTripStatusInput = z.infer<typeof updateTripStatusSchema>;
