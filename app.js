const toast = document.querySelector('#toast');
let toastTimer;
let csrfToken = null;
let currentSession = null;

function notify(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

async function readJson(response) {
  if (response.status === 204) return {};
  return response.json();
}

const csrfReady = fetch('/api/v1/csrf', { credentials: 'same-origin' })
  .then(readJson)
  .then(payload => { csrfToken = payload.data?.token; });

async function api(path, options = {}) {
  await csrfReady;
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['x-csrf-token'] = csrfToken || '';
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...options, method, headers });
  const payload = await readJson(response);
  if (response.status === 401) {
    window.location.replace('/login.html');
    throw new Error('Your session has expired. Sign in again.');
  }
  if (!response.ok) throw new Error(payload.error?.message || `Request failed (${response.status}).`);
  return payload.data;
}

function localIsoDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setValue(name, value) {
  const field = document.querySelector(`#settingsForm [name="${name}"]`);
  if (field && value !== undefined && value !== null) field.value = value;
}

function applySchoolSession(session) {
  currentSession = session;
  document.querySelectorAll('.school-switch b').forEach(node => { node.textContent = session.school.name; });
  document.querySelectorAll('.user-profile b').forEach(node => { node.textContent = session.user.name; });
  document.querySelectorAll('.user-profile small').forEach(node => { node.textContent = session.role.replaceAll('_', ' '); });
  document.querySelectorAll('.breadcrumb').forEach(node => {
    const firstText = [...node.childNodes].find(child => child.nodeType === Node.TEXT_NODE);
    if (firstText) firstText.textContent = ` ${session.school.name} `;
  });
  document.querySelectorAll('.page-footer span:last-child').forEach(node => {
    node.textContent = `${session.school.name.toUpperCase()} · SCHOOL OFFICE`;
  });
  document.querySelectorAll('.nav-count').forEach(node => { node.textContent = ''; });
  const canAdmin = ['owner', 'admin'].includes(session.role);
  document.querySelectorAll('#settingsForm input, #settingsForm select, #settingsForm button').forEach(control => { control.disabled = !canAdmin; });
  document.querySelectorAll('.class-grid').forEach(grid => {
    const add = grid.closest('main')?.querySelector('[data-toast="Class creation form is ready to connect."]');
    if (add) add.hidden = !canAdmin;
  });
  document.querySelectorAll('.event-list').forEach(list => { const add = list.querySelector('.calendar-add'); if (add) add.hidden = !canAdmin; });
  const profile = document.querySelector('.user-profile');
  if (profile && !document.querySelector('#logoutButton')) {
    const logout = element('button', 'more-button', '↪');
    logout.id = 'logoutButton';
    logout.type = 'button';
    logout.setAttribute('aria-label', 'Sign out');
    profile.append(logout);
    logout.addEventListener('click', async () => {
      try { await api('/session', { method: 'DELETE' }); window.location.replace('/login.html'); }
      catch (error) { notify(error.message); }
    });
  }
  if (profile && !document.querySelector('#changePasswordButton')) {
    const changePassword = element('button', 'text-link account-password-button', 'Change password');
    changePassword.id = 'changePasswordButton';
    changePassword.type = 'button';
    profile.append(changePassword);
    changePassword.addEventListener('click', () => openFormDialog('Change your password', [
      { name: 'currentPassword', label: 'Current password', type: 'password', autocomplete: 'current-password' },
      { name: 'newPassword', label: 'New password · 15 characters minimum', type: 'password', autocomplete: 'new-password', minLength: 15 },
    ], async values => {
      const result = await api('/password', { method: 'PUT', body: JSON.stringify(values) });
      csrfToken = result.csrfToken;
      notify('Password changed. Other sessions were signed out.');
    }));
  }
}

async function initialize() {
  try {
    await csrfReady;
    const session = await api('/session');
    applySchoolSession(session);
    return true;
  } catch (error) {
    if (window.location.pathname !== '/login.html') window.location.replace('/login.html');
    return false;
  }
}

