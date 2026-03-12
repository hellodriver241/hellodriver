# Phase 1: Auth + Profile Setup — Deep Dive & Inconsistencies Spotted

**Status**: Research Complete ✅ | Design Issues Identified | Solutions Proposed

---

## Executive Summary

Phase 1 foundation is **Auth + Profile Setup for both Client & Driver roles**. However, the Figma designs, previous docs, and CLAUDE.md have **5 critical inconsistencies** that must be resolved before implementation.

---

## Critical Inconsistencies Found

### 1. **Mobile Money Operators in Auth UI ❌**

**Inconsistency**:
- HELLODRIVER_DESIGN_MASTERY mentions: "Payment options → Card, Mobile Money: **MTN, Airtel, etc.**"
- FINAL_STACK corrected: "**Airtel + Moov Money** (MTN does NOT operate in Gabon)"
- oauth_credentials.md shows: Google + Facebook, no mention of mobile money

**Issue**:
- Design likely shows MTN as payment option (WRONG for Gabon)
- Payment method selection at signup is premature (should be at booking time)
- Phase 1 auth should NOT mention payment operators at all

**Proposal**:
- ✅ Phase 1: Auth only (phone OTP, Google, Facebook, role selection)
- ✅ Payment method selection deferred to Phase 3 (payment integration) or Phase 4 (booking flow)
- ✅ Remove all payment UI from auth screens

---

### 2. **Driver Verification Workflow Timing ❌**

**Inconsistency**:
- ROADMAP Phase 1 includes: "Document upload... Driver admin verification workflow (pending → approved)"
- But Phase 1 is supposed to be just "Auth + Profile Setup"
- CLAUDE.md Phase 1 says: "Registration, documents, GPS heartbeat, online/offline toggle"
- Previous Phase 4 driver app had stub implementation without real doc verification

**Issue**:
- Document verification requires admin review system (not ready for Phase 1)
- Backend needs admin routes + Supabase Storage setup
- Should this be Phase 1 or Phase 2?

**Proposal**:
- ✅ **Phase 1**: Driver registration API + document upload to Supabase Storage
- ✅ Documents stored but status = `pending_verification` (no admin review yet)
- ✅ Driver can sign up but can't go online until verified (check in Phase 2)
- ✅ Admin verification routes deferred to Phase 2 (after trip matching is ready)

---

### 3. **OTP Fallback Strategy Timing ❌**

**Inconsistency**:
- FINAL_STACK says: "OTP fallback: WhatsApp first → SMS fallback (waterfall via BullMQ)"
- But this is Phase 5 (WhatsApp Bot) feature, not Phase 1
- Supabase Auth already handles SMS OTP natively

**Issue**:
- WhatsApp fallback requires Phase 5 infrastructure (Meta Cloud API, BullMQ workers)
- Phase 1 should be simple: just Supabase phone OTP

**Proposal**:
- ✅ Phase 1: Simple Supabase phone OTP (+241 format) only
- ✅ SMS fallback added later (if Supabase SMS provider fails)
- ✅ WhatsApp fallback deferred to Phase 5 (full WhatsApp integration)

---

### 4. **Client vs Driver Auth Role Selection ❌**

**Inconsistency**:
- Figma design shows: "Splash → Phone Login → Home Dashboard"
- Unclear: when does user select "I'm a client" vs "I'm a driver"?
- Previous mobile apps had Zustand stores with role, but signup flow not clear

**Issue**:
- If roles are selected during signup, two separate signup flows needed
- If roles are selected post-signup, complexity in profile setup
- Design doesn't show this clearly

**Proposal**:
- ✅ **Role selection on Splash Screen** (before any auth)
  ```
  Splash screen with 3 buttons:
  1. "Je suis Client" (I'm a Client)
  2. "Je suis Chauffeur" (I'm a Driver)
  3. No button → defaults to Client
  ```
- ✅ Pass role to signup flow: `POST /auth/signup { role: 'client' | 'driver', phone, ... }`
- ✅ Backend creates user + associated profile (user_profiles or driver_profiles)
- ✅ Token includes role claim: `app_metadata.role`

---

### 5. **Payment Method vs Phone Number Format ❌**

**Inconsistency**:
- oauth_credentials.md: Google + Facebook setup (Web + Android)
- But Gabon market data says: 90% Android, minimal social media adoption
- Previous mobile app had phone login validation: `/^\+2410[267]\d{6,7}$/`
- But this phone format regex is wrong for Gabon (should be `/^\+241[0-9]{7,8}$/`)

**Issue**:
- OAuth (Google/Facebook) may not be viable for Gabon market
- Phone OTP is primary auth method (more reliable for emerging markets)
- Phone format validation needs correction

**Proposal**:
- ✅ **Priority 1**: Phone OTP (primary for Gabon)
  - Format: `+241` (Gabon code) + 7-8 digits
  - Regex: `/^\+241[0-9]{7,8}$/`
- ✅ **Priority 2**: Google (if user has Google account)
- ✅ **Priority 3**: Facebook (if user has Facebook account)
- ✅ Phone format validation corrected in Supabase Auth config

---

## Phase 1 Auth Architecture (Proposed)

### Backend Flow

