// supabase/functions/manual-alert/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Define CORS headers to allow requests from your web app. This is the fix for your error.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Allows any origin to access. For production, you might want to restrict this to your actual domain.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to create a Supabase client with admin privileges inside the function
const getSupabaseAdmin = () => {
  return createClient(
    // These environment variables are automatically available in Supabase Edge Functions
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { global: { headers: { 'Content-Type': 'application/json' } } }
  );
};

// NOTE: For this to actually send messages, you would need to include your full
// `sendWhatsAppMessage` helper function here, complete with your Twilio logic.
// This example will just log the messages that it *would* have sent.
async function sendWhatsAppMessage(phoneNumber, message) {
  console.log(`--- Sending WhatsApp Message ---`);
  console.log(`To: ${phoneNumber}`);
  console.log(`Message: ${message}`);
  console.log(`------------------------------`);
  // Your actual Twilio API call would go here.
  // We'll just simulate a successful operation.
  await new Promise(resolve => setTimeout(resolve, 50)); // Simulate a small network delay
}


serve(async (req) => {
  // The browser first sends an OPTIONS request to check if the server allows the connection.
  // This is the critical part that handles the CORS preflight request.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = getSupabaseAdmin();
  try {
    // Get the data sent from the admin.js file
    const { schoolId, alertType, threshold } = await req.json();

    if (!schoolId || !alertType) {
      throw new Error("Missing 'schoolId' or 'alertType' in request body.");
    }

    // 1. Fetch all students for the school who have a parent's phone number
    const { data: students, error: studentError } = await supabase
      .from('students')
      .select('id, name, parent_phone_number')
      .eq('school_id', schoolId)
      .not('parent_phone_number', 'is', null);

    if (studentError) throw studentError;

    if (!students || students.length === 0) {
      return new Response(JSON.stringify({ message: "No students with parent phone numbers found to alert." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    let alertsSent = 0;

    // 2. Handle the specific "low_attendance" alert logic
    if (alertType === 'low_attendance') {
      if (!threshold) {
        throw new Error("Missing 'threshold' for low_attendance alert type.");
      }

      const studentIds = students.map(s => s.id);
      
      // 3. Fetch all attendance records for all those students at once
      const { data: attendance, error: attendanceError } = await supabase
        .from('attendance')
        .select('student_id, status')
        .in('student_id', studentIds);
      
      if (attendanceError) throw attendanceError;

      // 4. Loop through each student to calculate their attendance
      for (const student of students) {
        // Filter the big attendance list to get records for just the current student
        const studentRecords = attendance.filter(a => a.student_id === student.id);
        const totalDays = studentRecords.length;
        
        if (totalDays === 0) continue; // Skip students who have never had attendance marked

        const presentDays = studentRecords.filter(a => a.status === 'present' || a.status === 'late').length;
        const attendancePercentage = (presentDays / totalDays) * 100;

        // 5. Check if the student's attendance is below the threshold
        if (attendancePercentage < threshold) {
          const message = `Attendance Alert for ${student.name}: Their current attendance is ${attendancePercentage.toFixed(1)}%, which is below the required ${threshold}%. Please ensure they attend regularly.`;
          // await sendWhatsAppMessage(student.parent_phone_number, message);
          alertsSent++;
        }
      }
    } else {
        throw new Error(`Alert type '${alertType}' is not supported.`);
    }
    
    // 6. Return a success response
    return new Response(JSON.stringify({ message: `Process complete. Sent ${alertsSent} low attendance alerts.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    // Return an error response if something goes wrong
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});