const searchInput = document.querySelector('#studentSearch');
const studentBody = document.querySelector('#studentRows');
const rowCount = document.querySelector('#rowCount');
const emptyState = document.querySelector('#emptyState');
const filterButton = document.querySelector('#filterButton');
const years = ['ALL YEARS', ...Array.from({ length: 12 }, (_, i) => `YEAR ${i + 1}`)];
let yearIndex = 0;
let studentOffset = 0;
let studentTotal = 0;
let searchTimer;

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
  const footer = document.querySelector('.table-footer span:first-child');
  if (footer) footer.textContent = `SHOWING ${String(visible).padStart(2, '0')} OF ${rows.length} STUDENTS`;
}

function studentRow(student) {
  const row = document.createElement('tr');
  row.dataset.year = student.year;
  row.dataset.studentId = student.id;
  const personCell = element('td');
  const person = element('div', 'student-person');
  const avatar = element('div', 'avatar avatar-orange', student.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase());
  const names = element('span');
  names.append(element('b', '', student.name), element('small', '', student.studentNumber));
  person.append(avatar, names);
  personCell.append(person);
  const classCell = element('td', '', `${student.year} `);
  classCell.append(element('span', 'class-tag', student.class || '—'));
  const score = element('td');
  score.append(element('span', 'attendance-score', '—'));
  const track = element('span', 'score-track'); track.append(element('i'));
  score.append(track);
  const status = element('td'); status.append(element('span', 'status-pill status-present', 'ENROLLED'));
  const actions = element('td');
  const more = element('button', 'row-more', '···'); more.type = 'button'; more.setAttribute('aria-label', `Actions for ${student.name}`);
  actions.append(more);
  row.append(personCell, classCell, score, status, actions);
  return row;
}

async function loadStudents(offset = studentOffset) {
  if (!studentBody) return;
  studentOffset = offset;
  studentBody.replaceChildren();
  filterStudents();
  const params = new URLSearchParams({ limit: '100', offset: String(offset) });
  const query = searchInput?.value.trim();
  if (query) params.set('q', query);
  if (yearIndex) params.set('year', years[yearIndex].replace('YEAR', 'Year'));
  const result = await api(`/students?${params}`);
  studentTotal = result.count;
  studentBody.replaceChildren(...result.data.map(studentRow));
  filterStudents();
  const footer = document.querySelector('.table-footer span:first-child');
  if (footer) footer.textContent = `SHOWING ${result.data.length ? offset + 1 : 0}–${offset + result.data.length} OF ${studentTotal} STUDENTS`;
  let pager = document.querySelector('#studentPagination');
  if (!pager) {
    pager = element('div', 'student-pagination'); pager.id = 'studentPagination';
    document.querySelector('.table-footer')?.append(pager);
  }
  pager.replaceChildren();
  if (studentTotal > 100) {
    const previous = element('button', '', 'PREVIOUS'); previous.type = 'button'; previous.disabled = offset === 0; previous.addEventListener('click', () => loadStudents(Math.max(0, offset - 100)).catch(error => notify(error.message)));
    const next = element('button', '', 'NEXT'); next.type = 'button'; next.disabled = offset + 100 >= studentTotal; next.addEventListener('click', () => loadStudents(offset + 100).catch(error => notify(error.message)));
    pager.append(previous, next);
  }
}

searchInput?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadStudents(0).catch(error => notify(error.message)), 250);
});
filterButton?.addEventListener('click', () => {
  yearIndex = (yearIndex + 1) % years.length;
  filterButton.firstChild.textContent = `${years[yearIndex]} `;
  loadStudents(0).catch(error => notify(error.message));
});

const studentDialog = document.querySelector('#studentDialog');
document.querySelector('#addStudentButton')?.addEventListener('click', () => studentDialog?.showModal());
document.querySelector('#studentForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const name = String(values.name || '').trim();
  const year = String(values.year || 'Year 1');
  const className = String(values.class || '').trim().toUpperCase();
  try {
    const classes = await api('/classes');
    const group = classes.find(item => item.name === className && item.yearGroup === Number(year.slice(5)));
    if (!group) throw new Error('Create this class under Classes before enrolling the student.');
    const saved = await api('/students', { method: 'POST', body: JSON.stringify({ name, year, classGroupId: group.id }) });
    await loadStudents(0);
    form.reset(); studentDialog?.close(); filterStudents();
    notify(`${saved.name} was saved.`);
  } catch (error) { notify(error.message); }
});

