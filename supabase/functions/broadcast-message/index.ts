import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// CORS headers to allow requests from your web app
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to create a Supabase client with admin privileges
const getSupabaseAdmin = () => {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
};

/**
 * Sends a WhatsApp message using the Twilio API.
 * This function now lives inside your Edge Function.
 * @param {SupabaseClient} supabase - The Supabase admin client for logging.
 * @param {string} toPhoneNumber - The recipient's phone number.
 * @param {string} message - The message body to send.
 * @param {string} schoolId - The school ID for logging purposes.
 */
async function sendWhatsAppMessage(supabase, toPhoneNumber, message, schoolId) {
  console.log(`Preparing to send message to: ${toPhoneNumber}`);
  
  // Retrieve Twilio credentials from environment variables
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const TWILIO_WHATSAPP_NUMBER = Deno.env.get('TWILIO_WHATSAPP_NUMBER');

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
    console.error('Critical Error: Twilio credentials are not set in Supabase environment variables.');
    return; // Stop if credentials are not found
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const to = `whatsapp:${toPhoneNumber}`;
  const from = `whatsapp:${TWILIO_WHATSAPP_NUMBER}`;

  const encoded = new URLSearchParams();
  encoded.append('To', to);
  encoded.append('From', from);
  encoded.append('Body', message);
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: encoded,
    });
    
    const result = await response.json();
    const status = response.ok ? 'sent' : 'failed';
    console.log(`Twilio response for ${toPhoneNumber}: ${status}`, result);

    // Log the notification attempt to your database
    await supabase.from('notifications').insert({
      school_id: schoolId,
      type: 'broadcast',
      status: status,
      message: message,
      provider_response: result,
    });

  } catch (error) {
    console.error(`Twilio send error for ${toPhoneNumber}:`, error.message);
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = getSupabaseAdmin();
  try {
    const { schoolId, message } = await req.json();

    if (!schoolId || !message) {
      throw new Error("Missing 'schoolId' or 'message' in the request body.");
    }

    const { data: students, error: studentError } = await supabase
      .from('students')
      .select('parent_phone_number')
      .eq('school_id', schoolId)
      .not('parent_phone_number', 'is', null);

    if (studentError) throw studentError;

    const phoneNumbers = students.map(s => s.parent_phone_number);
    
    // **FIX:** This loop now actively sends the message to each parent.
    for (const number of phoneNumbers) {
      // Pass all required arguments to the helper function
      await sendWhatsAppMessage(supabase, number, message, schoolId);
    }
    
    const count = phoneNumbers.length;

    return new Response(JSON.stringify({ message: `Broadcast sent to ${count} parent(s).` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

