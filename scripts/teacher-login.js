// ====================================================
// SUPABASE CONFIGURATION
// ====================================================
const SUPABASE_URL = 'https://zlkleprvhjgjcjycezpu.supabase.co'; // Replace with your new project URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsa2xlcHJ2aGpnamNqeWNlenB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxNzAyNDcsImV4cCI6MjA3Nzc0NjI0N30.e1LkaKKXfDUOHOh1Oi6GY1lwpd5DZ5R-FkSP62XXGD0'; // Replace with your new project anon key
const FACE_API_URL = 'http://127.0.0.1:5000'; // Replace with your deployed Python API URL

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====================================================
// LOGIN LOGIC FOR TEACHER PORTAL
// ====================================================
const loginForm = document.getElementById('teacherLoginForm');
const submitButton = document.getElementById('submitBtn');
const errorDiv = document.getElementById('error-message');

if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault(); 

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        if (!email || !password) {
            errorDiv.textContent = 'Please enter both email and password.';
            errorDiv.classList.remove('hidden');
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Signing In...';
        errorDiv.classList.add('hidden');

        try {
            // Sign in with Supabase
            const { data, error } = await db.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) {
                throw error;
            }

            // If login is successful, redirect to the new TEACHER DASHBOARD
            window.location.href = '/teacher-dashboard.html';

        } catch (error) {
            console.error('Login Error:', error);
            errorDiv.textContent = `Error: ${error.message}`;
            errorDiv.classList.remove('hidden');

            submitButton.disabled = false;
            submitButton.textContent = 'Sign in';
        }
    });
}
