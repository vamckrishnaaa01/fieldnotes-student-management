const toast = document.querySelector('#toast');
let toastTimer;

function notify(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

const API_BASE = window.FIELDNOTES_API_URL || 'http://localhost:3000/api/v1';
async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error?.message || `API request failed (${response.status}).`), { status: response.status });
  return payload.data;
}

// Directory search and year filter, shared by the overview and student page.
const searchInput = document.querySelector('#studentSearch');
const studentBody = document.querySelector('#studentRows');
const rowCount = document.querySelector('#rowCount');
const emptyState = document.querySelector('#emptyState');
const filterButton = document.querySelector('#filterButton');
const years = ['ALL YEARS', 'YEAR 1', 'YEAR 2', 'YEAR 3', 'YEAR 4', 'YEAR 5', 'YEAR 6'];
let yearIndex = 0;

function filterStudents() {
  if (!searchInput || !studentBody) return;
  const query = searchInput.value.trim().toLowerCase();
  const rows = [...studentBody.querySelectorAll('tr')];
  let visible = 0;
  rows.forEach(row => {
    const matchesText = row.textContent.toLowerCase().includes(query);
    const matchesYear = yearIndex === 0 || row.dataset.year?.toUpperCase() === years[yearIndex];
    row.hidden = !(matchesText && matchesYear);
    if (!row.hidden) visible++;
  });
  if (rowCount) rowCount.textContent = String(visible).padStart(2, '0');
  if (emptyState) emptyState.hidden = visible > 0;
}

function addStudentRow(student) {
  const name = student.name;
  const year = student.year || 'Year 1';
  const schoolClass = (student.class || '').toUpperCase();
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const row = document.createElement('tr');
  row.dataset.year = year;
  row.dataset.studentId = student.id || student.studentNumber || '';
  row.innerHTML = '<td><div class="student-person"><div class="avatar avatar-orange"></div><span><b></b><small></small></span></div></td><td></td><td><span class="attendance-score">—</span><span class="score-track"><i style="width:0%"></i></span></td><td><span class="status-pill status-present"><i></i> ENROLLED</span></td><td><button class="row-more" aria-label="More options">···</button></td>';
  row.querySelector('.avatar').textContent = initials;
  row.querySelector('.student-person b').textContent = name;
  row.querySelector('.student-person small').textContent = student.studentNumber || '';
  row.children[1].append(document.createTextNode(`${year.toUpperCase()} `));
  const classTag = document.createElement('span');
  classTag.className = 'class-tag';
  classTag.textContent = schoolClass;
  row.children[1].append(classTag);
  studentBody.prepend(row);
  filterStudents();
  return row;
}

// Prefer server records when the API is running; retain the sample directory offline.
if (studentBody) api('/students').then(students => {
  studentBody.replaceChildren();
  students.forEach(addStudentRow);
  filterStudents();
}).catch(() => {});

searchInput?.addEventListener('input', filterStudents);
filterButton?.addEventListener('click', () => {
  yearIndex = (yearIndex + 1) % years.length;
  filterButton.innerHTML = `${years[yearIndex]} <span>⌄</span>`;
  filterStudents();
});

// Save student records through the API; if it is offline, keep the prototype interaction available.
const dialog = document.querySelector('#studentDialog');
document.querySelector('#addStudentButton')?.addEventListener('click', () => dialog?.showModal());
document.querySelector('#studentForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const year = String(data.get('year') || 'Year 1');
  const schoolClass = String(data.get('class') || '').trim().toUpperCase();
  if (!name || !schoolClass || !studentBody) return;
  let savedStudent;
  try {
    savedStudent = await api('/students', { method: 'POST', body: JSON.stringify({ name, year, class: schoolClass }) });
  } catch (error) {
    if (error.status) {
      notify(error.message);
      return;
    }
    savedStudent = { name, year, class: schoolClass, studentNumber: `DEMO-${Date.now()}` };
    notify('API unavailable. Added to this page only.');
  }
  addStudentRow(savedStudent);
  form.reset();
  dialog.close();
  yearIndex = 0;
  if (filterButton) filterButton.innerHTML = `${years[0]} <span>⌄</span>`;
  if (searchInput) searchInput.value = '';
  filterStudents();
  if (savedStudent.id) notify(`${name} saved to the student directory.`);
});

