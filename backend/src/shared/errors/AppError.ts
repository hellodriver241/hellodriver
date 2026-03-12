/**
 * Standard application error with HTTP status and error code
 */

export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

/**
 * Predefined error factories
 */

export const errors = {
  // Auth errors
  invalidOtp: (message = 'Invalid or expired OTP') =>
    new AppError('INVALID_OTP', message, 400),

  otpSendFailed: (message = 'Failed to send OTP') =>
    new AppError('OTP_SEND_FAILED', message, 500),

  userNotFound: () =>
    new AppError('USER_NOT_FOUND', 'User not found', 404),

  unauthorized: () =>
    new AppError('UNAUTHORIZED', 'Unauthorized', 401),

  // Driver errors
  driverProfileNotFound: () =>
    new AppError('DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found', 404),

  driverNotVerified: () =>
    new AppError('DRIVER_NOT_VERIFIED', 'Driver must be verified before going online', 403),

  documentUploadFailed: (message = 'Document upload failed') =>
    new AppError('DOCUMENT_UPLOAD_FAILED', message, 500),

  allDocumentsRequired: () =>
    new AppError(
      'ALL_DOCUMENTS_REQUIRED',
      'All 3 documents (license, ID, insurance) are required',
      400
    ),

  // Admin errors
  accessDenied: () =>
    new AppError('ACCESS_DENIED', 'You do not have permission to access this resource', 403),

  documentNotFound: () =>
    new AppError('DOCUMENT_NOT_FOUND', 'Document not found', 404),

  // Validation errors
  validationFailed: (details: Record<string, any>) =>
    new AppError('VALIDATION_FAILED', 'Validation failed', 400, details),

  // Generic errors
  internalError: (message = 'Internal server error') =>
    new AppError('INTERNAL_ERROR', message, 500),

  notFound: (resource: string) =>
    new AppError('NOT_FOUND', `${resource} not found`, 404),

  conflict: (message: string) =>
    new AppError('CONFLICT', message, 409),
};
