#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createBucket() {
  try {
    console.log('📦 Creating bucket: driver-documents');

    const { data, error } = await supabase.storage.createBucket('driver-documents', {
      public: true,
    });

    if (error) {
      // Bucket might already exist
      if (error.message.includes('already exists')) {
        console.log('✅ Bucket driver-documents already exists');
        return;
      }
      throw error;
    }

    console.log('✅ Bucket created successfully:', data);

    // Test upload
    console.log('\n🧪 Testing bucket access...');
    const testBuffer = Buffer.from('test file');
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('driver-documents')
      .upload('test/test.txt', testBuffer, {
        contentType: 'text/plain',
        upsert: false,
      });

    if (uploadError) {
      console.error('❌ Upload test failed:', uploadError.message);
      process.exit(1);
    }

    console.log('✅ Upload test successful');

    // Get public URL
    const { data: publicUrl } = supabase.storage.from('driver-documents').getPublicUrl(uploadData.path);
    console.log('✅ Public URL:', publicUrl.publicUrl);

    // Clean up test file
    await supabase.storage.from('driver-documents').remove(['test/test.txt']);
    console.log('✅ Test file cleaned up');

    console.log('\n✅ Supabase bucket is ready for driver documents!');
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

createBucket();
