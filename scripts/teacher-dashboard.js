// ====================================================
// SUPABASE & API CONFIGURATION
// ====================================================
const SUPABASE_URL = 'https://zlkleprvhjgjcjycezpu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsa2xlcHJ2aGpnamNqeWNlenB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxNzAyNDcsImV4cCI6MjA3Nzc0NjI0N30.e1LkaKKXfDUOHOh1Oi6GY1lwpd5DZ5R-FkSP62XXGD0';
const FACE_API_WS_URL = 'wss://ca.avinya.live'; // Make sure this is your Python server's URL

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====================================================
// DOM ELEMENTS
// ====================================================
const lectureListView = document.getElementById('lecture-list-view');
const attendanceView = document.getElementById('attendance-view');
const teacherNameDisplay = document.getElementById('teacher-name-display');
const lectureListContainer = document.getElementById('lecture-list-container');
const noLectures = document.getElementById('no-lectures');
const addExtraClassBtn = document.getElementById('add-extra-class-btn');
const logoutBtn = document.getElementById('logout-btn');
const backToDashboardBtn = document.getElementById('back-to-dashboard-btn');
const attendanceViewTitle = document.getElementById('attendance-view-title');
const attendanceViewSubtitle = document.getElementById('attendance-view-subtitle');
const uploadSection = document.getElementById('upload-section');

// *** NEW: Canvas/Video elements ***
const videoFeed = document.getElementById('video-feed');
const overlayCanvas = document.getElementById('overlay-canvas');
const overlayCtx = overlayCanvas.getContext('2d');
let captureCanvas = document.createElement('canvas'); // In-memory canvas for sending frames

const videoErrorMsg = document.getElementById('video-error-msg');
const unknownFacesCountDisplay = document.getElementById('unknown-faces-count');
const studentListContainer = document.getElementById('student-list-container');
const markAllAbsentBtn = document.getElementById('mark-all-absent-btn');
const submitAttendanceBtn = document.getElementById('submit-attendance-btn');
const startScanBtn = document.getElementById('start-scan-btn');
const scanStatus = document.getElementById('scan-status');
const extraClassModal = document.getElementById('extra-class-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const extraClassForm = document.getElementById('extra-class-form');
const extraCourseSelect = document.getElementById('extra-course-select');
const extraGroupsSelect = document.getElementById('extra-groups-select');

// ====================================================
// GLOBAL STATE
// ====================================================
let teacherProfile = null;
let collegeId = null;
let currentLecture = null; 
let studentAttendanceList = []; 
let stream = null; 
let isCameraOn = false;
let socket = null; 
let isScanning = false; 
let scanLoopId = null; // For the 1 FPS *sending* loop
let drawLoopId = null; // For the 30 FPS *drawing* loop
const FRAME_INTERVAL = 1000; // Scan 1 frame per second
let scannedFramesCache = []; // Stores frames for submission
let unknownFacesCount = 0; 
let lastBoxes = []; // Stores the last known boxes to draw

// ====================================================
// INITIALIZATION
// ====================================================
window.addEventListener('load', async () => {
    await checkAuth();
    await loadTeacherProfile();
    await loadLectures();
    setupEventListeners();
});

async function checkAuth() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
        window.location.href = '/login.html';
        return;
    }
}

async function loadTeacherProfile() {
    const { data: { user } } = await db.auth.getUser();
    const { data: profile, error } = await db.from('profiles')
        .select('*, colleges(name)')
        .eq('id', user.id)
        .single();
    if (error || !profile) {
        window.location.href = '/login.html'; return;
    }
    if (profile.role !== 'teacher') {
        window.location.href = '/login.html'; return;
    }
    teacherProfile = profile;
    collegeId = profile.college_id;
    teacherNameDisplay.textContent = profile.full_name || 'Teacher';
}

function setupEventListeners() {
    logoutBtn.addEventListener('click', async () => {
        await db.auth.signOut();
        window.location.href = '/login.html';
    });
    backToDashboardBtn.addEventListener('click', showLectureListView);
    startScanBtn.addEventListener('click', toggleContinuousScan);
    markAllAbsentBtn.addEventListener('click', () => {
        studentAttendanceList.forEach(item => item.status = 'absent');
        updateStudentListUI();
        showNotification('List reset to all absent.', 'success');
    });
    submitAttendanceBtn.addEventListener('click', submitAttendance);
    addExtraClassBtn.addEventListener('click', openExtraClassModal);
    closeModalBtn.addEventListener('click', () => extraClassModal.classList.add('hidden'));
    extraClassForm.addEventListener('submit', startExtraClass);
}

