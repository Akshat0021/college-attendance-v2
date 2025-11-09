// ====================================================
// SUPABASE & API CONFIGURATION
// ====================================================
const SUPABASE_URL = 'https://zlkleprvhjgjcjycezpu.supabase.co'; // Replace with your new project URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsa2xlcHJ2aGpnamNqeWNlenB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxNzAyNDcsImV4cCI6MjA3Nzc0NjI0N30.e1LkaKKXfDUOHOh1Oi6GY1lwpd5DZ5R-FkSP62XXGD0'; // Replace with your new project anon key
const FACE_API_URL = 'https://ca.avinya.live:5000'; // Replace with your deployed Python API URL

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global variables
let classAttendanceChart = null;
let editingStudentId = null;
let collegeId = null; // Changed from schoolId
let collegeName = null; // To display
let allStudentsCache = []; // Cache for student data


// ====================================================
// INITIALIZATION
// ====================================================
// We are using 'load' instead of 'DOMContentLoaded'
// This waits for the entire page (including images and styles) to load,
// ensuring all HTML elements are available before the script runs.
window.addEventListener('load', async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    window.location.href = '/login.html';
    return;
  }

  // Fetch the user's profile and college ID
  const { data: profile, error: profileError } = await db.from('profiles')
    .select('role, college_id, colleges(name)')
    .eq('id', session.user.id)
    .single();

  if (profileError || !profile) {
    showNotification('Failed to load profile. Please log in again.', 'error');
    console.error('Profile load error:', profileError);
    await db.auth.signOut();
    window.location.href = '/login.html';
    return;
  }

  if (profile.role !== 'admin') {
    showNotification('Access denied. You must be an admin.', 'error');
    await db.auth.signOut();
    window.location.href = '/login.html';
    return;
  }

  collegeId = profile.college_id;
  collegeName = profile.colleges.name;
  
  initializePage();

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await db.auth.signOut();
    window.location.href = '/login.html';
  });
});

async function initializePage() {
    document.getElementById('college-name-display').textContent = collegeName;
    
    // =================== MODIFIED: Attaching listener ===================
    document.getElementById('process-excel-btn').addEventListener('click', handleExcelUpload);
    // ====================================================================

    const datePicker = document.getElementById('attendance-date-picker');
    if (datePicker) {
        datePicker.value = new Date().toISOString().split('T')[0];
    }
    
    // ====================================================
    // A. HELPER FUNCTION TO ADD LISTENERS SAFELY
    // ====================================================
    const addListener = (id, event, handler) => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener(event, handler);
        } else {
            // This error will tell us if the HTML is cached/wrong
            console.error(`FATAL: Element with ID '${id}' was not found. Your HTML file might be old.`);
        }
    };

    // ====================================================
    // B. ATTACH ALL EVENT LISTENERS USING THE HELPER
    // ====================================================
    addListener('attendance-date-picker', 'change', loadAttendanceData);
    addListener('student-search', 'keyup', renderStudentsTable);
    addListener('student-form', 'submit', saveStudent);
    
    addListener('faculty-form', 'submit', addFaculty); 
    
    addListener('add-course-form', 'submit', addCourse);
    addListener('add-group-form', 'submit', addStudentGroup);
    addListener('scheduler-form', 'submit', addSchedule);
    addListener('holiday-form', 'submit', handleHolidayForm);
    addListener('settings-form', 'submit', handleGeneralSettingsForm);
    addListener('email-settings-form', 'submit', handleEmailSettingsForm);
    addListener('email-enabled', 'change', toggleEmailControls);
    
    // Attendance filter listeners
    const attendanceClassEl = document.getElementById('attendance-course');
    if (attendanceClassEl) {
        attendanceClassEl.addEventListener('change', async (e) => {
            await updateAttendanceGroupOptions(e.target.value);
            loadAttendanceData(); // Load data for "All Groups" by default
        });
    } else {
        console.error("FATAL: Element with ID 'attendance-course' was not found.");
    }
    
    addListener('attendance-group', 'change', loadAttendanceData);

    // Student form filter listeners
    const studentCourseFilterEl = document.getElementById('student-course-filter');
    if (studentCourseFilterEl) {
        studentCourseFilterEl.addEventListener('change', (e) => updateStudentGroupFilter(e.target.value));
    } else {
        console.error("FATAL: Element with ID 'student-course-filter' was not found.");
    }

    // NEW: Modal listeners
    addListener('proof-modal-close', 'click', closeProofModal);
    addListener('proof-modal-overlay', 'click', closeProofModal);

    // Load initial college-specific data
    await updateCourseSelectors();
    await updateTeacherSelectors();
    await updateStudentGroupSelectors();
    await loadAllStudents(); // Load student cache
    renderStudentsTable(); // Render from cache
    await loadDashboardMetrics();
    await loadHolidays();
    await loadSettings();
    await renderCoursesList();
    await renderStudentGroupsList();
    await renderFacultyList();
    await renderSchedulesList();
    
    showTab('dashboard'); 
}

// ====================================================
// UI INTERACTIVITY
// ====================================================

function toggleEmailControls() {
    const emailEnabled = document.getElementById('email-enabled');
    if (!emailEnabled) return; // Guard clause

    const isEnabled = emailEnabled.checked;
    const controlsContainer = document.getElementById('email-controls-container');
    
    if (!controlsContainer) {
        console.error("FATAL: Element 'email-controls-container' not found.");
        return;
    }

    controlsContainer.style.opacity = isEnabled ? '1' : '0.5';
    const inputs = controlsContainer.querySelectorAll('input, button');
    inputs.forEach(input => {
        input.disabled = !isEnabled;
    });
}


// ====================================================
// UTILITY & TAB MANAGEMENT
// ====================================================
function showNotification(message, type = 'success') {
  const container = document.getElementById('notification-container');
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  container.appendChild(notification);
  setTimeout(() => notification.classList.add('show'), 100);
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 3000);
  }, 3000);
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function showTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('tab-active');
    btn.classList.add('text-gray-600');
  });
  
  const content = document.getElementById(`content-${tabName}`);
  const tab = document.getElementById(`tab-${tabName}`);
  
  if (content) content.classList.remove('hidden');
  if (tab) {
    tab.classList.add('tab-active');
    tab.classList.remove('text-gray-600');
  }
}

