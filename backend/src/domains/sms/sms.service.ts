import { config } from '../../core/config.js';
import type { SendOtpResult, VerifyOtpResult, OtpStore } from './sms.types.js';

/**
 * In-memory OTP store (temporary, will use Redis in Phase 3)
 * TODO: Replace with Redis for multi-server deployment
 */
const otpStore = new Map<string, OtpStore>();

/**
 * Generate a 6-digit OTP code
 */
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send OTP to phone number
 * Enforces rate limiting: max 3 requests per 15 minutes
 * Currently mocked to console, awaiting D7 Networks approval
 */
export async function sendOTP(phone: string): Promise<SendOtpResult> {
  if (!phone.match(/^\+241[0-9]{7,9}$/)) {
    return { success: false, error: 'Invalid Gabon phone number format' };
  }

  // Check rate limiting: max 3 requests per 15 minutes
  const now = Date.now();
  const fifteenMinutesAgo = now - 15 * 60 * 1000;

  const stored = otpStore.get(phone);
  const requestHistory = stored?.requestHistory ?? [];

  // Clean up old requests outside the 15-minute window
  const recentRequests = requestHistory.filter(timestamp => timestamp > fifteenMinutesAgo);

  if (recentRequests.length >= 3) {
    return {
      success: false,
      error: 'Too many OTP requests. Please try again later.',
    };
  }

  const code = generateOTP();
  const expiresAt = new Date(now + 10 * 60 * 1000); // 10 minutes

  otpStore.set(phone, {
    code,
    phone,
    expiresAt,
    attempts: 0,
    maxAttempts: 3,
    requestHistory: [...recentRequests, now],
  });

  // Mock: Log to console in development/test
  if (config.NODE_ENV === 'development' || config.NODE_ENV === 'test') {
    console.log(`🔐 OTP for ${phone}: ${code} (expires in 10 min)`);
  }

  // TODO: Send via D7 Networks when API key is available
  // if (config.D7_NETWORKS_API_KEY) {
  //   return sendViaD7(phone, code);
  // }

  return { success: true, code: config.NODE_ENV === 'development' || config.NODE_ENV === 'test' ? code : undefined };
}

/**
 * Verify OTP code for a phone number
 */
export async function verifyOTP(phone: string, code: string): Promise<VerifyOtpResult> {
  const stored = otpStore.get(phone);

  if (!stored) {
    return { success: false, error: 'OTP not found. Please request a new one.' };
  }

  // Check expiry
  if (new Date() > stored.expiresAt) {
    otpStore.delete(phone);
    return { success: false, error: 'OTP has expired. Please request a new one.' };
  }

  // Check attempts
  if (stored.attempts >= stored.maxAttempts) {
    otpStore.delete(phone);
    return { success: false, error: 'Too many failed attempts. Please request a new OTP.' };
  }

  // Check code
  if (stored.code !== code) {
    stored.attempts += 1;
    return {
      success: false,
      error: `Invalid OTP. ${stored.maxAttempts - stored.attempts} attempts remaining.`,
    };
  }

  // Success: clear OTP
  otpStore.delete(phone);
  return { success: true };
}

/**
 * D7 Networks integration (future)
 * Awaiting API key approval
 */
// async function sendViaD7(phone: string, code: string): Promise<SendOtpResult> {
//   try {
//     const response = await fetch('https://api.d7networks.com/otp/send', {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         Authorization: `Bearer ${config.D7_NETWORKS_API_KEY}`,
//       },
//       body: JSON.stringify({
//         to: phone,
//         content: `Your HelloDriver OTP is ${code}. Valid for 10 minutes.`,
//         // ... other D7 fields
//       }),
//     });
//
//     if (!response.ok) {
//       return { success: false, error: 'Failed to send OTP via D7' };
//     }
//
//     return { success: true };
//   } catch (err) {
//     return { success: false, error: (err as Error).message };
//   }
// }
