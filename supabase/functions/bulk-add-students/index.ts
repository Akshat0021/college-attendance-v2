// supabase/functions/bulk-add-students/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Define CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Get the Face Recognition API URL from environment variables
const FACE_API_URL = Deno.env.get('FACE_API_URL') ?? '';
if (!FACE_API_URL) {
  console.error("CRITICAL: FACE_API_URL environment variable is not set.");
}

// Helper to create a Supabase client with admin privileges
const getSupabaseAdmin = () => {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
};

// Define the expected student data structure from the client
interface StudentUpload {
  name: string;
  roll_number: string;
  parent_phone_number: string;
  section_id: string;
  school_id: string;
  image_url: string; // This is the direct public URL to the image
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = getSupabaseAdmin();
  try {
    const { students } = await req.json() as { students: StudentUpload[] };

    if (!students || students.length === 0) {
      throw new Error("No student data provided.");
    }
    if (!FACE_API_URL) {
        throw new Error("Face recognition API is not configured on the server.");
    }

    let processedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    const studentsToInsert = [];

    // Process each student one by one
    for (const student of students) {
      try {
        // 1. Fetch the image from the public URL
        const imageResponse = await fetch(student.image_url);
        if (!imageResponse.ok) {
          throw new Error(`Failed to fetch image for ${student.name} (URL: ${student.image_url})`);
        }
        const imageBlob = await imageResponse.blob();
        const imageBuffer = await imageBlob.arrayBuffer();

        // 2. Get face embedding from Python API
        const formData = new FormData();
        formData.append('image', imageBlob, 'upload.jpg');

        const embeddingResponse = await fetch(`${FACE_API_URL}/get_embedding`, {
          method: 'POST',
          body: formData,
        });

        if (!embeddingResponse.ok) {
          const errData = await embeddingResponse.json();
          throw new Error(`Face embedding failed for ${student.name}: ${errData.error}`);
        }
        const { embedding } = await embeddingResponse.json();

        // 3. Upload photo to Supabase Storage
        const filePath = `public/${student.school_id}/${Date.now()}-${student.name.replace(/\s+/g, '_')}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('student-photos')
          .upload(filePath, imageBuffer, { contentType: imageBlob.type });

        if (uploadError) {
          throw new Error(`Storage upload failed for ${student.name}: ${uploadError.message}`);
        }

        // 4. Get public URL for the uploaded photo
        const { data: { publicUrl } } = supabase.storage
          .from('student-photos')
          .getPublicUrl(filePath);

        // 5. Prepare the final student object for insertion
        studentsToInsert.push({
          ...student,
          photo_url: publicUrl,
          face_embedding: embedding,
          image_url: undefined, // Remove the temporary image_url
        });

        processedCount++;
      } catch (procError) {
        console.error(`Error processing ${student.name}:`, procError.message);
        errors.push(`Failed to process ${student.name}: ${procError.message}`);
        errorCount++;
      }
    }

    // 6. Bulk insert all processed students
    if (studentsToInsert.length > 0) {
      const { error: insertError } = await supabase.from('students').insert(studentsToInsert);
      if (insertError) {
        throw new Error(`Database insert failed: ${insertError.message}`);
      }
    }

    // 7. Return a summary report
    return new Response(JSON.stringify({
      message: `Process complete. Added ${processedCount} students. Failed ${errorCount} students.`,
      errors: errors,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Fatal error in bulk-add-students:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});