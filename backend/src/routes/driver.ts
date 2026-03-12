import { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { documents } from '../db/schema.js';
import { getDatabase } from '../db/index.js';
import { eq } from 'drizzle-orm';

export async function driverRoutes(app: FastifyInstance) {
  // Upload document
  app.post(
    '/driver/documents/:documentType',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { documentType } = request.params as { documentType: string };

      try {
        const file = await request.file();
        if (!file) {
          return reply.code(400).send({ error: 'No file provided' });
        }

        const db = getDatabase();
        const { driverProfiles } = await import('../db/schema.js');
        const { eq: eqOp } = await import('drizzle-orm');

        // Get driver profile
        const driverProfile = await db.query.driverProfiles.findFirst({
          where: eqOp(driverProfiles.userId, (request.user as any).sub),
        });

        if (!driverProfile) {
          return reply.code(404).send({ error: 'Driver profile not found' });
        }

        // For now, mock the storage path
        const fileName = `${(request.user as any).sub}/${documentType}/${uuid()}-${file.filename}`;

        // TODO: Upload to Supabase Storage
        // const { error } = await app.storage
        //   .from('driver-documents')
        //   .upload(fileName, await file.toBuffer());

        const [doc] = await db
          .insert(documents)
          .values({
            driverProfileId: driverProfile.id,
            documentType,
            storagePath: fileName,
          })
          .returning();

        return reply.code(200).send(doc);
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: 'Upload failed' });
      }
    }
  );

  // Get driver documents
  app.get(
    '/driver/documents',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      try {
        const db = getDatabase();
        const { driverProfiles } = await import('../db/schema.js');
        const { eq: eqOp } = await import('drizzle-orm');

        const driverProfile = await db.query.driverProfiles.findFirst({
          where: eqOp(driverProfiles.userId, (request.user as any).sub),
        });

        if (!driverProfile) {
          return reply.code(404).send({ error: 'Driver profile not found' });
        }

        const docs = await db.query.documents.findMany({
          where: eqOp(documents.driverProfileId, driverProfile.id),
        });

        return reply.send(docs);
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch documents' });
      }
    }
  );
}
