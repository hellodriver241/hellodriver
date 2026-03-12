import { z } from 'zod';

export const phoneSchema = z
  .string()
  .regex(/^\+241[0-9]{7,8}$/, 'Format: +241701234567 (Gabon format)');

export const roleSchema = z.enum(['client', 'driver']);

export const signupSchema = z.object({
  role: roleSchema,
  phone: phoneSchema,
  firstName: z.string().min(2, 'First name must be at least 2 characters').max(100),
  lastName: z.string().min(2, 'Last name must be at least 2 characters').max(100),
  email: z.string().email().optional(),
});

export const otpSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6, 'Code must be 6 digits').regex(/^[0-9]{6}$/, 'Code must contain only digits'),
});

export const documentUploadSchema = z.object({
  documentType: z.enum(['license', 'id', 'insurance', 'vehicle_photo']),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type OTPInput = z.infer<typeof otpSchema>;
export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;
