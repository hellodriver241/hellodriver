/**
 * Driver domain types
 */

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

export interface DriverDocument {
  id: string;
  userId: string;
  documentType: 'drivers_license' | 'id_card' | 'vehicle_insurance';
  storageUrl?: string;
  uploadStatus: 'pending' | 'verified' | 'rejected';
  rejectionReason?: string;
  uploadedAt: Date;
  verifiedAt?: Date;
  verifiedByAdminId?: string;
}

export interface VerificationLog {
  id: string;
  userId: string;
  action: 'doc_uploaded' | 'doc_approved' | 'doc_rejected' | 'driver_approved' | 'driver_rejected';
  adminId?: string;
  details?: string;
  createdAt: Date;
}

export interface VerificationStatus {
  isVerified: boolean;
  verificationStatus: 'pending' | 'approved' | 'rejected';
  verifiedAt?: Date;
  documents: DriverDocument[];
  verifiedDocsCount: number;
  totalDocsRequired: number;
  allDocsVerified: boolean;
}
