import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  driverProfileSchema,
  documentUploadSchema,
  adminDocumentActionSchema,
  adminDriverApprovalSchema,
  adminDriverRejectionSchema,
} from './driver.validators.js';
import {
  locationUpdateSchema,
  onlineToggleSchema,
} from './location.validators.js';
import {
  updateDriverProfile,
  getDriverProfile,
  recordDocumentUpload,
  getDriverDocuments,
  getVerificationStatus,
  getPendingDrivers,
  approveDocument,
  rejectDocument,
  approveDriver,
  rejectDriver,
} from './driver.service.js';
import {
  updateDriverLocation,
  toggleDriverOnlineStatus,
  getDriverLocation,
} from './location.service.js';
import { authenticate, requireDriver, requireAdmin } from '../../shared/errors/handlers.js';
import { errors } from '../../shared/errors/AppError.js';
import { uploadFile, deleteFile } from '../../domains/storage/storage.service.js';

/**
 * Register driver routes
 */
export async function registerDriverRoutes(app: FastifyInstance) {
  /**
   * POST /drivers/profile
   * Complete driver profile with personal and vehicle information
   */
  app.post(
    '/drivers/profile',
    { onRequest: [requireDriver] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const data = driverProfileSchema.parse(request.body);
      const userId = (request.user as any).sub;

      try {
        const driver = await updateDriverProfile(userId, data);
        return reply.code(200).send({ success: true, data: driver });
      } catch (err) {
        throw errors.internalError('Failed to update driver profile');
      }
    }
  );

  /**
   * GET /drivers/:driverId
   * Get driver profile
   */
  app.get(
    '/drivers/:driverId',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { driverId } = request.params as { driverId: string };

      const profile = await getDriverProfile(driverId);

      if (!profile) {
        throw errors.driverProfileNotFound();
      }

      return reply.code(200).send(profile);
    }
  );

  /**
   * POST /drivers/documents/upload
   * Upload a single document (drivers_license, id_card, or vehicle_insurance)
   */
  app.post(
    '/drivers/documents/upload',
    { onRequest: [requireDriver] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;

      // Use request.parts() to consume both text fields and file regardless of order
      let fileBuffer: Buffer | null = null;
      let fileFilename = '';
      let documentTypeRaw: string | undefined;

      for await (const part of request.parts()) {
        if (part.type === 'file' && part.fieldname === 'file') {
          fileBuffer = await part.toBuffer();
          fileFilename = part.filename;
        } else if (part.type === 'field' && part.fieldname === 'documentType') {
          documentTypeRaw = part.value as string;
        }
      }

      if (!fileBuffer) {
        throw errors.validationFailed({ file: 'No file provided' });
      }

      const { documentType } = documentUploadSchema.parse({ documentType: documentTypeRaw });

      try {
        // Upload to Supabase Storage
        const buffer = fileBuffer;
        const storageUrl = await uploadFile(userId, documentType, buffer, fileFilename);

        // Record in database
        const doc = await recordDocumentUpload(userId, documentType, storageUrl);

        return reply.code(200).send({
          success: true,
          data: doc,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        throw errors.documentUploadFailed(message);
      }
    }
  );

  /**
   * GET /drivers/documents
   * Get all uploaded documents for authenticated driver
   */
  app.get(
    '/drivers/documents',
    { onRequest: [requireDriver] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;

      const docs = await getDriverDocuments(userId);

      return reply.code(200).send({
        data: docs,
        count: docs.length,
      });
    }
  );

  /**
   * GET /drivers/verification-status
   * Get verification status for authenticated driver
   */
  app.get(
    '/drivers/verification-status',
    { onRequest: [requireDriver] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;

      const status = await getVerificationStatus(userId);

      return reply.code(200).send(status);
    }
  );

  /**
   * POST /drivers/location
   * Update driver GPS location (sent every 3s from mobile app)
   * Stores in Redis for real-time matching + PostgreSQL for durability
   */
  app.post(
    '/drivers/location',
    { onRequest: [requireDriver] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      const data = locationUpdateSchema.parse(request.body);

      try {
        const location = await updateDriverLocation(userId, data);
        return reply.code(200).send({
          success: true,
          data: location,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        throw errors.internalError(message);
      }
    }
  );

  /**
   * PATCH /drivers/toggle-online
   * Toggle driver online/offline status
   * Prevents going online if not verified
   */
  app.patch(
    '/drivers/toggle-online',
    { onRequest: [requireDriver] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;
      const data = onlineToggleSchema.parse(request.body);

      try {
        const status = await toggleDriverOnlineStatus(userId, data);
        return reply.code(200).send({
          success: true,
          data: status,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        throw errors.internalError(message);
      }
    }
  );

  /**
   * GET /drivers/location
   * Get current driver location
   */
  app.get(
    '/drivers/location',
    { onRequest: [requireDriver] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request.user as any).sub;

      const location = await getDriverLocation(userId);

      if (!location) {
        return reply.code(200).send({
          latitude: null,
          longitude: null,
          isOnline: false,
        });
      }

      return reply.code(200).send({
        latitude: location.latitude,
        longitude: location.longitude,
        isOnline: location.isOnline,
      });
    }
  );

  /**
   * ===== ADMIN ENDPOINTS =====
   */

  /**
   * GET /admin/drivers/pending
   * List all drivers pending verification
   */
  app.get(
    '/admin/drivers/pending',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const drivers = await getPendingDrivers();

      return reply.code(200).send({
        data: drivers,
        count: drivers.length,
      });
    }
  );

  /**
   * GET /admin/drivers/:driverId/documents
   * Get all documents for a specific driver (admin review)
   */
  app.get(
    '/admin/drivers/:driverId/documents',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { driverId } = request.params as { driverId: string };

      const docs = await getDriverDocuments(driverId);

      if (docs.length === 0) {
        throw errors.notFound('Driver documents');
      }

      return reply.code(200).send({
        data: docs,
        count: docs.length,
      });
    }
  );

  /**
   * POST /admin/drivers/:driverId/documents/:docId/approve
   * Approve a single document
   */
  app.post(
    '/admin/drivers/:driverId/documents/:docId/approve',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { docId } = request.params as { docId: string };
      const adminId = (request.user as any).sub;

      try {
        const doc = await approveDocument(docId, adminId);

        return reply.code(200).send({
          success: true,
          message: 'Document approved',
          data: doc,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        throw errors.internalError(message);
      }
    }
  );

  /**
   * POST /admin/drivers/:driverId/documents/:docId/reject
   * Reject a document
   */
  app.post(
    '/admin/drivers/:driverId/documents/:docId/reject',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { docId } = request.params as { docId: string };
      const adminId = (request.user as any).sub;
      const { rejectionReason } = adminDocumentActionSchema.parse(request.body);

      if (!rejectionReason) {
        throw errors.validationFailed({ rejectionReason: 'Rejection reason is required' });
      }

      try {
        const doc = await rejectDocument(docId, adminId, rejectionReason);

        return reply.code(200).send({
          success: true,
          message: 'Document rejected',
          data: doc,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        throw errors.internalError(message);
      }
    }
  );

  /**
   * PATCH /admin/drivers/:driverId/approve
   * Manually approve entire driver
   */
  app.patch(
    '/admin/drivers/:driverId/approve',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { driverId } = request.params as { driverId: string };
      const adminId = (request.user as any).sub;
      const { notes } = adminDriverApprovalSchema.parse(request.body);

      try {
        const driver = await approveDriver(driverId, adminId, notes);

        return reply.code(200).send({
          success: true,
          message: 'Driver approved',
          data: driver,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        throw errors.internalError(message);
      }
    }
  );

  /**
   * PATCH /admin/drivers/:driverId/reject
   * Manually reject entire driver
   */
  app.patch(
    '/admin/drivers/:driverId/reject',
    { onRequest: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { driverId } = request.params as { driverId: string };
      const adminId = (request.user as any).sub;
      const { reason } = adminDriverRejectionSchema.parse(request.body);

      try {
        const driver = await rejectDriver(driverId, adminId, reason);

        return reply.code(200).send({
          success: true,
          message: 'Driver rejected',
          data: driver,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        throw errors.internalError(message);
      }
    }
  );
}
