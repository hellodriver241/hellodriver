#!/usr/bin/env node

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function createBucket() {
  try {
    console.log('📦 Creating bucket: driver-documents');

    // Create bucket
    const createResponse = await fetch(`${supabaseUrl}/storage/v1/b`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'driver-documents',
        public: true,
      }),
    });

    if (!createResponse.ok) {
      const error = await createResponse.json();

      // Check if bucket already exists
      if (error.message && error.message.includes('already exists')) {
        console.log('✅ Bucket driver-documents already exists');
      } else {
        console.error('❌ Error creating bucket:', error.message || error);
        process.exit(1);
      }
    } else {
      const data = await createResponse.json();
      console.log('✅ Bucket created successfully:', data.name);
    }

    // Test access
    console.log('\n🧪 Testing bucket access...');
    const listResponse = await fetch(`${supabaseUrl}/storage/v1/b/driver-documents/`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
      },
    });

    if (listResponse.ok) {
      console.log('✅ Bucket accessible');
    } else {
      console.error('❌ Cannot access bucket');
      process.exit(1);
    }

    console.log('✅ Supabase bucket ready for driver documents!\n');
    console.log('Bucket: driver-documents');
    console.log('Access: Public (anyone can read files)');
    console.log('API: https://pfbmlrayksfhssmpqzko.supabase.co/storage/v1/object/public/driver-documents/');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createBucket();
