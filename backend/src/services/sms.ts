import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

/**
 * SMS Service using Airtel Money API for Gabon
 * Handles OTP generation and sending via SMS
 */

interface SMSRequest {
  phone: string;
  message: string;
}

interface OTPRecord {
  code: string;
  phone: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
}

// In-memory store for OTPs (replace with Redis in production)
const otpStore = new Map<string, OTPRecord>();

/**
 * Generate a 6-digit OTP code
 */
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send OTP via Airtel SMS API
 * For development: logs OTP to console instead of sending
 */
export async function sendOTP(phone: string): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    // Validate phone format: +241XXXXXXXXX
    if (!phone.match(/^\+241[0-9]{7,8}$/)) {
      return { success: false, error: 'Invalid Gabon phone number format' };
    }

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP
    otpStore.set(phone, {
      code,
      phone,
      expiresAt,
      attempts: 0,
      maxAttempts: 3,
    });

    // TODO: Integrate with Airtel Money API
    // For now, log to console for development
    if (process.env.NODE_ENV === 'development') {
      console.log(`\n🔐 OTP for ${phone}: ${code}`);
      console.log(`   Expires at: ${expiresAt.toISOString()}\n`);
    }

    // In production, call Airtel Money API:
    // const airtexResponse = await sendAirtexSMS(phone, `Your HelloDriver OTP is: ${code}`);
    // if (!airtexResponse.success) {
    //   return { success: false, error: 'Failed to send SMS' };
    // }

    return { success: true, code: process.env.NODE_ENV === 'development' ? code : undefined };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Verify OTP code for a phone number
 */
export async function verifyOTP(phone: string, code: string): Promise<{ success: boolean; error?: string }> {
  try {
    const record = otpStore.get(phone);

    if (!record) {
      return { success: false, error: 'No OTP found for this phone number' };
    }

    // Check expiration
    if (new Date() > record.expiresAt) {
      otpStore.delete(phone);
      return { success: false, error: 'OTP has expired' };
    }

    // Check attempts
    if (record.attempts >= record.maxAttempts) {
      otpStore.delete(phone);
      return { success: false, error: 'Too many failed attempts' };
    }

    // Verify code
    if (record.code !== code) {
      record.attempts += 1;
      return { success: false, error: 'Invalid OTP code' };
    }

    // Success: delete OTP record
    otpStore.delete(phone);
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * TODO: Implement Airtel Money SMS Gateway
 * Example integration with Airtel Money API
 */
async function sendAirtexSMS(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    const airtexApiUrl = 'https://openapi.airtel.africa/merchant/v1/send';
    const airtexApiKey = process.env.AIRTEL_API_KEY || '';

    // Build request signature
    const payload = {
      phone,
      message,
      timestamp: new Date().toISOString(),
    };

    const signature = crypto
      .createHmac('sha256', airtexApiKey)
      .update(JSON.stringify(payload))
      .digest('hex');

    const response = await fetch(airtexApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'Authorization': `Bearer ${airtexApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}