// ====================================================
// DASHBOARD METRICS
// ====================================================
async function loadDashboardMetrics() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];

    const { data: collegeStudents, error: collegeStudentsError } = await db.from('students').select('id').eq('college_id', collegeId);
    if (collegeStudentsError) {
        console.error("Error fetching students for dashboard", collegeStudentsError);
        return;
    }
    
    const studentIdsForCollege = collegeStudents.map(s => s.id);
    const studentsCount = studentIdsForCollege.length;
    document.getElementById('metric-total-students').textContent = studentsCount;

    if (studentsCount === 0) {
        document.getElementById('metric-overall-attendance').textContent = 'N/A';
        document.getElementById('metric-today-attendance').textContent = 'N/A';
        return;
    }

    const [
        { data: recentAttendance, error: overallError },
        { data: groupData, error: groupError }
    ] = await Promise.all([
        db.from('attendance').select('student_id, status, date').gte('date', thirtyDaysAgoStr).in('student_id', studentIdsForCollege),
        // Simplified query for dashboard
        db.from('student_groups').select(`group_name, student_group_members(students(id))`).eq('college_id', collegeId)
    ]);
    
    if (overallError || groupError) {
        console.error("Error fetching dashboard data", overallError || groupError);
        return;
    }

    // --- Calculate and Display Simple Metrics ---
    if (recentAttendance && recentAttendance.length > 0) {
        const presentOrLate = recentAttendance.filter(r => r.status === 'present' || r.status === 'late').length;
        const rate = Math.round((presentOrLate / recentAttendance.length) * 100); // Rate of *marked* attendances
        document.getElementById('metric-overall-attendance').textContent = `${rate}%`;
    } else {
        document.getElementById('metric-overall-attendance').textContent = 'N/A';
    }

    const todayAttd = recentAttendance ? recentAttendance.filter(r => r.date === todayStr) : [];
    const presentOrLateToday = todayAttd.filter(r => r.status === 'present' || r.status === 'late').length;
    // Today's rate = present / total students in college
    const rateToday = studentsCount > 0 ? Math.round((presentOrLateToday / studentsCount) * 100) : 0;
    document.getElementById('metric-today-attendance').textContent = `${rateToday}%`;

    // --- Top Present & Absentees Lists ---
    const topAbsenteesList = document.getElementById('metric-top-absentees');
    const topPresentList = document.getElementById('metric-top-present');
    topAbsenteesList.innerHTML = '';
    topPresentList.innerHTML = '';
    
    if (recentAttendance) {
        const presentRecords = recentAttendance.filter(r => r.status === 'present' || r.status === 'late');
        const absentRecords = recentAttendance.filter(r => r.status === 'absent');

        const presenteeCounts = presentRecords.reduce((acc, { student_id }) => ({ ...acc, [student_id]: (acc[student_id] || 0) + 1 }), {});
        const absenteeCounts = absentRecords.reduce((acc, { student_id }) => ({ ...acc, [student_id]: (acc[student_id] || 0) + 1 }), {});

        const sortedPresentees = Object.entries(presenteeCounts).sort(([, a], [, b]) => b - a).slice(0, 5);
        const sortedAbsentees = Object.entries(absenteeCounts).sort(([, a], [, b]) => b - a).slice(0, 5);
        
        const studentIds = [...new Set([...sortedPresentees.map(([id]) => id), ...sortedAbsentees.map(([id]) => id)])];

        if (studentIds.length > 0) {
            const { data: studentDetails, error } = await db.from('students').select('id, name, student_group_members(student_groups(group_name))').in('id', studentIds);
            if (!error && studentDetails) {
                const studentMap = new Map(studentDetails.map(s => [s.id, { name: s.name, group: s.student_group_members[0]?.student_groups.group_name || 'N/A' }]));
                
                sortedAbsentees.forEach(([id, count]) => {
                    const student = studentMap.get(id);
                    if (!student) return;
                    const li = document.createElement('li');
                    li.className = 'flex justify-between items-center text-sm p-2 bg-gray-50 rounded-md';
                    li.innerHTML = `<div><div class="font-medium text-gray-700">${student.name}</div><div class="text-xs text-gray-500">${student.group}</div></div><span class="font-bold text-danger">${count} absences</span>`;
                    topAbsenteesList.appendChild(li);
                });

                sortedPresentees.forEach(([id, count]) => {
                    const student = studentMap.get(id);
                    if (!student) return;
                    const li = document.createElement('li');
                    li.className = 'flex justify-between items-center text-sm p-2 bg-gray-50 rounded-md';
                    li.innerHTML = `<div><div class="font-medium text-gray-700">${student.name}</div><div class="text-xs text-gray-500">${student.group}</div></div><span class="font-bold text-success">${count} days present</span>`;
                    topPresentList.appendChild(li);
                });
            }
        }
    }
    if (topAbsenteesList.children.length === 0) topAbsenteesList.innerHTML = '<p class="text-gray-500">No absences recorded in the last 30 days.</p>';
    if (topPresentList.children.length === 0) topPresentList.innerHTML = '<p class="text-gray-500">No attendance recorded in the last 30 days.</p>';


    // --- Attendance by Group Chart ---
    const groupAttendance = [];
    if (groupData && recentAttendance) {
        for (const group of groupData) {
            if (!group.student_group_members) continue;
            const studentIdsInGroup = group.student_group_members.map(m => m.students.id);
            const attendanceInGroup = recentAttendance.filter(r => studentIdsInGroup.includes(r.student_id));
            if (attendanceInGroup.length > 0) {
                const presentOrLateCount = attendanceInGroup.filter(r => r.status === 'present' || r.status === 'late').length;
                const rate = (presentOrLateCount / attendanceInGroup.length) * 100;
                groupAttendance.push({ name: group.group_name, rate: rate.toFixed(1) });
            }
        }
    }

    const ctx = document.getElementById('metric-class-attendance-chart').getContext('2d');
    if (classAttendanceChart) {
        classAttendanceChart.destroy();
    }
    classAttendanceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: groupAttendance.map(c => c.name),
            datasets: [{
                label: 'Attendance Rate (%)',
                data: groupAttendance.map(c => c.rate),
                backgroundColor: 'rgba(79, 70, 229, 0.6)',
                borderColor: 'rgba(79, 70, 229, 1)',
                borderWidth: 1,
                borderRadius: 5
            }]
        },
        options: {
            scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (value) => value + '%' } } },
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });
}

// ====================================================
// ATTENDANCE RECORDS (Interactive)
// ====================================================

function getAttendanceStatusBadge(status) {
    const badges = {
      present: '<span class="inline-block px-3 py-1 rounded-full bg-green-100 text-green-800 font-medium text-sm">Present</span>',
      late: '<span class="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-800 font-medium text-sm">Late</span>',
      absent: '<span class="inline-block px-3 py-1 rounded-full bg-red-100 text-red-800 font-medium text-sm">Absent</span>'
    };
    return badges[status] || badges['absent'];
}

