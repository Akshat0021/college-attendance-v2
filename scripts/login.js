// ====================================================
// SUPABASE CONFIGURATION
// ====================================================
const SUPABASE_URL = 'https://zlkleprvhjgjcjycezpu.supabase.co'; // Replace with your new project URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsa2xlcHJ2aGpnamNqeWNlenB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxNzAyNDcsImV4cCI6MjA3Nzc0NjI0N30.e1LkaKKXfDUOHOh1Oi6GY1lwpd5DZ5R-FkSP62XXGD0'; // Replace with your new project anon key
const FACE_API_URL = ''; // Replace with your deployed Python API URL

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====================================================
// DOM ELEMENTS
// ====================================================
const loginForm = document.getElementById('loginForm');
const submitButton = document.getElementById('submitBtn');
const errorDiv = document.getElementById('error-message');
const successDiv = document.getElementById('success-message');
const togglePassword = document.getElementById('togglePassword');
const passwordInput = document.getElementById('password');

// ====================================================
// EVENT LISTENERS
// ====================================================

// Handle form submission for login
if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');

        const email = emailInput.value;
        const password = passwordInput.value;

        setLoading(true);

        try {
            const { data, error } = await db.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) throw error;

            if (data.user) {
                // Login succeeded, now check the user's role
                await checkUserProfile(data.user);
            } else {
                throw new Error("Login failed. Please check your credentials.");
            }

        } catch (error) {
            console.error('Login Error:', error);
            showError(`Error: ${error.message}`);
            setLoading(false);
        }
    });
}

// Handle password visibility toggle
if (togglePassword) {
    togglePassword.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';

        const eyeIcon = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
        </svg>`;
        const eyeSlashIcon = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"/>
        </svg>`;
        
        togglePassword.innerHTML = isPassword ? eyeSlashIcon : eyeIcon;
    });
}

// ====================================================
// HELPER FUNCTIONS
// ====================================================

/**
 * Checks the user's profile to determine their role and redirect them.
 * @param {object} user - The user object from Supabase auth.
 */
async function checkUserProfile(user) {
    try {
        const { data: profile, error } = await db.from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (error) {
            // This can happen if the RLS policy is wrong or the profile wasn't created
            // This error was the "0 rows" error
            if (error.code === 'PGRST116') {
                throw new Error("Cannot find your profile. Please contact support.");
            }
            throw error;
        }

        if (profile) {
            // Success! Redirect based on role.
            showSuccess('Login successful! Redirecting...');
            if (profile.role === 'admin') {
                window.location.href = '/admin.html';
            } else if (profile.role === 'teacher') {
                window.location.href = '/teacher-dashboard.html';
            } else {
                throw new Error("Unknown user role.");
            }
        } else {
            throw new Error("Your user profile was not found.");
        }

    } catch (error) {
        console.error('Redirection Error:', error);
        showError(`Login Succeeded, but failed to load profile: ${error.message}`);
        setLoading(false);
    }
}


function setLoading(isLoading) {
    if(submitButton) {
        submitButton.disabled = isLoading;
        submitButton.textContent = isLoading ? 'Signing In...' : 'Sign in';
    }
}

function showError(message) {
    if(errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
    }
    if(successDiv) {
        successDiv.classList.add('hidden');
    }
}

function showSuccess(message) {
    if(successDiv) {
        successDiv.textContent = message;
        successDiv.classList.remove('hidden');
    }
    if(errorDiv) {
        errorDiv.classList.add('hidden');
    }
}

