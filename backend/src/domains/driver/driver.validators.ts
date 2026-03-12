import { z } from 'zod';

/**
 * Driver profile completion schema
 */
export const driverProfileSchema = z.object({
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  vehicleBrand: z.string().min(1).max(100),
  vehicleYear: z.number().int().min(1900).max(new Date().getFullYear()),
  vehicleModel: z.string().min(1).max(100),
  vehicleRegistration: z.string().min(1).max(50),
  residentialArea: z.string().min(1).max(100),
  hasAc: z.boolean(),
  mobileMoneyAccount: z.string().regex(/^\+241[0-9]{7,8}$/, 'Invalid Gabon mobile money account format'),
});

/**
 * Document upload schema
 */
export const documentUploadSchema = z.object({
  documentType: z.enum(['drivers_license', 'id_card', 'vehicle_insurance']),
});

/**
 * Admin document action schema (approve/reject)
 */
export const adminDocumentActionSchema = z.object({
  rejectionReason: z.string().max(500).optional(),
});

export type DriverProfileInput = z.infer<typeof driverProfileSchema>;
export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;
export type AdminDocumentActionInput = z.infer<typeof adminDocumentActionSchema>;
