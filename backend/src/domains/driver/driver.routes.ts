import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  driverProfileSchema,
  documentUploadSchema,
  adminDocumentActionSchema,
} from './driver.validators.js';
import {
  updateDriverProfile,
  getDriverProfile,
  recordDocumentUpload,
  getDriverDocuments,
  getVerificationStatus,
  getPendingDrivers,
  approveDocument,
  rejectDocument,
} from './driver.service.js';
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

      const file = await request.file();
      if (!file) {
        throw errors.validationFailed({ file: 'No file provided' });
      }

      const { documentType } = documentUploadSchema.parse(request.body);

      try {
        // Upload to Supabase Storage
        const buffer = await file.toBuffer();
        const storageUrl = await uploadFile(userId, documentType, buffer, file.filename);

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
}