document.querySelectorAll('.task-item').forEach(item => item.addEventListener('click', () => {
  item.classList.toggle('is-done');
  item.setAttribute('aria-pressed', String(item.classList.contains('is-done')));
}));

function localStatusButton(status) {
  const button = element('button', `status-pill status-toggle ${status === 'LATE' ? 'status-late' : 'status-present'}`);
  button.type = 'button';
  button.append(element('i'));
  button.append(document.createTextNode(status));
  button.addEventListener('click', () => {
    const next = button.classList.contains('status-late') ? 'PRESENT' : 'LATE';
    button.classList.toggle('status-late', next === 'LATE');
    button.classList.toggle('status-present', next === 'PRESENT');
    button.replaceChildren(element('i'), document.createTextNode(next));
  });
  return button;
}

const attendanceSection = document.querySelector('.attendance-register');
async function setupAttendance() {
  if (!attendanceSection) return;
  const toolbar = attendanceSection.querySelector('.page-toolbar');
  const saveButton = toolbar?.querySelector('.add-button');
  const tableBody = attendanceSection.querySelector('tbody');
  if (!toolbar || !saveButton || !tableBody) return;
  tableBody.replaceChildren();
  const controls = element('div', 'attendance-controls');
  const classSelect = element('select', 'attendance-class-select'); classSelect.setAttribute('aria-label', 'Choose class');
  const dateInput = element('input', 'attendance-date-input'); dateInput.type = 'date'; dateInput.value = localIsoDate(); dateInput.setAttribute('aria-label', 'Register date');
  controls.append(classSelect, dateInput);
  toolbar.querySelector('.toolbar-summary')?.after(controls);
  const classes = await api('/classes');
  classSelect.append(...classes.map(group => {
    const option = element('option', '', `${group.name} · Year ${group.yearGroup}`); option.value = group.id; return option;
  }));
  const loadRegister = async () => {
    if (!classSelect.value) { tableBody.replaceChildren(); return; }
    const [roster, records] = await Promise.all([
      api(`/classes/${classSelect.value}/roster`),
      api(`/attendance?date=${encodeURIComponent(dateInput.value)}`),
    ]);
    const saved = new Map(records.map(record => [record.studentId, record.status]));
    tableBody.replaceChildren(...roster.map(student => {
      const row = document.createElement('tr'); row.dataset.studentId = student.id;
      const personCell = element('td'); const person = element('div', 'student-person');
      person.append(element('div', 'avatar avatar-lilac', student.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()));
      const name = element('span'); name.append(element('b', '', student.name), element('small', '', student.studentNumber));
      person.append(name); personCell.append(person);
      const classCell = element('td', '', `${student.year.toUpperCase()} `); classCell.append(element('span', 'class-tag', classes.find(group => group.id === classSelect.value)?.name || ''));
      row.append(personCell, classCell, element('td', '', '—'));
      row.append(element('td')); row.children[3].append(localStatusButton(saved.get(student.id) || 'PRESENT'));
      row.append(element('td', '', ''));
      return row;
    }));
  };
  classSelect.addEventListener('change', () => loadRegister().catch(error => notify(error.message)));
  dateInput.addEventListener('change', () => loadRegister().catch(error => notify(error.message)));
  saveButton.addEventListener('click', async event => {
    event.preventDefault();
    try {
      const records = [...tableBody.querySelectorAll('tr')].map(row => ({
        studentId: row.dataset.studentId,
        status: row.querySelector('.status-toggle').textContent.trim(),
      }));
      await api('/attendance', { method: 'PUT', body: JSON.stringify({ date: dateInput.value, records }) });
      notify('Register saved.');
    } catch (error) { notify(error.message); }
  });
  if (classes.length) await loadRegister();
  else tableBody.replaceChildren();
}

