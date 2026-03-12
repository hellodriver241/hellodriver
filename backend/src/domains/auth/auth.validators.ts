import { z } from 'zod';

/**
 * Phone must be Gabon format: +241 0[267] followed by 6-7 digits
 * Valid second digit: 2 (Airtel), 6 (Moov), 7 (Airtel)
 * Examples: +241072123456 (9 digits total), +24106212345 (8 digits total)
 */
const gabonPhoneRegex = /^\+2410[267]\d{6,7}$/;

/**
 * Name validation: alphanumeric, spaces, hyphens, apostrophes (French names)
 * Must be 2-100 characters after trimming
 */
const nameRegex = /^[a-zA-ZÀ-ÿ]([a-zA-ZÀ-ÿ\s\-']*[a-zA-ZÀ-ÿ])?$/;

export const signupSchema = z.object({
  phone: z.string().trim().regex(gabonPhoneRegex, 'Invalid Gabon phone number. Use format: +241072123456'),
  role: z.enum(['client', 'driver', 'admin']),
  firstName: z.string()
    .trim()
    .min(2, 'First name must be at least 2 characters')
    .max(100, 'First name must be at most 100 characters')
    .regex(nameRegex, 'First name contains invalid characters (use letters, spaces, hyphens, apostrophes)'),
  lastName: z.string()
    .trim()
    .min(2, 'Last name must be at least 2 characters')
    .max(100, 'Last name must be at most 100 characters')
    .regex(nameRegex, 'Last name contains invalid characters (use letters, spaces, hyphens, apostrophes)'),
  email: z.string().email('Invalid email format').toLowerCase().optional().or(z.literal('')),
});

export const otpSchema = z.object({
  phone: z.string().trim().regex(gabonPhoneRegex, 'Invalid Gabon phone number'),
  code: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

export const profileUpdateSchema = z.object({
  firstName: z.string()
    .trim()
    .min(2, 'First name must be at least 2 characters')
    .max(100, 'First name must be at most 100 characters')
    .regex(nameRegex, 'First name contains invalid characters')
    .optional(),
  lastName: z.string()
    .trim()
    .min(2, 'Last name must be at least 2 characters')
    .max(100, 'Last name must be at most 100 characters')
    .regex(nameRegex, 'Last name contains invalid characters')
    .optional(),
  email: z.string().email('Invalid email format').toLowerCase().optional().or(z.literal('')),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type OtpInput = z.infer<typeof otpSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
