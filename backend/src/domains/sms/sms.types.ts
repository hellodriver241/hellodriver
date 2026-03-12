/**
 * SMS domain types
 */

export interface OtpStore {
  code: string;
  phone: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  requestHistory: number[]; // Timestamps of OTP requests
}

export interface SendOtpResult {
  success: boolean;
  code?: string;
  error?: string;
}

export interface VerifyOtpResult {
  success: boolean;
  error?: string;
}