async function setupClasses() {
  const grid = document.querySelector('.class-grid');
  if (!grid) return;
  grid.replaceChildren();
  const classes = await api('/classes');
  grid.replaceChildren();
  const grouped = new Map();
  for (const group of classes) {
    if (!grouped.has(group.yearGroup)) grouped.set(group.yearGroup, []);
    grouped.get(group.yearGroup).push(group);
  }
  for (const [year, groups] of grouped) {
    const card = element('article', `class-card ${year === 1 ? 'class-card-orange' : year === 6 ? 'class-card-dark' : ''}`);
    const top = element('div', 'class-card-top'); top.append(element('span', '', `YEAR ${year}`), element('span', '', `${String(groups.length).padStart(2, '0')} CLASSES`));
    const names = element('strong');
    groups.forEach((group, index) => { if (index) names.append(document.createTextNode(' · ')); names.append(document.createTextNode(group.name)); });
    const foot = element('div', 'class-card-bottom');
    foot.append(element('span', '', `${groups.reduce((sum, group) => sum + group.studentCount, 0)} STUDENTS`), element('span', '', groups.map(group => group.teacherName).filter(Boolean).join(' · ') || 'TEACHER UNASSIGNED'));
    card.append(top, names, foot, element('div', 'class-decoration', String(year).padStart(2, '0')));
    if (['owner', 'admin'].includes(currentSession?.role)) groups.forEach(group => {
      const assign = element('button', 'class-assign-button', `ASSIGN TEACHERS · ${group.name}`);
      assign.type = 'button';
      assign.addEventListener('click', async () => {
        try {
          const [teachers, assigned] = await Promise.all([api('/users?role=teacher'), api(`/classes/${group.id}/teachers`)]);
          if (!teachers.length) { notify('Create teacher accounts with the backend create-user command first.'); return; }
          const fields = openFormDialog(`Teachers · ${group.name}`, [{
            name: 'userIds', label: 'Assigned teachers', type: 'select', multiple: true, required: false,
            options: teachers.map(teacher => ({ value: teacher.id, label: `${teacher.name} · ${teacher.email}` })),
          }], async values => {
            await api(`/classes/${group.id}/teachers`, { method: 'PUT', body: JSON.stringify({ userIds: values.userIds }) });
            await setupClasses(); notify('Teacher assignments saved.');
          }]);
          const selected = new Set(assigned.map(teacher => teacher.id));
          [...fields.userIds.options].forEach(option => { option.selected = selected.has(option.value); });
        } catch (error) { notify(error.message); }
      });
      card.append(assign);
    });
    grid.append(card);
  }
  const total = document.querySelector('.toolbar-summary span:last-child');
  if (total) total.textContent = `${grouped.size} YEAR GROUPS / ${classes.length} CLASSES`;
}

function openFormDialog(title, fields, onSubmit) {
  const dialog = document.createElement('dialog'); dialog.className = 'student-dialog';
  const form = document.createElement('form'); form.method = 'dialog';
  const close = element('button', 'dialog-close', '×'); close.value = 'cancel'; close.setAttribute('aria-label', 'Close');
  form.append(close, element('p', 'eyebrow', 'SCHOOL OFFICE · RECORD ENTRY'));
  const heading = element('h2'); heading.textContent = title;
  form.append(heading);
  const controls = {};
  fields.forEach(field => {
    const label = element('label', '', field.label.toUpperCase());
    const input = element(field.type === 'select' ? 'select' : field.type === 'textarea' ? 'textarea' : 'input');
    input.name = field.name; input.required = field.required !== false;
    if (field.type === 'date') input.type = 'date';
    if (field.type === 'select') {
      input.multiple = Boolean(field.multiple);
      field.options.forEach(option => { const node = element('option', '', option.label); node.value = option.value; input.append(node); });
    }
    if (field.type === 'password') { input.type = 'password'; input.autocomplete = field.autocomplete || 'current-password'; }
    if (field.minLength) input.minLength = field.minLength;
    if (field.maxLength) input.maxLength = field.maxLength;
    label.append(input); form.append(label); controls[field.name] = input;
  });
  const submit = element('button', 'add-button submit-button', 'SAVE'); submit.type = 'submit';
  form.append(submit);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    fields.filter(field => field.multiple).forEach(field => { values[field.name] = [...controls[field.name].selectedOptions].map(option => option.value); });
    try { await onSubmit(values); dialog.close(); dialog.remove(); }
    catch (error) { notify(error.message); }
  });
  dialog.append(form); document.body.append(dialog); dialog.showModal();
  return controls;
}

