# IMPORTANT NOTES — HelloDriver

**Updated**: 2026-03-12 | **Status**: Phase 1 locked, Phase 2 scope TBD

---

## 🔐 Authentication: Phone OTP ONLY

**Decision:** No OAuth (Google/Facebook) — explicitly excluded, not deferred.

**Why:** SMS universal + Gabon market (Tecno/Infinix, 2G/3G, mobile-money-first) + simpler UX.

**If OAuth added later:** Must verify via SMS re-confirmation. SMS is anchor auth, never standalone OAuth.

---

## 📱 SMS Provider: D7 Networks

**Decision:** D7 Networks (not Twilio, not Airtel direct).

**Why:** Instant approval, explicit Gabon support, no KYC delay.

**Status:** Form submitted. 1-2 days → API key → integrate into `backend/src/services/sms.ts`.

---

## 🌍 Gabon Immutable Facts

- **Operators:** Airtel Money + Moov Money ONLY (NOT MTN)
- **Payment:** pawaPay ONLY
- **Devices:** Tecno/Infinix budget Android, 2G/3G outside Libreville
- **Currency:** XAF (no decimals, integers/NUMERIC)
- **Regulatory:** COBAC license avoided (no bank withdrawals)
- **Language:** French

---

## 🎯 Phase 1 Auth (Locked)

**Implemented:** Phone OTP, JWT, user creation, profile update.

**Mocked:** SMS (console logs until D7 approved).

**NOT implemented:** OAuth, passwords, refresh token rotation, Redis OTP store.

---

## 🚫 DO NOT

- Add passwords
- Implement OAuth in Phase 1
- Use Supabase phone auth provider
- Allow wallet withdrawals to bank
- Store/manage passwords

---

## 📋 Open for Phase 2+

- OAuth as optional secondary method (if users demand it)
- Biometric unlock
- Refresh token rotation
- Redis OTP store

**Rule:** Any future auth method must anchor to SMS for verification.