```
User clicks "I'm a Client" or "I'm a Driver"
  ↓
Frontend sends role to signup
  ↓
POST /auth/signup
  {
    "role": "client" | "driver",
    "phone": "+241701234567",
    "firstName": "Jean",
    "lastName": "Paul",
    "provider": "phone" | "google" | "facebook"
  }
  ↓
Backend:
  1. Call Supabase Auth sign up (phone OTP or OAuth)
  2. Create users row (auth_id, role, created_at)
  3. Create client_profiles OR driver_profiles row
  4. Return JWT token + user metadata
  ↓
Frontend redirects to:
  - Client: Home Screen (booking)
  - Driver: Document Upload Screen (pending verification)
```

### Database Changes Needed

```sql
-- users table (if not exists)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  role TEXT NOT NULL CHECK (role IN ('client', 'driver')),
  phone TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- client_profiles table
CREATE TABLE client_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone_verified BOOLEAN DEFAULT false,
  email_verified BOOLEAN DEFAULT false,
  preferred_payment_method TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- driver_profiles table
CREATE TABLE driver_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone_verified BOOLEAN DEFAULT false,
  verification_status TEXT DEFAULT 'pending_verification',
  vehicle_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- documents table (for driver licenses, IDs, insurance)
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id UUID NOT NULL REFERENCES driver_profiles(id),
  document_type TEXT NOT NULL, -- 'license', 'id', 'insurance', 'vehicle_photo'
  storage_path TEXT NOT NULL, -- Supabase Storage path
  status TEXT DEFAULT 'pending_review', -- pending_review, approved, rejected
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id), -- admin who reviewed
  expiry_date DATE,
  notes TEXT
);
```

### API Endpoints (Phase 1)

```
POST /auth/signup
  - Request: { role, phone, firstName, lastName, provider }
  - Response: { user, token, refreshToken }

POST /auth/login
  - Request: { phone, password } OR { provider, idToken }
  - Response: { user, token, refreshToken }

POST /auth/verify-otp
  - Request: { phone, code }
  - Response: { user, token, refreshToken }

GET /auth/me
  - Response: { user, profile (client_profiles or driver_profiles) }

PATCH /auth/profile
  - Request: { firstName, lastName, email, ... }
  - Response: { user, profile }

POST /driver/documents
  - Request: FormData { documentType, file }
  - Response: { document }

GET /driver/documents
  - Response: [{ document }]
```

---

## Figma Design Corrections Needed

### **Splash Screen**
- **Current**: Likely just logo + "Next"
- **Proposed**:
  - Logo
  - Two prominent buttons: "Je suis Client" | "Je suis Chauffeur"
  - Or: Role selector with radio buttons
  - **Consistency**: Ensure French labels match across all screens

### **Phone Login Screen**
- **Current**: Phone input field
- **Fix**:
  - Add country code selector: +241 (preset, not selectable)
  - Format: +241 [7-8 digits]
  - Remove any payment method selection
  - Remove social OAuth buttons if not testing

### **Profile Setup Screen (Client)**
- **Current**: Likely basic fields
- **Proposed**:
  - First name + Last name (required)
  - Email (optional, can add later)
  - No payment method selection (defer to checkout)
  - Success: Redirect to Home screen

### **Profile Setup Screen (Driver)**
- **Current**: Likely shows vehicle fields
- **Proposed**:
  - First name + Last name (required)
  - Email (optional)
  - **Then**: Document Upload screen (license, ID, insurance, vehicle photo)
  - Status badge: "Documents Pending Review"
  - Driver cannot toggle online until verified
  - **Consistency**: Show upload progress/status clearly

### **Remove from Phase 1**
- ❌ Payment method selection (Phase 3/4)
- ❌ Mobile money operator selection (Phase 3)
- ❌ Bank account entry (Phase 3 for driver payouts)
- ❌ WhatsApp/SMS options (Phase 5)

---

## Implementation Checklist (Phase 1)

### Backend (Week 1)
- [ ] Create users, client_profiles, driver_profiles, documents tables
- [ ] Supabase Auth config: phone OTP + Google + Facebook
- [ ] POST /auth/signup (Supabase + DB creation)
- [ ] POST /auth/verify-otp
- [ ] GET /auth/me (return user + profile + role)
- [ ] PATCH /auth/profile
- [ ] POST /driver/documents (Supabase Storage upload)
- [ ] GET /driver/documents

### Frontend - Client App (Week 1-2)
- [ ] Splash screen with role selector
- [ ] Phone login screen with +241 prefix
- [ ] Phone OTP verification screen
- [ ] Profile setup screen (name, email)
- [ ] Home dashboard (placeholder for booking)
- [ ] Auth state management (Zustand)

### Frontend - Driver App (Week 1-2)
- [ ] Splash screen with role selector
- [ ] Phone login + OTP screens
- [ ] Profile setup screen (name, email)
- [ ] Document upload screen (4 document types)
- [ ] Verification pending screen (status badge)
- [ ] Dashboard (locked until verified)
- [ ] Auth state management (Zustand)

### Testing
- [ ] Integration tests: signup → login → get profile
- [ ] Phone format validation tests
- [ ] Role-based redirect tests (client vs driver)
- [ ] Document upload tests (Supabase Storage mock)

---

## Next Steps

1. **Figma Review**: User provides link to design file (or screenshots of auth screens)
2. **Database Schema**: Confirm tables match HelloDriver schema.sql
3. **Supabase Config**: Set up phone OTP + OAuth providers
4. **Backend Implementation**: Start with POST /auth/signup
5. **Mobile Implementation**: Parallel with backend (Zustand auth store)

---

**Last Updated**: 2026-03-12
**Author**: Claude (Full HelloDriver Owner)
**Status**: ✅ Ready for Implementation
