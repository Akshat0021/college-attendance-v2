import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Helper to create an admin client
const getSupabaseAdmin = () => {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { global: { headers: { 'Content-Type': 'application/json' } } }
  )
}

// Helper to send a message and log it
async function sendWhatsAppMessage(supabase: SupabaseClient, student: any, message: string, type: 'low_attendance' | 'consecutive_absence') {
  console.log(`PREPARING_MESSAGE: Type '${type}' for ${student.name} (${student.parent_phone_number})`);
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
  const TWILIO_WHATSAPP_NUMBER = Deno.env.get('TWILIO_WHATSAPP_NUMBER')

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
    console.error('CRITICAL_ERROR: Twilio credentials are not set as environment variables.')
    return
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
  const to = `whatsapp:${student.parent_phone_number}`
  const from = `whatsapp:${TWILIO_WHATSAPP_NUMBER}`

  const encoded = new URLSearchParams()
  encoded.append('To', to)
  encoded.append('From', from)
  encoded.append('Body', message)
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: encoded,
    })
    
    const result = await response.json()
    const status = response.ok ? 'sent' : 'failed'
    console.log(`TWILIO_RESPONSE for student ${student.id}: ${status}`, result);

    const { error: logError } = await supabase.from('notifications').insert({
      student_id: student.id,
      school_id: student.school_id,
      type: type,
      status: status,
      message: message,
      provider_response: result,
    })

    if (logError) {
      console.error(`DB_LOG_ERROR: Failed to log notification for student ${student.id}:`, logError.message)
    }

  } catch (error) {
    console.error(`TWILIO_SEND_ERROR for student ${student.id}:`, error.message)
  }
}

// The main server function
serve(async (_req) => {
  const supabase = getSupabaseAdmin()
  console.log("--- Edge Function Invoked ---");

  try {
    // 1. Fetch all school settings
    const { data: settingsData, error: settingsError } = await supabase
        .from('school_settings')
        .select('school_id, setting_key, setting_value');
    if (settingsError) throw new Error(`DB_ERROR (settings): ${settingsError.message}`);
    
    const schoolSettings = settingsData.reduce((acc, { school_id, setting_key, setting_value }) => {
        if (!acc[school_id]) acc[school_id] = {};
        acc[school_id][setting_key] = setting_value;
        return acc;
    }, {});
    console.log(`LOG: Loaded settings for ${Object.keys(schoolSettings).length} school(s).`);

    // 2. Fetch all students with a parent phone number
    const { data: students, error: studentError } = await supabase
      .from('students')
      .select('id, name, parent_phone_number, school_id')
      .not('parent_phone_number', 'is', null)
    if (studentError) throw studentError
    console.log(`LOG: Found ${students.length} students with phone numbers.`);

    // 3. Process notifications for each student
    for (const student of students) {
        console.log(`\nPROCESSING: Student "${student.name}" (ID: ${student.id})`);
        const settings = schoolSettings[student.school_id];
        
        if (!settings) {
            console.log(` -> SKIPPING: No settings found for school_id ${student.school_id}.`);
            continue;
        }
        
        console.log(` -> School Settings Check: whatsapp_enabled is "${settings.whatsapp_enabled}" (Type: ${typeof settings.whatsapp_enabled})`);
        if (settings.whatsapp_enabled !== true) {
            console.log(` -> SKIPPING: WhatsApp automation is not enabled for this school.`);
            continue;
        }
        
        const consecutiveDaysThreshold = parseInt(settings.consecutive_absence_days, 10) || 3;
        console.log(` -> LOGIC: Checking for ${consecutiveDaysThreshold} consecutive absences...`);
        let consecutiveAbsences = 0;
        let streakBroken = false;

        for (let i = 0; i < consecutiveDaysThreshold; i++) {
            const checkDate = new Date();
            checkDate.setDate(checkDate.getDate() - i);
            const dateString = checkDate.toISOString().split('T')[0];
            
            console.log(`  -> CHECKING_DATE [Day ${i+1}]: ${dateString}`);

            const { data: attendance, error } = await supabase
                .from('attendance')
                .select('status')
                .eq('student_id', student.id)
                .eq('date', dateString)
                .maybeSingle();
            
            if (error) {
                console.error(`  -> DB_ERROR for date ${dateString}: ${error.message}`);
                streakBroken = true;
                break;
            }

            if (attendance === null || attendance.status === 'absent') {
                console.log(`  -> RESULT: Absent on ${dateString}`);
                consecutiveAbsences++;
            } else {
                console.log(`  -> RESULT: Present/Late on ${dateString}. Streak broken.`);
                streakBroken = true;
                break;
            }
        }
        
        if (!streakBroken && consecutiveAbsences >= consecutiveDaysThreshold) {
            console.log(`  -> TRIGGER: Met ${consecutiveAbsences} consecutive absence days.`);
            const message = `Attendance Alert for ${student.name}: They have been marked absent for ${consecutiveDaysThreshold} consecutive days. Please contact the school immediately.`
            await sendWhatsAppMessage(supabase, student, message, 'consecutive_absence')
            continue; // Skip to next student
        } else {
            console.log(` -> NO_TRIGGER: Consecutive absence condition not met.`);
        }
    }

    console.log("\n--- Function execution finished successfully. ---");
    return new Response(JSON.stringify({ message: 'Notification checks completed successfully.' }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error("FATAL_ERROR:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

