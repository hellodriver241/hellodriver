import { createClient } from '@supabase/supabase-js';
import { config } from '../../core/config.js';
import type { Buffer } from 'node:buffer';

const supabaseUrl = config.SUPABASE_URL;
const supabaseServiceKey = config.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase credentials for storage');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const BUCKET = config.SUPABASE_STORAGE_BUCKET;

/**
 * Upload a file to Supabase Storage
 * Returns the public URL of the uploaded file
 */
export async function uploadFile(
  userId: string,
  documentType: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<string> {
  const path = `${userId}/${documentType}/${Date.now()}-${fileName}`;

  const { data, error } = await supabase.storage.from(BUCKET).upload(path, fileBuffer, {
    contentType: 'image/jpeg',
    upsert: false,
  });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  // Get public URL
  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);

  return publicData.publicUrl;
}

/**
 * Delete a file from storage (admin use only)
 */
export async function deleteFile(userId: string, documentType: string): Promise<void> {
  // List files in the user's document folder
  const { data: files, error: listError } = await supabase.storage
    .from(BUCKET)
    .list(`${userId}/${documentType}`);

  if (listError) {
    throw new Error(`Failed to list files: ${listError.message}`);
  }

  if (!files || files.length === 0) {
    return;
  }

  // Delete all files in the folder
  const filePaths = files.map((file) => `${userId}/${documentType}/${file.name}`);

  const { error: deleteError } = await supabase.storage.from(BUCKET).remove(filePaths);

  if (deleteError) {
    throw new Error(`Failed to delete file: ${deleteError.message}`);
  }
}