// ====================================================
// VIEW 1: LECTURE LIST
// ====================================================
async function loadLectures() {
    const today = new Date().getDay();
    const { data: lectures, error } = await db.from('schedules')
        .select(`
            id, day_of_week, start_time, end_time, is_extra_class,
            courses (id, name, course_code),
            schedule_groups ( student_groups (id, group_name) )
        `)
        .eq('teacher_profile_id', teacherProfile.id)
        .eq('day_of_week', today)
        .order('start_time');
    if (error) { console.error("Error fetching lectures:", error); return; }
    
    const todayStr = new Date().toISOString().split('T')[0];
    const scheduleIds = lectures.map(l => l.id);
    let submittedScheduleIds = new Set();
    if (scheduleIds.length > 0) {
        const { data: attendanceData } = await db.from('attendance')
            .select('schedule_id')
            .in('schedule_id', scheduleIds)
            .eq('date', todayStr);
        if (attendanceData) {
            submittedScheduleIds = new Set(attendanceData.map(a => a.schedule_id));
        }
    }

    lectureListContainer.innerHTML = '';
    if (lectures.length === 0) {
        noLectures.classList.remove('hidden');
        return;
    }
    noLectures.classList.add('hidden');

    lectures.forEach(lecture => {
        const isSubmitted = submittedScheduleIds.has(lecture.id);
        const card = document.createElement('div');
        card.className = 'glass-card rounded-2xl shadow-lg p-6 flex flex-col justify-between';
        const groups = lecture.schedule_groups.map(sg => sg.student_groups.group_name).join(', ');
        const startTime = formatTime(lecture.start_time);
        let titlePrefix = lecture.is_extra_class ? '[Extra Class] ' : '';
        let timeDisplay = lecture.is_extra_class ? `Created at ${startTime}` : `${startTime} - ${formatTime(lecture.end_time)}`;

        card.innerHTML = `
            <div>
                <div class="flex justify-between items-center mb-2">
                    <span class="text-sm font-semibold text-indigo-600">${lecture.courses.course_code || ''}</span>
                    <span class="text-xs font-bold px-3 py-1 rounded-full ${isSubmitted ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}">
                        ${isSubmitted ? 'Submitted' : 'Pending'}
                    </span>
                </div>
                <h3 class="text-2xl font-bold text-gray-800 mb-2">${titlePrefix}${lecture.courses.name}</h3>
                <p class="text-gray-600 mb-1"><strong>Time:</strong> ${timeDisplay}</p>
                <p class="text-gray-600"><strong>Groups:</strong> ${groups}</p>
            </div>
            <button class="take-attendance-btn w-full ${isSubmitted ? 'bg-green-600 hover:bg-green-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white py-3 px-6 rounded-xl font-bold text-base transition-all mt-6">
                ${isSubmitted ? 'Edit Attendance' : 'Take Attendance'}
            </button>
        `;
        card.querySelector('.take-attendance-btn').addEventListener('click', () => {
            currentLecture = lecture;
            currentLecture.isSubmitted = isSubmitted;
            showAttendanceView();
        });
        lectureListContainer.appendChild(card);
    });
}

function formatTime(timeStr) {
    if (!timeStr) return 'N/A';
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    const [hours, minutes] = parts;
    const h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
}

// ====================================================
// VIEW 2: ATTENDANCE MARKING
// ====================================================

function showLectureListView() {
    attendanceView.classList.add('hidden');
    lectureListView.classList.remove('hidden');
    
    stopContinuousScan(); 
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        isCameraOn = false;
        videoFeed.srcObject = null;
    }

    currentLecture = null;
    studentAttendanceList = [];
    scannedFramesCache = []; 
    unknownFacesCount = 0; 
    unknownFacesCountDisplay.textContent = '0';
    
    startScanBtn.textContent = 'Start Continuous Scan';
    startScanBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
    startScanBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
    scanStatus.textContent = 'Status: Idle';
    
    // Clear canvas
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    loadLectures();
}

