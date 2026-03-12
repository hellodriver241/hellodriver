import { z } from 'zod';

/**
 * Phone must be Gabon format: +241 followed by 7-9 digits
 * Examples: +241072123456 (9 digits), +24107212345 (8 digits)
 */
const gabonPhoneRegex = /^\+241[0-9]{7,9}$/;

export const signupSchema = z.object({
  phone: z.string().regex(gabonPhoneRegex, 'Invalid Gabon phone number (+241...)'),
  role: z.enum(['client', 'driver']),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional(),
});

export const otpSchema = z.object({
  phone: z.string().regex(gabonPhoneRegex, 'Invalid Gabon phone number'),
  code: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

export const profileUpdateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type OtpInput = z.infer<typeof otpSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
