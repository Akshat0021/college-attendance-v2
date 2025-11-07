// Supabase Edge Function: supabase/functions/email-attendance-alert/index.ts
// This function runs on a schedule (cron job) to check student attendance
// and send email alerts if it falls below the thresholds set by the admin.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { Resend } from 'https://esm.sh/resend@3.2.0'

// CORS headers for preflight requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY is not set in Supabase secrets.')
    }
    const resend = new Resend(resendApiKey)

    // 1. Get all colleges that have email alerts enabled
    const { data: colleges, error: collegesError } = await supabase
      .from('college_settings')
      .select('college_id, setting_value')
      .eq('setting_key', 'email_enabled')
    
    if (collegesError) throw collegesError
    
    const enabledColleges = colleges
      .filter((c) => c.setting_value.enabled === true)
      .map((c) => c.college_id)

    if (enabledColleges.length === 0) {
      return new Response(JSON.stringify({ message: 'No colleges have email alerts enabled.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Process each enabled college
    let alertsSent = 0
    for (const collegeId of enabledColleges) {
      
      // Get settings for this college
      const { data: settings, error: settingsError } = await supabase
        .from('college_settings')
        .select('setting_key, setting_value')
        .eq('college_id', collegeId)
        .in('setting_key', ['overall_threshold', 'course_threshold'])
      
      if (settingsError) throw settingsError

      const overallThreshold = settings.find(s => s.setting_key === 'overall_threshold')?.setting_value.threshold || 75
      const courseThreshold = settings.find(s => s.setting_key === 'course_threshold')?.setting_value.threshold || 60

      // Get all courses for name mapping
      const { data: courses, error: coursesError } = await supabase
        .from('courses')
        .select('id, name, course_code')
        .eq('college_id', collegeId)
      
      if (coursesError) continue
      const courseMap = new Map(courses.map(c => [c.id, `${c.name} (${c.course_code || 'N/A'})`]))

      // 3. Get all students with an email
      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('id, name, email')
        .eq('college_id', collegeId)
        .not('email', 'is', null)
      
      if (studentsError) continue

      // 4. Process each student
      for (const student of students) {
        // 5. Get all their attendance records
        const { data: records, error: recordsError } = await supabase
          .from('attendance')
          .select('status, schedules(course_id)')
          .eq('student_id', student.id)
        
        if (recordsError || !records || records.length === 0) continue

        // 6. Calculate Overall Attendance
        const presentOrLate = records.filter(r => r.status === 'present' || r.status === 'late').length
        const overallPercent = (presentOrLate / records.length) * 100
        const overallLow = overallPercent < overallThreshold

        // 7. Calculate Per-Course Attendance
        const courseStats = new Map<string, { present: number; total: number }>()
        records.forEach(r => {
          if (r.schedules && r.schedules.course_id) {
            const courseId = r.schedules.course_id
            const stats = courseStats.get(courseId) || { present: 0, total: 0 }
            stats.total++
            if (r.status === 'present' || r.status === 'late') {
              stats.present++
            }
            courseStats.set(courseId, stats)
          }
        })

        const lowCourses = []
        courseStats.forEach((stats, courseId) => {
          const percent = (stats.present / stats.total) * 100
          if (percent < courseThreshold) {
            lowCourses.push({
              name: courseMap.get(courseId) || 'Unknown Course',
              percent: percent.toFixed(0),
            })
          }
        })

        // 8. Send Email if needed
        if (overallLow || lowCourses.length > 0) {
          const emailHtml = buildEmailHtml(student.name, overallPercent.toFixed(0), overallThreshold, lowCourses)
          
          await resend.emails.send({
            from: 'Attendance System <onboarding@resend.dev>', // Replace with your verified Resend domain
            to: [student.email],
            subject: 'Attendance Alert - Low Attendance Warning',
            html: emailHtml,
          })
          alertsSent++
        }
      }
    }

    return new Response(JSON.stringify({ message: `Check complete. Sent ${alertsSent} alerts.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// Helper function to build the email body
function buildEmailHtml(studentName, overallPercent, overallThreshold, lowCourses) {
  let body = `<div style="font-family: Arial, sans-serif; line-height: 1.6;">`
  body += `<h2>Attendance Alert for ${studentName}</h2>`
  body += `<p>This is an automated alert to notify you of low attendance in your courses.</p>`

  if (overallPercent < overallThreshold) {
    body += `<h3>Overall Attendance Warning</h3>`
    body += `<p>Your overall attendance is <strong>${overallPercent}%</strong>, which is below the required ${overallThreshold}%.</p>`
  }

  if (lowCourses.length > 0) {
    body += `<h3>Low Attendance Courses</h3>`
    body += `<p>You are below the ${lowCourses.length > 0 ? lowCourses[0].percent : 'course'}% threshold in the following courses:</p>`
    body += `<ul>`
    lowCourses.forEach(course => {
      body += `<li><strong>${course.name}:</strong> ${course.percent}%</li>`
    })
    body += `</ul>`
  }

  body += `<p>Please contact your college administration or faculty advisor to discuss this.</p>`
  body += `</div>`
  return body
}