async function showAttendanceView() {
    lectureListView.classList.add('hidden');
    attendanceView.classList.remove('hidden');

    videoFeed.srcObject = null;
    videoErrorMsg.classList.add('hidden');
    isCameraOn = false;
    scannedFramesCache = [];
    unknownFacesCount = 0; 
    unknownFacesCountDisplay.textContent = '0';
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); // Clear canvas

    const groups = currentLecture.schedule_groups.map(sg => sg.student_groups.group_name).join(', ');
    const title = currentLecture.is_extra_class ? `Extra Class: ${currentLecture.courses.name}` : currentLecture.courses.name;
    const subtitle = currentLecture.is_extra_class ? `Groups: ${groups}` : `${formatTime(currentLecture.start_time)} | Groups: ${groups}`;
    attendanceViewTitle.textContent = title;
    attendanceViewSubtitle.textContent = subtitle;

    const groupIds = currentLecture.schedule_groups.map(sg => sg.student_groups.id);
    const { data: studentsData, error } = await db.from('students')
        .select(`
            id, name, roll_number, photo_url,
            student_group_members!inner (group_id)
        `)
        .in('student_group_members.group_id', groupIds);
    if (error) { showNotification("Error fetching student list.", "error"); return; }
    
    const uniqueStudents = Array.from(new Map(studentsData.map(s => [s.id, s])).values());
    
    if (currentLecture.isSubmitted) {
        // ... (This section is unchanged, it correctly loads old data)
        const todayStr = new Date().toISOString().split('T')[0];
        const { data: existingAttendance } = await db.from('attendance')
            .select('student_id, status, image_proof_url')
            .eq('schedule_id', currentLecture.id)
            .eq('date', todayStr);
        
        // We will *not* show the old proof image, as it's confusing with the live feed.
        // The user can start a new scan.

        const statusMap = new Map(existingAttendance.map(a => [a.student_id, a.status]));
        studentAttendanceList = uniqueStudents.map(student => ({
            student: student,
            status: statusMap.get(student.id) || 'absent'
        })).sort((a, b) => a.student.name.localeCompare(b.student.name));
        submitAttendanceBtn.textContent = 'Update Attendance';
    } else {
        studentAttendanceList = uniqueStudents.map(student => ({
            student: student,
            status: 'absent'
        })).sort((a, b) => a.student.name.localeCompare(b.student.name));
        submitAttendanceBtn.textContent = 'Submit Attendance';
    }

    updateStudentListUI();
    submitAttendanceBtn.disabled = false;
}

function updateStudentListUI() {
    studentListContainer.innerHTML = '';
    if (studentAttendanceList.length === 0) {
        studentListContainer.innerHTML = '<p class="text-gray-500 text-center">No students found for these groups.</p>';
        return;
    }
    studentAttendanceList.forEach((item, index) => {
        const student = item.student;
        const status = item.status;
        const el = document.createElement('div');
        el.className = 'flex items-center justify-between p-3 bg-white rounded-lg shadow-sm';
        el.id = `student-row-${student.id}`; 
        el.innerHTML = `
            <div class="flex items-center space-x-3">
                ${student.photo_url ? `<img src="${student.photo_url}" class="w-10 h-10 rounded-full object-cover">` : `<div class="w-10 h-10 photo-placeholder rounded-full flex items-center justify-center text-white font-semibold text-sm">${getInitials(student.name)}</div>`}
                <div class="pr-10">
                    <div class="font-medium text-gray-900">${student.name}</div>
                    <div class="text-sm text-gray-500">Roll: ${student.roll_number || 'N/A'}</div>
                </div>
            </div>
            <div class="flex space-x-1">
                <button data-index="${index}" data-status="present" class="attd-btn ${status === 'present' ? 'attd-btn-present active' : 'attd-btn-inactive'}">P</button>
                <button data-index="${index}" data-status="late" class="attd-btn ${status === 'late' ? 'attd-btn-late active' : 'attd-btn-inactive'}">L</button>
                <button data-index="${index}" data-status="absent" class="attd-btn ${status === 'absent' ? 'attd-btn-absent active' : 'attd-btn-inactive'}">A</button>
            </div>
        `;
        el.querySelectorAll('.attd-btn').forEach(btn => {
            btn.addEventListener('click', handleManualStatusChange);
        });
        studentListContainer.appendChild(el);
    });
}

function handleManualStatusChange(event) {
    const clickedButton = event.currentTarget;
    const { index, status: newStatus } = clickedButton.dataset;
    studentAttendanceList[index].status = newStatus;
    updateStudentRowUI(clickedButton.closest('.flex.items-center.justify-between'), newStatus);
}

