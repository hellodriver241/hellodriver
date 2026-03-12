import { getDatabase } from '../../db/index.js';
import { driverProfiles, driverDocuments, driverVerificationLog } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { DriverProfile, DriverDocument, VerificationStatus } from './driver.types.js';

/**
 * Update driver profile with personal and vehicle information
 */
export async function updateDriverProfile(
  userId: string,
  data: {
    dateOfBirth: string;
    vehicleBrand: string;
    vehicleYear: number;
    vehicleModel: string;
    vehicleRegistration: string;
    residentialArea: string;
    hasAc: boolean;
    mobileMoneyAccount: string;
  }
): Promise<DriverProfile> {
  const db = getDatabase();

  const [driver] = await db
    .update(driverProfiles)
    .set({
      dateOfBirth: data.dateOfBirth,
      vehicleBrand: data.vehicleBrand,
      vehicleYear: data.vehicleYear,
      vehicleModel: data.vehicleModel,
      vehicleRegistration: data.vehicleRegistration,
      residentialArea: data.residentialArea,
      hasAc: data.hasAc,
      mobileMoneyAccount: data.mobileMoneyAccount,
      updatedAt: new Date(),
    })
    .where(eq(driverProfiles.userId, userId))
    .returning();

  if (!driver) {
    throw new Error('Failed to update driver profile');
  }

  return driver as DriverProfile;
}

/**
 * Get driver profile
 */
export async function getDriverProfile(userId: string): Promise<DriverProfile | undefined> {
  const db = getDatabase();

  const profile = await db.query.driverProfiles.findFirst({
    where: eq(driverProfiles.userId, userId),
  });

  return profile as DriverProfile | undefined;
}

/**
 * Record a document upload in the database
 */
export async function recordDocumentUpload(
  userId: string,
  documentType: string,
  storageUrl: string
) {
  const db = getDatabase();

  // Delete existing document of same type if present
  await db
    .delete(driverDocuments)
    .where(
      and(eq(driverDocuments.userId, userId), eq(driverDocuments.documentType, documentType))
    );

  // Insert new document record
  const [doc] = await db
    .insert(driverDocuments)
    .values({
      id: uuidv4(),
      userId,
      documentType,
      storageUrl,
      uploadStatus: 'pending',
      uploadedAt: new Date(),
    })
    .returning();

  // Log the upload
  await db.insert(driverVerificationLog).values({
    id: uuidv4(),
    userId,
    action: 'doc_uploaded',
    details: `Uploaded ${documentType}`,
    createdAt: new Date(),
  });

  return doc as DriverDocument;
}

/**
 * Get all documents for a driver
 */
export async function getDriverDocuments(userId: string): Promise<DriverDocument[]> {
  const db = getDatabase();

  const docs = await db.query.driverDocuments.findMany({
    where: eq(driverDocuments.userId, userId),
  });

  return docs as DriverDocument[];
}

/**
 * Get verification status for a driver
 */
export async function getVerificationStatus(userId: string): Promise<VerificationStatus> {
  const db = getDatabase();

  const profile = await db.query.driverProfiles.findFirst({
    where: eq(driverProfiles.userId, userId),
  });

  const docs = await db.query.driverDocuments.findMany({
    where: eq(driverDocuments.userId, userId),
  });

  const verifiedDocsCount = docs.filter((doc) => doc.uploadStatus === 'verified').length;

  return {
    isVerified: profile?.isVerified || false,
    verificationStatus: (profile?.verificationStatus || 'pending') as 'pending' | 'approved' | 'rejected',
    verifiedAt: profile?.verifiedAt ?? undefined,
    documents: docs as DriverDocument[],
    verifiedDocsCount,
    totalDocsRequired: 3,
    allDocsVerified: verifiedDocsCount === 3,
  };
}

/**
 * Admin: List all drivers pending verification
 */
export async function getPendingDrivers(): Promise<DriverProfile[]> {
  const db = getDatabase();

  const drivers = await db.query.driverProfiles.findMany({
    where: eq(driverProfiles.verificationStatus, 'pending'),
  });

  return drivers as DriverProfile[];
}

/**
 * Admin: Approve a single document
 */
export async function approveDocument(docId: string, adminId: string): Promise<DriverDocument> {
  const db = getDatabase();

  return db.transaction(async (trx) => {
    // Update document status
    const [doc] = await trx
      .update(driverDocuments)
      .set({
        uploadStatus: 'verified',
        verifiedAt: new Date(),
        verifiedByAdminId: adminId,
      })
      .where(eq(driverDocuments.id, docId))
      .returning();

    if (!doc) {
      throw new Error('Document not found');
    }

    // Log action
    await trx.insert(driverVerificationLog).values({
      id: uuidv4(),
      userId: doc.userId,
      action: 'doc_approved' as const,
      adminId,
      details: `Approved ${doc.documentType}`,
      createdAt: new Date(),
    });

    // Check if all 3 docs are now verified
    const allDocs = await trx.query.driverDocuments.findMany({
      where: eq(driverDocuments.userId, doc.userId),
    });

    const verifiedCount = allDocs.filter((d) => d.uploadStatus === 'verified').length;

    if (verifiedCount === 3) {
      // All docs approved - mark driver as fully verified
      await trx
        .update(driverProfiles)
        .set({
          isVerified: true,
          verificationStatus: 'approved' as const,
          verifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(driverProfiles.userId, doc.userId));

      // Log driver approval
      await trx.insert(driverVerificationLog).values({
        id: uuidv4(),
        userId: doc.userId,
        action: 'driver_approved' as const,
        adminId,
        details: 'All documents verified, driver approved',
        createdAt: new Date(),
      });
    }

    return doc as DriverDocument;
  });
}

/**
 * Admin: Reject a document
 */
export async function rejectDocument(
  docId: string,
  adminId: string,
  reason: string
): Promise<DriverDocument> {
  const db = getDatabase();

  return db.transaction(async (trx) => {
    // Update document status
    const [doc] = await trx
      .update(driverDocuments)
      .set({
        uploadStatus: 'rejected',
        rejectionReason: reason,
        verifiedAt: new Date(),
        verifiedByAdminId: adminId,
      })
      .where(eq(driverDocuments.id, docId))
      .returning();

    if (!doc) {
      throw new Error('Document not found');
    }

    // Log action
    await trx.insert(driverVerificationLog).values({
      id: uuidv4(),
      userId: doc.userId,
      action: 'doc_rejected' as const,
      adminId,
      details: `Rejected ${doc.documentType}: ${reason}`,
      createdAt: new Date(),
    });

    return doc as DriverDocument;
  });
}