async function manualSetStatus(studentId, newStatus) {
    const selectedDate = document.getElementById('attendance-date-picker').value;
    
    // We can't link to a schedule_id for a manual override,
    // so we upsert with student_id and date.
    const { error } = await db.from('attendance').upsert({
        student_id: studentId,
        date: selectedDate,
        status: newStatus,
        marked_at: new Date().toISOString()
    }, {
        onConflict: 'student_id, date' // Use this composite key
    });

    if (error) {
        showNotification(`Failed to update status: ${error.message}`, 'error');
    } else {
        showNotification('Attendance updated successfully!', 'success');
        loadAttendanceData(); // Refresh the table
    }
}

async function loadAttendanceData() {
    const courseId = document.getElementById('attendance-course').value;
    const groupId = document.getElementById('attendance-group').value;
    const selectedDate = document.getElementById('attendance-date-picker').value;
    const tbody = document.getElementById('attendance-table-body');
    const tableContainer = document.getElementById('attendance-table-container');
    const holidayNotice = document.getElementById('attendance-holiday-notice');
    const noData = document.getElementById('no-attendance-data');

    // Reset UI
    tbody.innerHTML = '';
    noData.classList.add('hidden');
    tableContainer.classList.remove('hidden');
    holidayNotice.classList.add('hidden');
    document.getElementById('attendance-present-count').textContent = '--';
    document.getElementById('attendance-late-count').textContent = '--';
    document.getElementById('attendance-absent-count').textContent = '--';

    // Check for holiday (college-specific)
    const { data: holiday } = await db.from('holidays').select('id').eq('college_id', collegeId).eq('holiday_date', selectedDate).maybeSingle();
    if (holiday) {
        tableContainer.classList.add('hidden');
        holidayNotice.classList.remove('hidden');
        return;
    }

    let studentIdsToFetch = [];

    if (groupId) {
        // Fetch students from a specific group
        const { data: members, error } = await db.from('student_group_members').select('student_id').eq('group_id', groupId);
        if (error || !members) { noData.classList.remove('hidden'); return; }
        studentIdsToFetch = members.map(m => m.student_id);
    } else if (courseId) {
        // Fetch students from ALL groups associated with schedules for this course
        const { data: schedules, error } = await db.from('schedules')
            .select('schedule_groups(student_groups(student_group_members(student_id)))')
            .eq('course_id', courseId);
        
        if (error || !schedules) { noData.classList.remove('hidden'); return; }

        const idSet = new Set();
        schedules.forEach(s => {
            s.schedule_groups.forEach(sg => {
                sg.student_groups.student_group_members.forEach(sgm => {
                    idSet.add(sgm.student_id);
                });
            });
        });
        studentIdsToFetch = Array.from(idSet);
    } else {
        // No course or group, fetch all students in the college
        const { data: allStudents, error } = await db.from('students').select('id').eq('college_id', collegeId);
        if (error || !allStudents) { noData.classList.remove('hidden'); return; }
        studentIdsToFetch = allStudents.map(s => s.id);
    }

    if (studentIdsToFetch.length === 0) {
        noData.classList.remove('hidden');
        return;
    }

    const { data: students, error: studentsError } = await db.from('students')
        .select(`id, name, roll_number, photo_url`)
        .in('id', studentIdsToFetch)
        .order('roll_number');

    if (studentsError || !students || students.length === 0) {
        noData.classList.remove('hidden');
        if (studentsError) console.error(studentsError);
        return;
    }

    // Get attendance records for these students on the selected date
    const { data: attendanceData, error: attendanceError } = await db.from('attendance')
        .select('id, student_id, status, marked_at, image_proof_url') // *** MODIFIED: Select new columns ***
        .in('student_id', studentIdsToFetch)
        .eq('date', selectedDate);
        
    if (attendanceError) {
        console.error(attendanceError);
        return;
    }
    const attendanceMap = new Map(attendanceData.map(record => [record.student_id, record]));

    // Calculate stats and render table
    let presentCount = 0;
    let lateCount = 0;
    let absentCount = 0;

    tbody.innerHTML = students.map(student => {
        const record = attendanceMap.get(student.id);
        const status = record ? record.status : 'absent';
        const time = record && record.marked_at ? new Date(record.marked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit'}) : '---';
        
        if (status === 'present') presentCount++;
        else if (status === 'late') lateCount++;
        else absentCount++;

        // *** NEW: Create the "View Proof" button ***
        let proofButton = '<span class="text-gray-400">N/A</span>';
        if (record && record.image_proof_url) {
            try {
                const imageUrls = JSON.parse(record.image_proof_url);
                if (Array.isArray(imageUrls) && imageUrls.length > 0) {
                    // Pass the raw JSON string to the onclick function
                    proofButton = `<button onclick='showProofImages(event, \`${record.image_proof_url}\`)' class="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200">View (${imageUrls.length})</button>`;
                }
            } catch (e) {
                // Not valid JSON, do nothing
            }
        }
        // *** END OF NEW LOGIC ***

        return `
            <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td class="py-3 px-4">
                    <div class="flex items-center space-x-3">
                        ${student.photo_url ? `<img src="${student.photo_url}" class="w-10 h-10 rounded-full object-cover">` : `<div class="w-10 h-10 photo-placeholder rounded-full flex items-center justify-center text-white font-semibold text-sm">${getInitials(student.name)}</div>`}
                        <div class="font-medium text-gray-900">${student.name}</div>
                    </div>
                </td>
                <td class="py-3 px-4 text-gray-500">${student.roll_number || 'N/A'}</td>
                <td class="py-3 px-4">${getAttendanceStatusBadge(status)}</td>
                <td class="py-3 px-4 text-gray-500">${time}</td>
                <td class="py-3 px-4">${proofButton}</td> <td class="py-3 px-4">
                    <div class="flex space-x-2">
                        <button onclick="manualSetStatus('${student.id}', 'present')" class="px-3 py-1 rounded-lg text-sm font-medium transition-all ${status === 'present' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-green-100 hover:text-green-700'}">Present</button>
                        <button onclick="manualSetStatus('${student.id}', 'late')" class="px-3 py-1 rounded-lg text-sm font-medium transition-all ${status === 'late' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-amber-100 hover:text-amber-700'}">Late</button>
                        <button onclick="manualSetStatus('${student.id}', 'absent')" class="px-3 py-1 rounded-lg text-sm font-medium transition-all ${status === 'absent' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-red-100 hover:text-red-700'}">Absent</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    // Update stat displays
    document.getElementById('attendance-present-count').textContent = presentCount;
    document.getElementById('attendance-late-count').textContent = lateCount;
    document.getElementById('attendance-absent-count').textContent = absentCount;
}

// ====================================================
// NEW: IMAGE PROOF MODAL FUNCTIONS
// ====================================================
async function showProofImages(event, urlJsonString) {
    if (event) event.stopPropagation(); // Prevent row click
    
    const modal = document.getElementById('image-proof-modal');
    const container = document.getElementById('image-proof-container');
    if (!modal || !container) return;

    container.innerHTML = '<p class="text-center text-gray-600">Loading secure images...</p>';
    modal.classList.remove('hidden');

    try {
        const paths = JSON.parse(urlJsonString);
        if (!Array.isArray(paths) || paths.length === 0) {
            container.innerHTML = '<p>No proof images found.</p>';
            return;
        }

        // The stored value might be a full URL or just a path.
        // Let's get the path from the URL if it's a URL.
        const pathList = paths.map(urlOrPath => {
            try {
                // Try to parse as URL
                const url = new URL(urlOrPath);
                // Get path after the bucket name 'attendance_proofs'
                const path = url.pathname.split('/attendance_proofs/')[1];
                return path;
            } catch (e) {
                // It's not a URL, so it's probably already a path
                return urlOrPath;
            }
        });

        // Generate signed URLs for all paths in parallel
        const signedUrlPromises = pathList.map(path => 
            db.storage.from('attendance_proofs').createSignedUrl(path, 60) // 60-second expiry
        );
        
        const signedUrlResults = await Promise.all(signedUrlPromises);

        container.innerHTML = ''; // Clear "Loading..."
        container.insertAdjacentHTML('afterbegin', `<p class="text-sm text-gray-600 mb-4">${signedUrlResults.length} proof image(s) from this lecture:</p>`);

        signedUrlResults.forEach(({ data, error }) => {
            if (error) {
                console.error("Signed URL error:", error);
                container.insertAdjacentHTML('beforeend', '<p class="text-red-500">Error loading one image.</p>');
            } else {
                const img = document.createElement('img');
                img.src = data.signedUrl;
                img.className = 'w-full h-auto rounded-lg mb-4 border border-gray-200';
                container.appendChild(img);
            }
        });

    } catch (e) {
        console.error("Could not parse or load image URLs:", e);
        container.innerHTML = '<p>Error loading proof images.</p>';
    }
}

function closeProofModal() {
    const modal = document.getElementById('image-proof-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}
// ====================================================
// SETTINGS
// ====================================================
async function loadHolidays() {
    const { data, error } = await db.from('holidays').select('*').eq('college_id', collegeId).order('holiday_date', { ascending: true });
    if (error) { console.error("Error loading holidays:", error); return; }
    const list = document.getElementById('holidays-list');
    list.innerHTML = data.map(h => `
        <li class="flex justify-between items-center p-2 bg-gray-100 rounded-lg">
            <span>${new Date(h.holiday_date + 'T00:00:00').toLocaleDateString()} - ${h.description}</span>
            <button onclick="deleteHoliday('${h.id}')" class="text-red-500 hover:text-red-700">Remove</button>
        </li>
    `).join('');
}

async function loadSettings() {
    const { data, error } = await db.from('college_settings').select('*').eq('college_id', collegeId);
    if (error) {
        console.error("Error loading settings:", error);
        return;
    }

    document.getElementById('late-time').value = '';
    const emailEnabledCheckbox = document.getElementById('email-enabled');
    emailEnabledCheckbox.checked = false;
    document.getElementById('overall-threshold').value = '75';
    document.getElementById('course-threshold').value = '60';

    data.forEach(setting => {
        const key = setting.setting_key;
        let value = setting.setting_value;

        // Handle new JSONB format
        if (typeof value === 'string') {
            try {
                value = JSON.parse(value);
            } catch (e) {
                // It's just a plain string, let it be.
            }
        }
        
        if (key === 'late_threshold_time') {
            document.getElementById('late-time').value = value;
        }
        if (key === 'email_enabled') {
            emailEnabledCheckbox.checked = value === true || value === 'true';
        }
        if (key === 'email_overall_threshold') {
            document.getElementById('overall-threshold').value = value;
        }
        if (key === 'email_course_threshold') {
            document.getElementById('course-threshold').value = value;
        }
    });
    
    toggleEmailControls();
}


async function handleHolidayForm(e) {
    e.preventDefault();
    const date = document.getElementById('holiday-date').value;
    const desc = document.getElementById('holiday-desc').value;
    if (!date) return;

    const { error } = await db.from('holidays').insert({ holiday_date: date, description: desc, college_id: collegeId });
    if (error) {
        showNotification(`Error: ${error.message}`, 'error');
    } else {
        showNotification('Holiday added!', 'success');
        await loadHolidays();
        e.target.reset();
    }
}


async function deleteHoliday(id) {
    if (!confirm('Are you sure?')) return;
    const { error } = await db.from('holidays').delete().eq('id', id);
    if (error) {
        showNotification(`Error: ${error.message}`, 'error');
    } else {
        showNotification('Holiday removed.', 'success');
        await loadHolidays();
    }
}

async function handleGeneralSettingsForm(e) {
    e.preventDefault();
    const lateTime = document.getElementById('late-time').value;

    const { error } = await db.from('college_settings').upsert({
        college_id: collegeId,
        setting_key: 'late_threshold_time',
        setting_value: lateTime // No need to stringify, JSONB handles strings
    }, { onConflict: 'college_id, setting_key' });

    if (error) {
        showNotification(`Error: ${error.message}`, 'error');
    } else {
        showNotification('Settings saved!', 'success');
    }
}

async function handleEmailSettingsForm(e) {
    e.preventDefault();
    const settingsToSave = [
        { college_id: collegeId, setting_key: 'email_enabled', setting_value: document.getElementById('email-enabled').checked },
        { college_id: collegeId, setting_key: 'email_overall_threshold', setting_value: parseInt(document.getElementById('overall-threshold').value, 10) },
        { college_id: collegeId, setting_key: 'email_course_threshold', setting_value: parseInt(document.getElementById('course-threshold').value, 10) }
    ];

    const { error } = await db.from('college_settings').upsert(settingsToSave, { onConflict: 'college_id, setting_key' });
    if (error) {
        showNotification(`Error: ${error.message}`, 'error');
    } else {
        showNotification('Email settings saved!', 'success');
    }
}

// ====================================================
// STUDENT MANAGEMENT
// ====================================================

function resetStudentForm() {
  document.getElementById('student-form').reset();
  document.getElementById('photo-img').classList.add('hidden');
  document.getElementById('photo-initials').style.display = 'flex';
  document.getElementById('photo-initials').textContent = '?';
  document.getElementById('form-title').textContent = 'Register New Student';
  document.getElementById('submit-btn-text').textContent = 'Register Student';
  document.getElementById('cancel-btn').classList.add('hidden');
  // Clear multi-select
  const multiSelect = document.getElementById('student-groups');
  Array.from(multiSelect.options).forEach(option => option.selected = false);
  editingStudentId = null;
}

function previewPhoto(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('photo-img').src = e.target.result;
      document.getElementById('photo-img').classList.remove('hidden');
      document.getElementById('photo-initials').style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
}

async function saveStudent(event) {
    event.preventDefault();
    const name = document.getElementById('student-name').value;
    const roll = document.getElementById('student-roll').value;
    const email = document.getElementById('student-email').value;
    const photoFile = document.getElementById('student-photo').files[0];
    
    // Get selected group IDs from multi-select
    const selectedGroupOptions = Array.from(document.getElementById('student-groups').selectedOptions);
    const groupIds = selectedGroupOptions.map(option => option.value);

    if (groupIds.length === 0) {
        showNotification('Please select at least one student group.', 'error');
        return;
    }

    // Disable button
    const submitBtn = document.getElementById('submit-btn-text');
    submitBtn.textContent = editingStudentId ? 'Updating...' : 'Registering...';
    submitBtn.disabled = true;

    try {
        // 1. Upload Photo & Get Embedding (if photo provided)
        let photo_url = null;
        let face_embedding = null;

        if (photoFile) {
            const filePath = `public/${collegeId}/${Date.now()}-${photoFile.name}`;
            const { error: uploadError } = await db.storage.from('student-photos').upload(filePath, photoFile);
            if (uploadError) throw new Error(`Photo Upload Failed: ${uploadError.message}`);
            
            const { data: { publicUrl } } = db.storage.from('student-photos').getPublicUrl(filePath);
            photo_url = publicUrl;

            // Get embedding
            const formData = new FormData();
            formData.append('image', photoFile);
            const response = await fetch(`${FACE_API_URL}/get_embedding`, { method: 'POST', body: formData });
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to get face embedding. No face detected?');
            }
            const data = await response.json();
            face_embedding = data.embedding ? JSON.stringify(data.embedding) : null;
        }

        // 2. Upsert Student Data
        const studentData = {
            name,
            roll_number: roll,
            email,
            college_id: collegeId,
        };

        if (photo_url) studentData.photo_url = photo_url;
        if (face_embedding) studentData.face_embedding = face_embedding;

        let student_id = editingStudentId;

        if (editingStudentId) {
            // Update existing student
            const { data, error } = await db.from('students').update(studentData).eq('id', editingStudentId).select('id').single();
            if (error) throw error;
        } else {
            // Insert new student
            const { data, error } = await db.from('students').insert(studentData).select('id').single();
            if (error) throw error;
            student_id = data.id;
        }

        // 3. Sync Student Group Memberships
        // First, remove all existing memberships for this student
        const { error: deleteError } = await db.from('student_group_members').delete().eq('student_id', student_id);
        if (deleteError) throw new Error(`Failed to clear old groups: ${deleteError.message}`);

        // Second, add the new memberships
        const memberships = groupIds.map(group_id => ({
            student_id: student_id,
            group_id: group_id
        }));
        const { error: insertError } = await db.from('student_group_members').insert(memberships);
        if (insertError) throw new Error(`Failed to add to groups: ${insertError.message}`);

        showNotification(editingStudentId ? 'Student updated successfully!' : 'Student registered successfully!');
        resetStudentForm();
        await loadAllStudents(); // Refresh cache
        renderStudentsTable(); // Render from cache

    } catch (error) {
        console.error('Error saving student:', error);
        showNotification(`Error: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = editingStudentId ? 'Update Student' : 'Register Student';
    }
}

async function editStudent(id) {
  const { data: student, error } = await db.from('students')
    .select(`*, student_group_members(group_id)`)
    .eq('id', id)
    .single();
    
  if (error) {
    showNotification('Failed to fetch student details.', 'error');
    return;
  }

  editingStudentId = id;
  document.getElementById('student-name').value = student.name;
  document.getElementById('student-roll').value = student.roll_number;
  document.getElementById('student-email').value = student.email;

  // Pre-select the groups in the multi-select
  const selectedGroupIds = student.student_group_members.map(m => m.group_id);
  const multiSelect = document.getElementById('student-groups');
  Array.from(multiSelect.options).forEach(option => {
      option.selected = selectedGroupIds.includes(option.value);
  });

  if (student.photo_url) {
    document.getElementById('photo-img').src = student.photo_url;
    document.getElementById('photo-img').classList.remove('hidden');
    document.getElementById('photo-initials').style.display = 'none';
  } else {
    document.getElementById('photo-img').classList.add('hidden');
    document.getElementById('photo-initials').style.display = 'flex';
    document.getElementById('photo-initials').textContent = getInitials(student.name);
  }
  document.getElementById('form-title').textContent = 'Edit Student Details';
  document.getElementById('submit-btn-text').textContent = 'Update Student';
  document.getElementById('cancel-btn').classList.remove('hidden');
  showTab('students');
}

async function deleteStudent(id) {
  if (confirm('Are you sure? This will delete the student and all their attendance records.')) {
    const { error } = await db.from('students').delete().eq('id', id);
    if (error) {
      showNotification(`Error: ${error.message}`, 'error');
    } else {
      showNotification('Student deleted successfully!');
      await loadAllStudents(); // Refresh cache
      renderStudentsTable(); // Render from cache
    }
  }
}

async function loadAllStudents() {
    const { data, error } = await db.from('students')
        .select(`*, student_group_members(student_groups(id, group_name))`)
        .eq('college_id', collegeId)
        .order('name');
    
    if (error) {
        console.error("Failed to load students:", error);
        allStudentsCache = [];
    } else {
        allStudentsCache = data;
    }
}

function renderStudentsTable() {
    // **** THIS IS THE PATCH ****
    // We get the element first and check if it exists before trying to read its value.
    const searchInput = document.getElementById('student-search');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : ''; // This no longer crashes

    const courseFilterInput = document.getElementById('student-course-filter');
    const courseFilter = courseFilterInput ? courseFilterInput.value : '';

    const groupFilterInput = document.getElementById('student-group-filter');
    const groupFilter = groupFilterInput ? groupFilterInput.value : '';
    // **** END OF PATCH ****

    const tbody = document.getElementById('students-table-body');
    const noStudents = document.getElementById('no-students');
    
    // Filter from cache
    let filteredStudents = allStudentsCache;

    if (searchTerm) {
        filteredStudents = filteredStudents.filter(s => 
            s.name.toLowerCase().includes(searchTerm) ||
            (s.roll_number && s.roll_number.toLowerCase().includes(searchTerm))
        );
    }
    
    // We need to implement group/course filtering. This is complex.
    // For now, let's just render the search-filtered list.

    if (filteredStudents.length === 0) {
        tbody.innerHTML = '';
        noStudents.classList.remove('hidden');
        document.getElementById('student-count').textContent = '0 Total';
        return;
    }
    
    noStudents.classList.add('hidden');
    tbody.innerHTML = filteredStudents.map(student => {
        const groups = student.student_group_members.map(m => m.student_groups.group_name).join(', ');
        return `
            <tr class="border-b border-gray-50 hover:bg-blue-50/50">
              <td class="py-4 px-4">${student.photo_url ? `<img src="${student.photo_url}" class="w-12 h-12 rounded-full object-cover">` : `<div class="w-12 h-12 photo-placeholder rounded-full flex items-center justify-center"><span class="text-white font-bold text-sm">${getInitials(student.name)}</span></div>`}</td>
              <td class="py-4 px-4 font-semibold text-gray-900">${student.name}</td>
              <td class="py-4 px-4 text-gray-600">${groups || 'No Group'}</td>
              <td class="py-4 px-4 text-gray-600">${student.roll_number || 'N/A'}</td>
              <td class="py-4 px-4"><div class="flex space-x-2"><button onclick="editStudent('${student.id}')" class="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200">Edit</button><button onclick="deleteStudent('${student.id}')" class="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200">Delete</button></div></td>
            </tr>
        `;
    }).join('');
    document.getElementById('student-count').textContent = `${filteredStudents.length} / ${allStudentsCache.length} Total`;
}


// ====================================================
// ACADEMICS & SCHEDULER MANAGEMENT
// ====================================================

// --- Faculty Tab ---
async function addFaculty(event) {
    event.preventDefault();
    const fullName = document.getElementById('faculty-name').value;
    const email = document.getElementById('faculty-email').value;
    const password = document.getElementById('faculty-password').value;

    if (password.length < 8) {
        showNotification('Password must be at least 8 characters.', 'error');
        return;
    }
    
    const btn = document.getElementById('add-faculty-btn');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
        // 1. Create the Auth user for the teacher
        const { data: authData, error: authError } = await db.auth.signUp({
            email: email,
            password: password,
            options: {
                email_confirm: false, 
            }
        });

        if (authError) {
            if (authError.message.includes("User already registered")) {
                showNotification('This email is already registered.', 'error');
            } else {
                throw authError;
            }
            return;
        }
        
        const userId = authData.user?.id || authData.id;
        if (!userId) {
            throw new Error("Could not create user account.");
        }

        // 2. Create the teacher's profile
        const { error: profileError } = await db.from('profiles').insert({
            id: userId,
            college_id: collegeId,
            full_name: fullName,
            email: email,
            role: 'teacher'
        });
        
        if (profileError) {
            // If profile fails, we should try to clean up the auth user
            // This is hard from client-side. We'll just throw the profile error.
            console.error("Profile creation failed, but auth user may exist:", profileError);
            throw new Error(`Auth user created, but profile failed: ${profileError.message}`);
        }
        
        showNotification('Faculty added successfully! They can log in immediately.', 'success');
        event.target.reset();
        await renderFacultyList();
        await updateTeacherSelectors(); // Update dropdowns

    } catch (error) {
        console.error('Error adding faculty:', error);
        showNotification(`Error adding faculty: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add Faculty';
    }
}

async function renderFacultyList() {
    const { data, error } = await db.from('profiles')
        .select('*')
        .eq('college_id', collegeId)
        .eq('role', 'teacher')
        .order('full_name');
        
    if (error) { console.error("Error loading faculty:", error); return; }
    
    const container = document.getElementById('faculty-list');
    container.innerHTML = data.map(f => `
        <div class="flex justify-between items-center p-3 bg-gray-100 rounded-lg">
            <div>
                <span class="text-gray-800 font-medium">${f.full_name}</span>
                <span class="text-gray-500 text-sm ml-2">(${f.email})</span>
            </div>
            <button onclick="deleteFaculty('${f.id}')" class="text-red-500 hover:text-red-700">Delete</button>
        </div>
    `).join('');
}

async function deleteFaculty(id) {
    if (confirm('Are you sure? This will delete the teacher\'s login and profile.')) {
        // We use rpc to call a db function because RLS might block
        // a simple delete if the user is not a 'postgres' role.
        // For this to work, you need to create a function in Supabase SQL Editor:
        // CREATE OR REPLACE FUNCTION delete_teacher_user(user_id uuid)
        // RETURNS void
        // LANGUAGE plpgsql
        // SECURITY DEFINER -- !! DANGEROUS, but necessary for this
        // AS $$
        // BEGIN
        //   DELETE FROM auth.users WHERE id = user_id;
        // END;
        // $$;
        
        // Since we can't be sure the user created that, let's just delete the profile
        // and ask them to delete the auth user manually.
        
        const { error: profileError } = await db.from('profiles').delete().eq('id', id);
        
        if (profileError) {
            showNotification(`Error: ${profileError.message}`, 'error');
        } else {
            // Manually delete the auth user (requires SERVICE_ROLE key, only on a server)
            // This is complex. For now, just delete the profile.
            showNotification('Teacher profile deleted. You must manually delete their login from the Auth > Users panel.', 'success');
            await renderFacultyList();
            await updateTeacherSelectors();
        }
    }
}


// --- Academics Tab ---
async function addCourse(event) {
    event.preventDefault();
    const name = document.getElementById('new-course-name').value.trim();
    const code = document.getElementById('new-course-code').value.trim();
    if (!name) return;
    const { error } = await db.from('courses').insert({ name, course_code: code, college_id: collegeId });
    if (error) {
        showNotification(error.code === '23505' ? 'Course name already exists.' : `Error: ${error.message}`, 'error');
    } else {
        showNotification('Course added successfully!');
        event.target.reset();
        await renderCoursesList();
        await updateCourseSelectors();
    }
}

async function renderCoursesList() {
    const { data, error } = await db.from('courses').select('*').eq('college_id', collegeId).order('name');
    if (error) return;
    const container = document.getElementById('courses-list');
    container.innerHTML = data.map(c => `
        <div class="flex justify-between items-center p-2 bg-blue-100 rounded-lg">
            <span class="text-blue-800 font-medium">${c.name} (${c.course_code || 'N/A'})</span>
            <button onclick="deleteCourse('${c.id}')" class="text-red-500 hover:text-red-700">Delete</button>
        </div>
    `).join('');
}

async function deleteCourse(id) {
    if (confirm('Are you sure? This will delete all schedules associated with this course.')) {
        const { error } = await db.from('courses').delete().eq('id', id);
        if (error) {
            showNotification(`Error: ${error.message}`, 'error');
        } else {
            showNotification('Course deleted successfully!');
            await renderCoursesList();
            await updateCourseSelectors();
        }
    }
}

async function addStudentGroup(event) {
    event.preventDefault();
    const name = document.getElementById('new-group-name').value.trim();
    if (!name) return;
    try {
        const { error } = await db.from('student_groups').insert({ group_name: name, college_id: collegeId });
        if (error) throw error;
        showNotification('Student Group added successfully!');
        event.target.reset();
        await renderStudentGroupsList();
        await updateStudentGroupSelectors(); // Update all group dropdowns
    } catch (error) {
        showNotification(error.code === '23505' ? 'Group name already exists.' : `Error: ${error.message}`, 'error');
    }
}

async function renderStudentGroupsList() {
    const { data, error } = await db.from('student_groups').select('*').eq('college_id', collegeId).order('group_name');
    if (error) return;
    const container = document.getElementById('student-groups-list');
    container.innerHTML = data.map(s => `
        <div class="flex justify-between items-center p-2 bg-orange-100 rounded-lg">
            <span class="text-orange-800 font-medium">${s.group_name}</span>
            <button onclick="deleteStudentGroup('${s.id}')" class="text-red-500 hover:text-red-700">Delete</button>
        </div>
    `).join('');
}

async function deleteStudentGroup(id) {
    if (confirm('Are you sure? This will remove all students from this group.')) {
        const { error } = await db.from('student_groups').delete().eq('id', id);
        if (error) {
            showNotification(`Error: ${error.message}`, 'error');
        } else {
            showNotification('Group deleted successfully!');
            await renderStudentGroupsList();
            await updateStudentGroupSelectors();
        }
    }
}

// --- Scheduler Tab ---
async function addSchedule(event) {
    event.preventDefault();
    const course_id = document.getElementById('schedule-course').value;
    const teacher_profile_id = document.getElementById('schedule-teacher').value;
    const day_of_week = document.getElementById('schedule-day').value;
    const start_time = document.getElementById('schedule-start-time').value;
    const end_time = document.getElementById('schedule-end-time').value;

    const selectedGroupOptions = Array.from(document.getElementById('schedule-groups').selectedOptions);
    const groupIds = selectedGroupOptions.map(option => option.value);

    if (!course_id || !teacher_profile_id || !day_of_week || !start_time || !end_time || groupIds.length === 0) {
        showNotification('Please fill all fields and select at least one group.', 'error');
        return;
    }

    try {
        // 1. Insert the schedule
        const { data: scheduleData, error: scheduleError } = await db.from('schedules').insert({
            college_id: collegeId,
            course_id,
            teacher_profile_id,
            day_of_week,
            start_time,
            end_time
        }).select('id').single();

        if (scheduleError) throw scheduleError;

        // 2. Link the groups
        const scheduleGroups = groupIds.map(group_id => ({
            schedule_id: scheduleData.id,
            group_id: group_id
        }));
        
        const { error: groupLinkError } = await db.from('schedule_groups').insert(scheduleGroups);
        if (groupLinkError) throw groupLinkError;

        showNotification('Schedule added successfully!', 'success');
        event.target.reset();
        await renderSchedulesList();

    } catch (error) {
        console.error("Error adding schedule:", error);
        showNotification(`Error: ${error.message}`, 'error');
    }
}

async function renderSchedulesList() {
    const { data, error } = await db.from('schedules')
        .select(`*, courses(name), profiles(full_name), schedule_groups(student_groups(group_name))`)
        .eq('college_id', collegeId)
        .order('day_of_week')
        .order('start_time');

    if (error) { console.error("Error loading schedules:", error); return; }

    const container = document.getElementById('schedules-list');
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    container.innerHTML = data.map(s => {
        const groups = s.schedule_groups.map(g => g.student_groups.group_name).join(', ');
        return `
            <div class="p-3 bg-gray-100 rounded-lg">
                <div class="flex justify-between items-center">
                    <div>
                        <span class="font-bold text-primary">${s.courses.name}</span>
                        <span class="text-gray-600">with ${s.profiles.full_name}</span>
                    </div>
                    <button onclick="deleteSchedule('${s.id}')" class="text-red-500 hover:text-red-700 text-sm">Delete</button>
                </div>
                <div class="text-sm text-gray-500 mt-1">
                    <strong>${days[s.day_of_week]}</strong> at ${s.start_time} - ${s.end_time}
                </div>
                <div class="text-sm text-gray-500 mt-1">
                    <strong>Groups:</strong> ${groups}
                </div>
            </div>
        `;
    }).join('<hr class="my-2 border-gray-200">');
}

async function deleteSchedule(id) {
    if (confirm('Are you sure you want to delete this schedule?')) {
        const { error } = await db.from('schedules').delete().eq('id', id);
        if (error) {
            showNotification(`Error: ${error.message}`, 'error');
        } else {
            showNotification('Schedule deleted successfully!');
            await renderSchedulesList();
        }
    }
}


// ====================================================
// SHARED SELECTOR POPULATION
// ====================================================

async function updateCourseSelectors() {
    const { data, error } = await db.from('courses').select('*').eq('college_id', collegeId).order('name');
    if (error) return;
    const selectors = ['attendance-course', 'student-course-filter', 'schedule-course'];
    const options = '<option value="">Select Course</option>' + data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    selectors.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerHTML = options;
    });
}

async function updateStudentGroupSelectors() {
    const { data, error } = await db.from('student_groups').select('*').eq('college_id', collegeId).order('group_name');
    if (error) return;
    const selectors = ['attendance-group', 'student-group-filter'];
    const multiSelectors = ['student-groups', 'schedule-groups'];
    
    const options = '<option value="">Select Group</option>' + data.map(c => `<option value="${c.id}">${c.group_name}</option>`).join('');
    const multiOptions = data.map(c => `<option value="${c.id}">${c.group_name}</option>`).join('');

    selectors.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerHTML = options;
    });
    
    multiSelectors.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerHTML = multiOptions;
    });
}

async function updateTeacherSelectors() {
    const { data, error } = await db.from('profiles')
        .select('*')
        .eq('college_id', collegeId)
        .eq('role', 'teacher')
        .order('full_name');
    if (error) return;
    
    const selectors = ['schedule-teacher'];
    const options = '<option value="">Select Teacher</option>' + data.map(c => `<option value="${c.id}">${c.full_name}</option>`).join('');
    selectors.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerHTML = options;
    });
}

// Specific filter logic
async function updateAttendanceGroupOptions(courseId) {
    const groupSelect = document.getElementById('attendance-group');
    if (!groupSelect) return;
    if (!courseId) {
        groupSelect.innerHTML = '<option value="">All Groups</option>';
        return;
    }
    // This is complex. We need to find groups that are part of schedules for this course.
    // For now, let's just show all groups in the college.
    const { data, error } = await db.from('student_groups').select('*').eq('college_id', collegeId).order('group_name');
    if (error) return;
    groupSelect.innerHTML = '<option value="">All Groups</option>' + data.map(s => `<option value="${s.id}">${s.group_name}</option>`).join('');
}

async function updateStudentGroupFilter(courseId) {
    // This is also complex.
    // For now, let's just show all groups in the college.
    const groupSelect = document.getElementById('student-group-filter');
    if (!groupSelect) return;
    const { data, error } = await db.from('student_groups').select('*').eq('college_id', collegeId).order('group_name');
    if (error) return;
    groupSelect.innerHTML = '<option value="">All Groups</section>' + data.map(s => `<option value="${s.id}">${s.group_name}</option>`).join('');
}


// ====================================================
// ====================================================
//          NEW BULK UPLOAD FUNCTIONS
// ====================================================
// ====================================================

/**
 * Fetches all student groups for the current college and returns a map.
 * @returns {Map<string, string>} A map where key is "group_name" and value is "group_id".
 */
async function getStudentGroupMap() {
    const groupMap = new Map();

    // 1. Fetch all student groups for the college
    const { data: groups, error: groupError } = await db
        .from('student_groups')
        .select('id, group_name')
        .eq('college_id', collegeId);

    if (groupError) throw new Error(`Failed to fetch student groups: ${groupError.message}`);

    if (!groups || groups.length === 0) {
        return groupMap; // No groups, return empty map
    }

    // 2. Create the lookup map
    groups.forEach(group => {
        groupMap.set(group.group_name, group.id);
    });

    return groupMap;
}

/**
 * Handles the Excel file upload, parsing, and invocation of the bulk-add-students function.
 */
async function handleExcelUpload() {
    const fileInput = document.getElementById('student-excel-file');
    const statusDiv = document.getElementById('upload-status');
    const processBtn = document.getElementById('process-excel-btn');

    if (!fileInput.files || fileInput.files.length === 0) {
        showNotification('Please select an Excel file first.', 'error');
        return;
    }

    const file = fileInput.files[0];
    statusDiv.textContent = 'Starting process... This may take a while.';
    statusDiv.className = 'mt-4 text-sm text-blue-600';
    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';

    try {
        // 1. Get the Student Group mapping
        statusDiv.textContent = 'Fetching student group data...';
        const groupMap = await getStudentGroupMap();
        if (groupMap.size === 0) {
            throw new Error("No Student Groups are set up. Please add groups in the 'Academics' tab before uploading.");
        }

        // 2. Read and Parse the Excel file
        statusDiv.textContent = 'Parsing Excel file...';
        const reader = new FileReader();
        reader.onload = async (e) => {
            let studentsPayload = [];
            let validationErrors = [];

            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet);

                if (json.length === 0) {
                    throw new Error("Excel file is empty or in the wrong format.");
                }

                // 3. Validate and map data
                statusDiv.textContent = `Found ${json.length} records. Validating...`;

                for (const [index, row] of json.entries()) {
                    const groupName = row.Student_Group?.trim();
                    const group_id = groupMap.get(groupName);

                    if (!group_id) {
                        validationErrors.push(`Row ${index + 2}: Could not find a matching Student Group named "${groupName}".`);
                        continue;
                    }

                    if (!row.Name || !row.Roll_Number || !row.Image_URL) {
                         validationErrors.push(`Row ${index + 2}: Missing required data (Name, Roll_Number, or Image_URL).`);
                        continue;
                    }

                    studentsPayload.push({
                        name: String(row.Name),
                        roll_number: String(row.Roll_Number),
                        email: row.Email ? String(row.Email) : null,
                        image_url: String(row.Image_URL),
                        group_id: group_id,
                        college_id: collegeId, // Global collegeId
                    });
                }

                if (validationErrors.length > 0) {
                    throw new Error(`Validation failed:\n- ${validationErrors.join('\n- ')}`);
                }

                // 4. Invoke the Edge Function *one by one*
                statusDiv.textContent = `Validation complete. Uploading ${studentsPayload.length} students...`;
                
                let processedCount = 0;
                let errorCount = 0;
                const errors = [];

                for (const student of studentsPayload) {
                    statusDiv.textContent = `Uploading ${processedCount + errorCount + 1} of ${studentsPayload.length}: ${student.name}...`;
                    
                    try {
                        // ** ================== MODIFIED PART ================== **
                        // We now send the student object wrapped in a "student" key
                        const { data: result, error: funcError } = await db.functions.invoke('bulk-add-students', {
                            body: { student: student } // Wrap it here
                        });
                        // ** =================================================== **

                        if (funcError) {
                            throw funcError; // Throw the FunctionsHttpError
                        }

                        // If we are here, it's a success
                        processedCount++;

                    } catch (error) {
                        // This will catch the FunctionsHttpError
                        errorCount++;
                        
                        let specificErrorMessage = "Edge Function returned a non-2xx status code";
                        
                        console.error(`Raw error object for ${student.name}:`, error); // Log the whole error

                        if (error.context && error.context.error) {
                            specificErrorMessage = error.context.error;
                        } else if (error.context && error.context.message) {
                            specificErrorMessage = error.context.message;
                        } else if (error.context && typeof error.context === 'string') {
                             try {
                                const parsed = JSON.parse(error.context);
                                specificErrorMessage = parsed.error || parsed.message || "Could not parse error string.";
                            } catch (e) {
                                specificErrorMessage = error.context;
                            }
                        } else if (error.message) {
                            specificErrorMessage = error.message;
                        }

                        console.error(`Error processing ${student.name}:`, specificErrorMessage);
                        errors.push(`Failed to process ${student.name}: ${specificErrorMessage}`);
                    }
                }

                // 5. Show final results
                const finalMessage = `Process complete. Added ${processedCount} students. Failed ${errorCount} students.`;
                statusDiv.textContent = finalMessage;
                statusDiv.className = `mt-4 text-sm ${errorCount > 0 ? 'text-red-700' : 'text-green-700'}`;
                showNotification(finalMessage, errorCount > 0 ? 'error' : 'success');

                if (errors.length > 0) {
                    console.error("Processing errors:", errors);
                    statusDiv.innerHTML += `<br><strong class="text-red-600">Some students failed:</strong><ul class="list-disc pl-5"><li>${errors.join('</li><li>')}</li></ul>`;
                }

                await loadAllStudents(); // Refresh the student list
                renderStudentsTable();

            } catch (innerError) {
                console.error('Upload Error:', innerError);
                statusDiv.textContent = `Error: ${innerError.message}`;
                statusDiv.className = 'mt-4 text-sm text-red-600';
                showNotification(innerError.message, 'error');
            } finally {
                processBtn.disabled = false;
                processBtn.textContent = 'Upload & Process';
                fileInput.value = ''; // Clear the file input
            }
        };

        reader.onerror = () => {
             throw new Error("Failed to read the file.");
        };

        reader.readAsArrayBuffer(file);

    } catch (outerError) {
        console.error('Upload Process Failed:', outerError);
        statusDiv.textContent = `Error: ${outerError.message}`;
        statusDiv.className = 'mt-4 text-sm text-red-600';
        showNotification(outerError.message, 'error');
        processBtn.disabled = false;
        processBtn.textContent = 'Upload & Process';
    }
}