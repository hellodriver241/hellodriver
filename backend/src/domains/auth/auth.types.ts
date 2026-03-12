/**
 * Auth domain types
 */

export interface User {
  id: string;
  authId: string;
  role: 'client' | 'driver' | 'admin';
  phone: string;
  firstName: string;
  lastName: string;
  email?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientProfile {
  id: string;
  userId: string;
  phoneVerified: boolean;
  emailVerified: boolean;
  createdAt: Date;
}

export interface DriverProfile {
  id: string;
  userId: string;
  dateOfBirth?: string;
  vehicleBrand?: string;
  vehicleYear?: number;
  vehicleModel?: string;
  vehicleRegistration?: string;
  residentialArea?: string;
  hasAc?: boolean;
  mobileMoneyAccount?: string;
  isVerified: boolean;
  verificationStatus: 'pending' | 'approved' | 'rejected';
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthRequest {
  user: {
    sub: string; // userId
    role: string;
    phone: string;
  };
}

export interface JwtPayload {
  sub: string;
  role: 'client' | 'driver' | 'admin';
  phone: string;
  type: 'access' | 'refresh'; // Token type for validation
  iat?: number;
  exp?: number;
}
