import { z } from 'zod';

/**
 * Driver GPS location update schema
 * Latitude: -90 to 90, Longitude: -180 to 180
 * Precision: 7 decimal places (~1.1cm accuracy)
 */
export const locationUpdateSchema = z.object({
  latitude: z
    .number()
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90'),
  longitude: z
    .number()
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180'),
  speed: z.number().min(0, 'Speed cannot be negative').optional(),
  bearing: z
    .number()
    .min(0, 'Bearing must be between 0 and 360')
    .max(360, 'Bearing must be between 0 and 360')
    .optional(),
  accuracy: z.number().min(0, 'Accuracy cannot be negative').optional(),
});

/**
 * Online status toggle schema
 */
export const onlineToggleSchema = z.object({
  isOnline: z.boolean().describe('Whether driver wants to go online'),
});

export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
export type OnlineToggleInput = z.infer<typeof onlineToggleSchema>;