// Mark tasks and attendance records with simple local interactions.
document.querySelectorAll('.task-item').forEach(item => item.addEventListener('click', () => {
  item.classList.toggle('is-done');
  item.setAttribute('aria-pressed', String(item.classList.contains('is-done')));
}));
document.querySelectorAll('.status-toggle').forEach(button => button.addEventListener('click', () => {
  const late = button.classList.contains('status-late');
  button.classList.toggle('status-late', !late);
  button.classList.toggle('status-present', late);
  button.innerHTML = `<i></i> ${late ? 'PRESENT' : 'LATE'}`;
}));

const attendanceSaveButton = document.querySelector('[data-toast="Register saved for today."]');
function localIsoDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
if (attendanceSaveButton) {
  const date = localIsoDate();
  api(`/attendance?date=${date}`).then(records => {
    const byStudent = new Map(records.map(record => [record.studentId, record.status]));
    document.querySelectorAll('.attendance-register tbody tr').forEach(row => {
      const id = row.dataset.studentId || row.querySelector('.student-person small')?.textContent.trim();
      const status = byStudent.get(id);
      const button = row.querySelector('.status-toggle');
      if (!status || !button) return;
      button.classList.toggle('status-late', status === 'LATE');
      button.classList.toggle('status-present', status === 'PRESENT');
      button.innerHTML = `<i></i> ${status}`;
    });
  }).catch(() => {});
}
attendanceSaveButton?.addEventListener('click', async event => {
  event.preventDefault();
  const rows = [...document.querySelectorAll('.attendance-register tbody tr')];
  const records = rows.map(row => ({
    studentId: row.dataset.studentId || row.querySelector('.student-person small')?.textContent.trim(),
    status: row.querySelector('.status-toggle')?.classList.contains('status-late') ? 'LATE' : 'PRESENT',
  })).filter(record => record.studentId);
  try {
    await api('/attendance', { method: 'PUT', body: JSON.stringify({ date: localIsoDate(), records }) });
    notify('Register saved to the school API.');
  } catch {
    notify('API unavailable. Register changes were not saved.');
  }
});
document.querySelectorAll('[data-toast]:not([data-toast="Register saved for today."])').forEach(button => button.addEventListener('click', () => notify(button.dataset.toast)));
studentBody?.addEventListener('click', event => {
  if (event.target.closest('.row-more')) notify('Student profile actions are ready to connect.');
});

// Small report exports are generated locally as CSV files.
document.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', () => {
  const title = button.dataset.download;
  const csv = `Report,School,Academic Year\n"${title}","Northfield Academy","2025 / 26"\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.toLowerCase().replaceAll(' ', '-')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  notify(`${title} CSV downloaded.`);
}));

// Load and save school profile fields through the API, with local preference fallback.
const settingsForm = document.querySelector('#settingsForm');
if (settingsForm) {
  const localSaved = JSON.parse(localStorage.getItem('fieldnotes-school-settings') || 'null');
  let saved = localSaved;
  api('/settings').then(values => {
    if (!values || !Object.keys(values).length) return;
    Object.entries(values).forEach(([name, value]) => {
      const field = settingsForm.elements.namedItem(name);
      if (field) field.value = value;
    });
  }).catch(() => {});
  if (saved) Object.entries(saved).forEach(([name, value]) => {
    const field = settingsForm.elements.namedItem(name);
    if (field) field.value = value;
  });
  settingsForm.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(settingsForm).entries());
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify(values) });
      localStorage.setItem('fieldnotes-school-settings', JSON.stringify(values));
      notify('School profile saved to the school API.');
    } catch {
      localStorage.setItem('fieldnotes-school-settings', JSON.stringify(values));
      notify('API unavailable. Settings saved on this device.');
    }
  });
}

document.querySelector('#menuToggle')?.addEventListener('click', () => document.querySelector('#sidebar')?.classList.toggle('open'));
document.querySelector('#notificationButton')?.addEventListener('click', () => notify('You’re all caught up. Have a good school day.'));
document.querySelector('#helpButton')?.addEventListener('click', () => notify('Help desk: support@fieldnotes.school'));
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (searchInput) {
      searchInput.focus();
      searchInput.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  if (event.key === 'Escape') document.querySelector('#sidebar')?.classList.remove('open');
});
