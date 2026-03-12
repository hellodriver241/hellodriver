import { z } from 'zod';

/**
 * Gabon phone number format: +241 0[267] + 6-7 digits
 * Valid operators: 2 (Airtel), 6 (Moov), 7 (Airtel)
 */
const gabonPhoneRegex = /^\+2410[267]\d{6,7}$/;

/**
 * Vehicle brand/model validation: alphanumeric, spaces, hyphens
 * Examples: Toyota, BMW, Ford Focus, Renault Scenic
 */
const vehicleNameRegex = /^[a-zA-Z0-9\s\-]{2,100}$/;

/**
 * Validate date of birth is reasonable (18-100 years old)
 */
function validateAge(dateString: string) {
  try {
    const dob = new Date(dateString);
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      return age - 1;
    }
    return age;
  } catch {
    return -1;
  }
}

/**
 * Driver profile completion schema
 * Validates all required fields for driver verification
 */
export const driverProfileSchema = z.object({
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
    .refine(
      (dateString) => {
        const age = validateAge(dateString);
        return age >= 18 && age <= 100;
      },
      'Driver must be between 18 and 100 years old'
    ),
  vehicleBrand: z
    .string()
    .trim()
    .min(2, 'Vehicle brand must be at least 2 characters')
    .max(100, 'Vehicle brand must be at most 100 characters')
    .regex(vehicleNameRegex, 'Vehicle brand contains invalid characters'),
  vehicleYear: z
    .number()
    .int('Vehicle year must be a whole number')
    .min(1990, 'Vehicle year must be 1990 or later')
    .max(new Date().getFullYear(), 'Vehicle year cannot be in the future'),
  vehicleModel: z
    .string()
    .trim()
    .min(2, 'Vehicle model must be at least 2 characters')
    .max(100, 'Vehicle model must be at most 100 characters')
    .regex(vehicleNameRegex, 'Vehicle model contains invalid characters'),
  vehicleRegistration: z
    .string()
    .trim()
    .min(5, 'Vehicle registration must be at least 5 characters')
    .max(50, 'Vehicle registration must be at most 50 characters')
    .regex(/^[A-Z0-9\-]{5,50}$/, 'Invalid registration format (use uppercase letters, numbers, hyphens)'),
  residentialArea: z
    .string()
    .trim()
    .min(2, 'Residential area must be at least 2 characters')
    .max(100, 'Residential area must be at most 100 characters'),
  hasAc: z.boolean().describe('AC availability'),
  mobileMoneyAccount: z
    .string()
    .trim()
    .regex(gabonPhoneRegex, 'Invalid Gabon mobile money account. Use format: +241072123456'),
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
  rejectionReason: z
    .string()
    .trim()
    .max(500, 'Rejection reason must be at most 500 characters')
    .optional(),
});

export type DriverProfileInput = z.infer<typeof driverProfileSchema>;
export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;
export type AdminDocumentActionInput = z.infer<typeof adminDocumentActionSchema>;