function updateStudentRowUI(rowElement, newStatus) {
    if (!rowElement) return;
    const buttons = rowElement.querySelectorAll('.attd-btn');
    buttons.forEach(btn => {
        const btnStatus = btn.dataset.status;
        btn.classList.remove('active', 'attd-btn-present', 'attd-btn-late', 'attd-btn-absent', 'attd-btn-inactive');
        if (btnStatus === newStatus) {
            btn.classList.add('active', `attd-btn-${btnStatus}`);
        } else {
            btn.classList.add('attd-btn-inactive');
        }
    });
}

// ====================================================
// REAL-TIME SCANNING (WEBSOCKET) - (ALL NEW LOGIC)
// ====================================================

/**
 * Main toggle function
 */
async function toggleContinuousScan() {
    if (isScanning) {
        stopContinuousScan();
    } else {
        try {
            scanStatus.textContent = "Status: Starting camera...";
            await startCamera(); // Wait for camera to be ready
            startWebSocketStream(); // Start WebSocket
            startDrawingLoop(); // Start the 30 FPS drawing loop
        } catch (err) {
            console.error("Camera failed to start:", err);
            showNotification(err.message, "error");
            scanStatus.textContent = "Status: Camera error";
        }
    }
}

/**
 * Starts the camera and points it to the <video> element
 */
async function startCamera() {
    if (isCameraOn) return Promise.resolve();

    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: { ideal: 'environment' } } 
        });
    } catch (err) {
        // Fallback to any camera
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (err2) {
            videoErrorMsg.textContent = 'Camera access denied. Please allow permissions.';
            videoErrorMsg.classList.remove('hidden');
            throw new Error('Camera access denied.');
        }
    }
    
    videoFeed.srcObject = stream;
    
    return new Promise((resolve, reject) => {
        // When the video has loaded its metadata, we know its dimensions
        videoFeed.onloadedmetadata = () => {
            videoFeed.play().then(() => {
                isCameraOn = true;
                videoErrorMsg.classList.add('hidden');
                
                // Set canvas size to match video *intrinsic* size
                overlayCanvas.width = videoFeed.videoWidth;
                overlayCanvas.height = videoFeed.videoHeight;
                
                console.log("Camera is on and ready.");
                resolve();
            }).catch(err => {
                 console.error("video.play() failed:", err);
                 reject(err);
            });
        };
        videoFeed.onerror = (e) => {
            console.error("video.onerror:", e);
            reject(new Error("Video feed error."));
        };
    });
}

/**
 * Connects to WebSocket and starts the 1 FPS *scanning* loop
 */
function startWebSocketStream() {
    if (socket || isScanning) return; 

    const groupIds = currentLecture.schedule_groups.map(sg => sg.student_groups.id);
    if (groupIds.length === 0) {
        showNotification("No groups associated with this lecture.", "error"); return;
    }

    socket = new WebSocket(`${FACE_API_WS_URL}/ws/start_attendance`);
    scanStatus.textContent = "Status: Connecting...";

    socket.onopen = () => {
        console.log("WebSocket connected. Sending config...");
        socket.send(JSON.stringify({ group_ids: groupIds }));
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch (data.type) {
            case 'status':
                if (data.message === 'ready') {
                    console.log("Backend is ready. Starting frame loop.");
                    scanStatus.textContent = "Status: Scanning... (1 FPS)";
                    // Start the 1 FPS loop to SEND frames
                    scanLoopId = setInterval(sendFrameOverWS, FRAME_INTERVAL);
                    isScanning = true;
                    startScanBtn.textContent = 'Stop Continuous Scan';
                    startScanBtn.classList.add('bg-red-600', 'hover:bg-red-700');
                    startScanBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
                }
                break;
            
            case 'frame_data':
                // This is the JSON from Python with box data
                // We just store it. The separate drawing loop will handle it.
                lastBoxes = data.boxes || [];
                break;

            case 'match':
                markStudentPresent(data.student.id);
                break;

            case 'unknown_update':
                unknownFacesCount = data.count;
                unknownFacesCountDisplay.textContent = unknownFacesCount;
                break;
            
            case 'error':
                showNotification(`Stream Error: ${data.message}`, 'error');
                stopContinuousScan();
                break;
        }
    };

    // socket.onerror = (error) => {
    //     console.error("WebSocket Error:", error);
    //     showNotification('Connection to scan server failed.', 'error');
    //     scanStatus.textContent = 'Status: Error';
    // };
    socket.onclose = () => {
        console.log("WebSocket disconnected.");
        stopContinuousScan(); 
    };
}

