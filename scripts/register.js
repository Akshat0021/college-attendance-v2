// sih_25012-main (1)/scripts/register.js

// ====================================================
// SUPABASE CONFIGURATION
// ====================================================
// IMPORTANT: Replace with your actual Supabase credentials
const SUPABASE_URL = 'https://zlkleprvhjgjcjycezpu.supabase.co'; // Replace with your new project URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpsa2xlcHJ2aGpnamNqeWNlenB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxNzAyNDcsImV4cCI6MjA3Nzc0NjI0N30.e1LkaKKXfDUOHOh1Oi6GY1lwpd5DZ5R-FkSP62XXGD0'; // Replace with your new project anon key
const FACE_API_URL = 'http://127.0.0.1:5000'; // Replace with your deployed Python API URL

// ====================================================
// SUPABASE CONFIGURATION
// ====================================================

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====================================================
// DOM ELEMENTS
// ====================================================
const form = document.getElementById('registerForm');
const submitBtn = document.getElementById('submitBtn');
const submitText = document.getElementById('submitText');
const loadingIcon = document.getElementById('loadingIcon');
const togglePassword = document.getElementById('togglePassword');

const inputs = {
  collegeName: document.getElementById('collegeName'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  confirmPassword: document.getElementById('confirmPassword')
};

// ====================================================
// UTILITY FUNCTIONS
// ====================================================

function showNotification(message, type = 'success') {
  const container = document.getElementById('notification-container');
  if (!container) return;

  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  container.appendChild(notification);
  
  setTimeout(() => notification.classList.add('show'), 100);
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

// ====================================================
// FORM VALIDATION & UI FEEDBACK
// ====================================================
function updatePasswordStrength(password) {
  let strength = 0;
  if (password.length >= 8) strength++;
  if (/[a-z]/.test(password)) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  
  const indicators = ['strength-1', 'strength-2', 'strength-3', 'strength-4'];
  const colors = ['bg-red-400', 'bg-yellow-400', 'bg-blue-400', 'bg-green-400'];
  const labels = ['Weak', 'Fair', 'Good', 'Strong'];

  indicators.forEach((id, index) => {
    const element = document.getElementById(id);
    element.className = 'flex-1 strength-bar bg-gray-200'; // Reset classes
    if (strength > 0 && index < strength) {
      element.classList.add(colors[strength - 1]);
    }
  });
  
  let label = 'Password strength';
  if (password) {
      label = strength > 0 ? labels[strength - 1] : 'Very Weak';
  }
  document.getElementById('password-feedback').textContent = label;
}

function validateField(field) {
    const input = inputs[field];
    const feedback = document.getElementById(`${field}-feedback`);
    let isValid = true;
    let message = '';

    const value = input.value.trim();

    switch (field) {
        case 'collegeName':
            isValid = value.length >= 3;
            message = isValid ? '✓ Looks good!' : '✗ College name must be at least 3 characters.';
            break;
        case 'email':
            isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
            message = isValid ? '✓ Valid email format.' : '✗ Please enter a valid email address.';
            break;
        case 'password':
            isValid = value.length >= 8;
            message = isValid ? '✓ Meets length requirement.' : '✗ Password must be at least 8 characters.';
            updatePasswordStrength(value);
            if(inputs.confirmPassword.value) validateField('confirmPassword');
            break;
        case 'confirmPassword':
            isValid = value === inputs.password.value && value.length > 0;
            message = isValid ? '✓ Passwords match!' : '✗ Passwords do not match.';
            break;
    }

    input.classList.toggle('input-valid', isValid);
    input.classList.toggle('input-invalid', !isValid);
    
    feedback.textContent = message;
    feedback.className = `text-xs mt-1 ${isValid ? 'text-green-600' : 'text-red-600'}`;
    feedback.classList.remove('hidden');
    
    return isValid;
}

// ====================================================
// EVENT LISTENERS
// ====================================================

Object.keys(inputs).forEach(field => {
  inputs[field].addEventListener('input', () => validateField(field));
});

// Toggle password visibility
togglePassword.addEventListener('click', () => {
  const isPassword = inputs.password.type === 'password';
  inputs.password.type = isPassword ? 'text' : 'password';

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

// Form submission handler
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const isFormValid = Object.keys(inputs).every(validateField);
  
  if (!document.getElementById('terms').checked) {
    showNotification('You must agree to the terms of service.', 'error');
    return;
  }
  
  if (!isFormValid) {
    showNotification('Please fix the errors in the form.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitText.textContent = 'Creating Account...';
  loadingIcon.classList.remove('hidden');
  
  const userEmail = inputs.email.value;
  const userPassword = inputs.password.value;
  const collegeName = inputs.collegeName.value;

  try {
    // 1. Create the user in auth.users
    const { data: authData, error: authError } = await db.auth.signUp({
      email: userEmail,
      password: userPassword,
      // We no longer pass metadata, as the trigger is gone
    });

    if (authError) {
        // Handle case where user already exists
        if (authError.message.includes("User already registered")) {
            showNotification('This email is already registered. Please log in.', 'error');
        } else {
            throw authError; // Throw other errors (like 422)
        }
        // Return here if user already registered
        return; 
    }

    // **** THIS IS THE FIX ****
    // If email confirmation is ON, authData.user is null.
    // We get the new user's ID from authData.id instead.
    const userId = authData.user?.id || authData.id;

    if (!userId) {
        // This is the error you were seeing
        throw new Error("Could not create user account. No user ID returned.");
    }
    // **** END OF FIX ****

    // 2. Manually create the college
    const { data: collegeData, error: collegeError } = await db.from('colleges')
      .insert({ name: collegeName })
      .select('id')
      .single();

    if (collegeError) throw collegeError;

    // 3. Manually create the profile, linking user and college
    const { error: profileError } = await db.from('profiles').insert({
      id: userId, // Use the new, safe userId variable
      college_id: collegeData.id,
      full_name: collegeName,
      email: userEmail, // Use the email from the form, since user object is null
      role: 'admin'
    });

    if (profileError) throw profileError;

    // Success!
    showNotification('Registration successful! Please check your email to verify your account. Redirecting...', 'success');
    setTimeout(() => {
      window.location.href = '/login.html'; 
    }, 4000);

  } catch (error) {
    console.error('Registration Error:', error);
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitText.textContent = 'Create Account';
    loadingIcon.classList.add('hidden');
  }
});