document.querySelector('.class-grid')?.closest('main')?.querySelector('[data-toast]')?.addEventListener('click', async event => {
  event.preventDefault();
  try {
    const settings = await api('/settings');
    const currentYear = settings.schoolYear || `${new Date().getFullYear()} / ${String(new Date().getFullYear() + 1).slice(-2)}`;
    const fields = openFormDialog('Add a class', [
      { name: 'yearGroup', label: 'Year group', type: 'select', options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Year ${i + 1}` })) },
      { name: 'name', label: 'Class name', maxLength: 24 },
      { name: 'academicYear', label: 'Academic year', required: false, maxLength: 20 },
    ], async values => { await api('/classes', { method: 'POST', body: JSON.stringify({ ...values, yearGroup: Number(values.yearGroup), academicYear: values.academicYear || currentYear }) }); await setupClasses(); notify('Class created.'); });
    fields.academicYear.value = currentYear;
  } catch (error) { notify(error.message); }
});

async function setupCalendar() {
  const list = document.querySelector('.event-list');
  if (!list) return;
  list.querySelectorAll('.event-item').forEach(item => item.remove());
  const today = new Date();
  const from = localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1));
  const to = localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const events = await api(`/events?from=${from}&to=${to}`);
  list.querySelectorAll('.event-item').forEach(item => item.remove());
  const eyebrow = list.querySelector('.eyebrow');
  const addButton = list.querySelector('.calendar-add');
  events.forEach(event => {
    const date = new Date(`${event.date}T00:00:00`);
    const item = element('div', 'event-item');
    const day = element('span', 'event-date'); day.append(element('b', '', String(date.getDate()).padStart(2, '0')), element('small', '', date.toLocaleString(undefined, { month: 'short' }).toUpperCase()));
    const details = element('div'); details.append(element('b', '', event.title), element('small', '', event.description || 'SCHOOL EVENT'));
    item.append(day, details, element('i', 'event-dot'));
    if (addButton) list.insertBefore(item, addButton); else list.append(item);
  });
  if (addButton && addButton.dataset.bound !== 'true') addButton.addEventListener('click', () => openFormDialog('Add a school event', [
    { name: 'title', label: 'Event name', maxLength: 160 },
    { name: 'date', label: 'Date', type: 'date' },
    { name: 'description', label: 'Description', type: 'textarea', required: false, maxLength: 2000 },
  ], async values => { await api('/events', { method: 'POST', body: JSON.stringify(values) }); notify('Event saved.'); await setupCalendar(); }));
  if (addButton) addButton.dataset.bound = 'true';
}

function weekBounds(date = new Date()) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() - day + 1);
  const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
  return { from: localIsoDate(monday), to: localIsoDate(friday), monday };
}

async function updateAttendanceCharts() {
  const containers = [...document.querySelectorAll('.bar-chart')];
  const attendancePage = document.querySelector('.attendance-register');
  const dashboard = document.querySelector('.stats-grid');
  if (!containers.length && !attendancePage && !dashboard) return;
  dashboard?.querySelectorAll('.stat-card strong').forEach(node => { node.textContent = '—'; });
  attendancePage?.querySelectorAll('.attendance-side .stat-card strong').forEach(node => { node.textContent = '—'; });
  containers.forEach(chart => chart.querySelectorAll('.bar-group').forEach(group => {
    group.querySelector('.bar.present')?.style.setProperty('--height', '0%');
    group.querySelector('.bar.absent')?.style.setProperty('--height', '0%');
    const label = group.querySelector('.bar.present span'); if (label) label.textContent = '—';
  }));
  const overview = await api('/overview');
  const cards = [...document.querySelectorAll('.stats-grid .stat-card')];
  if (cards.length >= 4) {
    cards[0].querySelector('strong').textContent = overview.studentCount;
    cards[0].querySelector('.stat-decoration')?.replaceChildren(document.createTextNode(String(overview.studentCount)));
    const attendanceValue = cards[1].querySelector('strong');
    attendanceValue.textContent = overview.attendanceRate === null ? '—' : `${overview.attendanceRate}`;
    if (overview.attendanceRate !== null) attendanceValue.append(element('span', 'stat-percent', '%'));
    cards[2].querySelector('strong').textContent = overview.classCount;
    cards[2].querySelector('.stat-neutral')?.replaceChildren(document.createTextNode(`${new Set((await api('/classes')).map(group => group.yearGroup)).size} year groups`));
    cards[3].querySelector('strong').textContent = String(overview.attentionCount).padStart(2, '0');
    const issueLine = cards[3].querySelector('.stat-light');
    if (issueLine) issueLine.textContent = `${overview.attentionCount} absent today`;
  }
  if (attendancePage) {
    const stats = [...attendancePage.querySelectorAll('.attendance-side .stat-card strong')];
    if (stats[0]) stats[0].textContent = String(overview.presentCount);
    if (stats[1]) stats[1].textContent = String(Math.max(overview.studentCount - overview.presentCount, 0));
    const foot = attendancePage.querySelector('.attendance-side .stat-card .stat-foot');
    if (foot) foot.textContent = `${overview.presentCount} present · ${overview.absentCount} absent`;
  }
  if (!containers.length) return;
  const { from, to, monday } = weekBounds();
  const report = await api(`/reports/attendance?from=${from}&to=${to}`);
  const byDate = new Map();
  report.forEach(row => {
    const total = byDate.get(row.date) || { total: 0, present: 0, late: 0, absent: 0, excused: 0 };
    for (const key of ['total', 'present', 'late', 'absent', 'excused']) total[key] += row[key];
    byDate.set(row.date, total);
  });
  containers.forEach(chart => {
    const groups = [...chart.querySelectorAll('.bar-group')];
    let rateSum = 0; let rateDays = 0;
    groups.forEach((group, index) => {
      const day = new Date(monday); day.setDate(monday.getDate() + index);
      const data = byDate.get(localIsoDate(day));
      const rate = data?.total ? Math.round(100 * (data.present + data.late) / data.total) : 0;
      if (data?.total) { rateSum += rate; rateDays++; }
      const present = group.querySelector('.bar.present');
      const absent = group.querySelector('.bar.absent');
      if (present) { present.style.setProperty('--height', `${rate}%`); const label = present.querySelector('span'); if (label) label.textContent = data?.total ? `${rate}%` : '—'; }
      if (absent) absent.style.setProperty('--height', `${data?.total ? 100 - rate : 0}%`);
    });
  });
  document.querySelectorAll('.chart-summary b').forEach(node => {
    const marked = [...byDate.values()].filter(day => day.total);
    node.textContent = marked.length ? `${Math.round(marked.reduce((sum, day) => sum + 100 * (day.present + day.late) / day.total, 0) / marked.length)}%` : '—';
  });
}

const settingsForm = document.querySelector('#settingsForm');
if (settingsForm) {
  api('/settings').then(values => {
    Object.entries(values).forEach(([name, value]) => setValue(name, value));
  }).catch(error => notify(error.message));
  settingsForm.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(settingsForm).entries())) });
      notify('School settings saved.');
    } catch (error) { notify(error.message); }
  });
}

document.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', async () => {
  try {
    const now = new Date();
    const from = localIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = localIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const rows = await api(`/reports/attendance?from=${from}&to=${to}`);
    const header = ['Date', 'Class', 'Total', 'Present', 'Late', 'Absent', 'Excused'];
    const lines = [header, ...rows.map(row => [row.date, row.class, row.total, row.present, row.late, row.absent, row.excused])];
    const csv = lines.map(line => line.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `attendance-${from}-to-${to}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    notify('Attendance report downloaded.');
  } catch (error) { notify(error.message); }
}));

document.querySelectorAll('[data-toast]:not(.calendar-add):not([data-toast="Class creation form is ready to connect."]):not([data-toast="Register saved for today."])').forEach(button => button.addEventListener('click', () => notify(button.dataset.toast)));
document.querySelector('#menuToggle')?.addEventListener('click', () => document.querySelector('#sidebar')?.classList.toggle('open'));
document.querySelector('#notificationButton')?.addEventListener('click', () => notify('You’re all caught up.'));
document.querySelector('#helpButton')?.addEventListener('click', () => notify('Contact your school administrator for support.'));
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput?.focus(); }
  if (event.key === 'Escape') document.querySelector('#sidebar')?.classList.remove('open');
});

initialize().then(async authenticated => {
  if (!authenticated) return;
  try { await Promise.all([loadStudents(), setupAttendance(), setupClasses(), setupCalendar(), updateAttendanceCharts()]); }
  catch (error) { if (!window.location.pathname.endsWith('login.html')) notify(error.message); }
});