/**
 * Grabs a frame from the <video> and sends it to Python
 * (Runs on the 1 FPS timer)
 */
function sendFrameOverWS() {
    if (!socket || socket.readyState !== WebSocket.OPEN || !isCameraOn || !videoFeed.videoWidth) {
        return; 
    }
    
    // Use the in-memory canvas to grab the frame
    captureCanvas.width = videoFeed.videoWidth;
    captureCanvas.height = videoFeed.videoHeight;
    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(videoFeed, 0, 0, captureCanvas.width, captureCanvas.height);
    
    const base64Frame = captureCanvas.toDataURL('image/jpeg', 0.7);
    socket.send(base64Frame);
    
    // Store this frame for submission proof
    // Let's only save one proof image every 5 seconds
    if (scannedFramesCache.length < 20 && (Date.now() % 5000 < FRAME_INTERVAL)) { // Max 20 proofs
        scannedFramesCache.push(base64Frame);
    }
}

/**
 * Updates the student list when a match is found
 */
function markStudentPresent(studentId) {
    const item = studentAttendanceList.find(i => i.student.id === studentId);
    if (item && item.status === 'absent') {
        item.status = 'present';
        const rowElement = document.getElementById(`student-row-${studentId}`);
        updateStudentRowUI(rowElement, 'present');
        showNotification(`${item.student.name} marked as present.`, 'success');
    }
}

/**
 * Stops all scanning loops and clears the canvas
 */
