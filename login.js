const form = document.querySelector('#loginForm');
const errorBox = document.querySelector('#loginError');
const schoolChoice = document.querySelector('#schoolChoice');
const schoolSelect = document.querySelector('#schoolId');
const submitButton = form?.querySelector('[type="submit"]');
let csrfToken = null;

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const payload = response.status === 204 ? {} : await response.json();
  return { response, payload };
}

async function initialize() {
  try {
    const { payload } = await jsonRequest('/api/v1/csrf');
    csrfToken = payload.data?.token;
    const session = await jsonRequest('/api/v1/session');
    if (session.response.ok) window.location.replace('/index.html');
  } catch {
    showError('Sign-in service is unavailable. Try again later.');
  }
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

form?.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.hidden = true;
  submitButton.disabled = true;
  submitButton.textContent = 'SIGNING IN…';
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const { response, payload } = await jsonRequest('/api/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken || '' },
      body: JSON.stringify(body),
    });
    if (response.status === 409 && payload.error?.code === 'school_selection_required') {
      schoolSelect.replaceChildren(...payload.data.schools.map(school => {
        const option = document.createElement('option');
        option.value = school.id;
        option.textContent = school.name;
        return option;
      }));
      schoolChoice.hidden = false;
      submitButton.disabled = false;
      submitButton.innerHTML = 'CONTINUE <span>→</span>';
      schoolSelect.focus();
      return;
    }
    if (!response.ok) {
      showError(payload.error?.message || 'Unable to sign in. Check your details and try again.');
      return;
    }
    csrfToken = payload.data.csrfToken;
    window.location.replace('/index.html');
  } catch {
    showError('Sign-in service is unavailable. Try again later.');
  } finally {
    if (!window.location.pathname.endsWith('/index.html')) {
      submitButton.disabled = false;
      if (submitButton.textContent === 'SIGNING IN…') submitButton.innerHTML = 'SIGN IN <span>→</span>';
    }
  }
});

initialize();

