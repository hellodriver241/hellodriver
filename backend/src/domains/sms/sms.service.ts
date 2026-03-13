import { config } from '../../core/config.js';
import { getRedis } from '../../plugins/redis.js';
import type { SendOtpResult, VerifyOtpResult, OtpStore } from './sms.types.js';

/**
 * In-memory OTP store — used in test/dev only.
 * Production uses Redis (multi-machine safe).
 */
const otpStore = new Map<string, OtpStore>();

const OTP_TTL_SECONDS = 600; // 10 minutes
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 3;

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function redisKey(phone: string): string {
  return `otp:${phone}`;
}

export async function sendOTP(phone: string): Promise<SendOtpResult> {
  if (!phone.match(/^\+241[0-9]{7,9}$/)) {
    return { success: false, error: 'Invalid Gabon phone number format' };
  }

  const now = Date.now();
  const fifteenMinutesAgo = now - RATE_LIMIT_WINDOW_MS;

  if (config.NODE_ENV === 'production') {
    // --- Redis path (production, multi-machine safe) ---
    const redis = getRedis();
    const raw = await redis.get(redisKey(phone));
    const stored: OtpStore | null = raw ? JSON.parse(raw) : null;
    const recentRequests = (stored?.requestHistory ?? []).filter(ts => ts > fifteenMinutesAgo);

    if (recentRequests.length >= RATE_LIMIT_MAX) {
      return { success: false, error: 'Too many OTP requests. Please try again later.' };
    }

    const code = generateOTP();
    const expiresAt = new Date(now + OTP_TTL_SECONDS * 1000);

    const entry: OtpStore = {
      code,
      phone,
      expiresAt,
      attempts: 0,
      maxAttempts: 3,
      requestHistory: [...recentRequests, now],
    };

    await redis.setex(redisKey(phone), OTP_TTL_SECONDS, JSON.stringify(entry));

    // TODO: Send via D7 Networks when API key is available
    return { success: true };
  } else {
    // --- In-memory path (test/dev) ---
    const stored = otpStore.get(phone);
    const recentRequests = (stored?.requestHistory ?? []).filter(ts => ts > fifteenMinutesAgo);

    if (recentRequests.length >= RATE_LIMIT_MAX) {
      return { success: false, error: 'Too many OTP requests. Please try again later.' };
    }

    const code = generateOTP();
    const expiresAt = new Date(now + OTP_TTL_SECONDS * 1000);

    otpStore.set(phone, {
      code,
      phone,
      expiresAt,
      attempts: 0,
      maxAttempts: 3,
      requestHistory: [...recentRequests, now],
    });

    console.log(`🔐 OTP for ${phone}: ${code} (expires in 10 min)`);
    return { success: true, code };
  }
}

export async function verifyOTP(phone: string, code: string): Promise<VerifyOtpResult> {
  if (config.NODE_ENV === 'production') {
    // --- Redis path ---
    const redis = getRedis();
    const raw = await redis.get(redisKey(phone));

    if (!raw) {
      return { success: false, error: 'OTP not found. Please request a new one.' };
    }

    const stored: OtpStore = JSON.parse(raw);

    if (new Date() > new Date(stored.expiresAt)) {
      await redis.del(redisKey(phone));
      return { success: false, error: 'OTP has expired. Please request a new one.' };
    }

    if (stored.attempts >= stored.maxAttempts) {
      await redis.del(redisKey(phone));
      return { success: false, error: 'Too many failed attempts. Please request a new OTP.' };
    }

    if (stored.code !== code) {
      stored.attempts += 1;
      await redis.setex(redisKey(phone), OTP_TTL_SECONDS, JSON.stringify(stored));
      return {
        success: false,
        error: `Invalid OTP. ${stored.maxAttempts - stored.attempts} attempts remaining.`,
      };
    }

    await redis.del(redisKey(phone));
    return { success: true };
  } else {
    // --- In-memory path ---
    const stored = otpStore.get(phone);

    if (!stored) {
      return { success: false, error: 'OTP not found. Please request a new one.' };
    }

    if (new Date() > stored.expiresAt) {
      otpStore.delete(phone);
      return { success: false, error: 'OTP has expired. Please request a new one.' };
    }

    if (stored.attempts >= stored.maxAttempts) {
      otpStore.delete(phone);
      return { success: false, error: 'Too many failed attempts. Please request a new OTP.' };
    }

    if (stored.code !== code) {
      stored.attempts += 1;
      return {
        success: false,
        error: `Invalid OTP. ${stored.maxAttempts - stored.attempts} attempts remaining.`,
      };
    }

    otpStore.delete(phone);
    return { success: true };
  }
}

/**
 * Get OTP for testing purposes — reads from in-memory store (test/dev only).
 * For E2E tests against production, read directly from Redis: GET otp:{phone}
 */
export function getOTPForTesting(phone: string): string | undefined {
  return otpStore.get(phone)?.code;
}