function stopContinuousScan() {
    // Stop the 1 FPS scanning loop
    if (scanLoopId) {
        clearInterval(scanLoopId);
        scanLoopId = null;
    }
    // Stop the 30 FPS drawing loop
    if (drawLoopId) {
        cancelAnimationFrame(drawLoopId);
        drawLoopId = null;
    }
    
    if (socket) {
        socket.close();
        socket = null;
    }

    isScanning = false; // This will stop the draw loop
    
    startScanBtn.textContent = 'Start Continuous Scan';
    startScanBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
    startScanBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
    
    if (scanStatus.textContent !== 'Status: Error') {
        scanStatus.textContent = 'Status: Stopped';
    }
    
    // Clear the canvas
    lastBoxes = [];
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

// ====================================================
// NEW: 30 FPS DRAWING LOOP
// ====================================================

/**
 * Starts the 30 FPS loop that *draws* the boxes
 */
function startDrawingLoop() {
    console.log("Starting 30fps draw loop...");
    isScanning = true; // Set the flag
    
    function drawLoop() {
        if (!isScanning) {
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            return; // Stop the loop
        }

        // Ensure canvas is the right size
        if (overlayCanvas.width !== videoFeed.videoWidth || overlayCanvas.height !== videoFeed.videoHeight) {
             overlayCanvas.width = videoFeed.videoWidth;
             overlayCanvas.height = videoFeed.videoHeight;
        }
        
        // Clear the canvas for this frame
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        // Draw all the boxes we received from Python
        for (const { label, box, color } of lastBoxes) {
            const [x1, y1, x2, y2] = box;
            
            // === THIS IS THE FIX ===
            // No scaling needed! The video and canvas have the same
            // resolution (e.g., 640x480), so coordinates map 1:1.
            const drawX = x1;
            const drawY = y1;
            const drawWidth = x2 - x1;
            const drawHeight = y2 - y1;
            // =======================

            // Draw the box
            overlayCtx.strokeStyle = color;
            overlayCtx.lineWidth = 3;
            overlayCtx.strokeRect(drawX, drawY, drawWidth, drawHeight);
            
            // Draw the label
            overlayCtx.fillStyle = color;
            overlayCtx.font = '18px Arial';
            const textWidth = overlayCtx.measureText(label).width;
            overlayCtx.fillRect(drawX - 1, drawY - 22, textWidth + 10, 22); // Background
            overlayCtx.fillStyle = 'white';
            overlayCtx.fillText(label, drawX + 5, drawY - 5);
        }

        // Request the next frame
        drawLoopId = requestAnimationFrame(drawLoop);
    }
    drawLoop(); // Start the loop
}
// ====================================================
// SUBMISSION & FINALIZATION
// ====================================================

async function submitAttendance() {
    submitAttendanceBtn.disabled = true;
    submitAttendanceBtn.textContent = 'Submitting...';
    if (isScanning) {
        stopContinuousScan();
    }
    const today = new Date().toISOString().split('T')[0];
    
    let proofUrlArray = [];
    if (scannedFramesCache.length > 0) {
        showNotification(`Uploading ${scannedFramesCache.length} proof images...`, 'success');
        try {
            const uploadPromises = scannedFramesCache.map(async (base64Image, index) => {
                const response = await fetch(base64Image);
                const blob = await response.blob();
                const filePath = `public/${collegeId}/${currentLecture.id || 'extra'}-${Date.now()}-${index}.png`;
                
                const { data, error } = await db.storage
                    .from('attendance_proofs')
                    .upload(filePath, blob, { contentType: 'image/png' }); 
                if (error) { console.error("Upload error:", error); return null; }
                return data.path; 
            });
            const paths = await Promise.all(uploadPromises);
            proofUrlArray = paths.filter(path => path !== null);
        } catch (uploadError) {
             console.error("Error processing images for upload:", uploadError);
             showNotification('Error processing images for upload.', 'error');
        }
    }
    
    const finalProofUrlString = proofUrlArray.length > 0 ? JSON.stringify(proofUrlArray) : null;
    const attendanceRecords = studentAttendanceList.map(item => ({
        student_id: item.student.id,
        date: today,
        status: item.status,
        schedule_id: currentLecture.id,
        marked_at: new Date().toISOString(),
        image_proof_url: finalProofUrlString 
    }));

    if (attendanceRecords.length === 0) {
        showNotification('No students to mark.', 'error');
        submitAttendanceBtn.disabled = false; return;
    }

    const { error } = await db.from('attendance').upsert(
        attendanceRecords,
        { onConflict: 'student_id, date, schedule_id' }
    );

    if (error) {
        showNotification(`Error submitting attendance: ${error.message}`, 'error');
    } else {
        showNotification('Attendance submitted successfully!', 'success');
        setTimeout(showLectureListView, 1000);
    }
    submitAttendanceBtn.disabled = false;
}

// ====================================================
// EXTRA CLASS MODAL (Unchanged)
// ====================================================
async function openExtraClassModal() {
    extraClassModal.classList.remove('hidden');
    const { data: courses, error: courseError } = await db.from('courses')
        .select('id, name, course_code').eq('college_id', collegeId).order('name');
    if (courseError) { console.error(courseError); return; }
    extraCourseSelect.innerHTML = '<option value="">Select a Course</option>' + courses.map(c => `<option value="${c.id}">${c.name} (${c.course_code || ''})</option>`).join('');

    const { data: groups, error: groupError } = await db.from('student_groups')
        .select('id, group_name').eq('college_id', collegeId).order('group_name');
    if (groupError) { console.error(groupError); return; }
    extraGroupsSelect.innerHTML = groups.map(g => `<option value="${g.id}">${g.group_name}</option>`).join('');
}

async function startExtraClass(event) {
    event.preventDefault();
    const courseId = extraCourseSelect.value;
    const selectedGroupOptions = Array.from(extraGroupsSelect.selectedOptions);
    const groupIds = selectedGroupOptions.map(option => option.value);
    if (!courseId || groupIds.length === 0) {
        showNotification('Please select a course and at least one group.', 'error');
        return;
    }
    const { data: courseData } = await db.from('courses').select('id, name, course_code').eq('id', courseId).single();
    const { data: groupData } = await db.from('student_groups').select('id, group_name').in('id', groupIds);
    
    currentLecture = {
        id: null, is_extra_class: true, isSubmitted: false,
        courses: courseData,
        schedule_groups: groupData.map(g => ({ student_groups: g })),
        college_id: collegeId, course_id: courseId, teacher_profile_id: teacherProfile.id,
        day_of_week: new Date().getDay(),
        start_time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    };

    const { data: newSchedule, error } = await db.from('schedules').insert({
        college_id: collegeId, course_id: courseId, teacher_profile_id: teacherProfile.id,
        day_of_week: currentLecture.day_of_week, start_time: currentLecture.start_time,
        end_time: currentLecture.start_time, is_extra_class: true
    }).select('id').single();
    if (error) { showNotification('Could not create extra class session.', 'error'); return; }

    const scheduleGroupLinks = groupIds.map(gid => ({ schedule_id: newSchedule.id, group_id: gid }));
    const { error: linkError } = await db.from('schedule_groups').insert(scheduleGroupLinks);
    if (linkError) { showNotification('Could not link groups to extra class.', 'error'); return; }

    currentLecture.id = newSchedule.id;
    extraClassModal.classList.add('hidden');
    showAttendanceView();
}

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
