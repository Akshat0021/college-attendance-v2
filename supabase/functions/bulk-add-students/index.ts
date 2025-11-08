// supabase/functions/bulk-add-students/index.ts
// ** MODIFIED TO EXPECT A WRAPPED {"student": ...} PAYLOAD **

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Define CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Get the Face Recognition API URL from environment variables
const FACE_API_URL = Deno.env.get('FACE_API_URL');

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
  email: string | null;
  image_url: string; // This is the direct public URL to the image
  group_id: string; 
  college_id: string;
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // This check MUST come first
  if (!FACE_API_URL) {
    console.error("CRITICAL: FACE_API_URL environment variable is not set.");
    return new Response(JSON.stringify({ 
      error: "Face recognition API is not configured on the server. Please set the FACE_API_URL secret in your Supabase project settings." 
    }), {
        status: 500, // Internal Server Error
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = getSupabaseAdmin();
  try {
    // ** ================== MODIFIED PART ================== **
    // Destructure the "student" object from the request body
    const { student } = await req.json() as { student: StudentUpload };
    // ** =================================================== **

    if (!student || !student.name) {
      throw new Error("No student data provided."); // This was the error you saw
    }

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
      throw new Error(`Face embedding failed for ${student.name}: ${errData.error || 'No face detected'}`);
    }
    const { embedding } = await embeddingResponse.json();

    // 3. Upload photo to Supabase Storage
    const filePath = `public/${student.college_id}/${Date.now()}-${student.name.replace(/\s+/g, '_')}.jpg`;
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

    // 5. Insert the student into the 'students' table
    const { data: newStudent, error: studentInsertError } = await supabase
      .from('students')
      .insert({
        name: student.name,
        roll_number: student.roll_number,
        email: student.email,
        college_id: student.college_id,
        photo_url: publicUrl,
        face_embedding: JSON.stringify(embedding), // Store embedding as string
      })
      .select('id')
      .single();

    if (studentInsertError) {
      throw new Error(`Database insert failed for ${student.name}: ${studentInsertError.message}`);
    }

    // 6. Link the student to their group in 'student_group_members'
    const { error: groupLinkError } = await supabase
      .from('student_group_members')
      .insert({
        student_id: newStudent.id,
        group_id: student.group_id,
      });

    if (groupLinkError) {
      throw new Error(`Student ${student.name} created, but failed to link to group: ${groupLinkError.message}`);
    }

    // 7. Return a success message for *this one student*
    return new Response(JSON.stringify({
      message: `Successfully added ${student.name}`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Fatal error in bulk-add-students:", error.message);
    // Return the error message in the response
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400, // Use 400 for a client/data error
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});