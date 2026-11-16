const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const API_PREFIX = '/api/v1';

const initialData = {
  students: [], attendance: [], settings: {},
};
let data = initialData;
let writeQueue = Promise.resolve();

async function loadData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    data = { ...initialData, ...parsed };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await persist();
  }
}

function persist() {
  writeQueue = writeQueue.then(async () => {
    const temporary = `${DATA_FILE}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(temporary, DATA_FILE);
  });
  return writeQueue;
}

function send(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': process.env.CORS_ORIGIN || 'http://localhost:5500',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(payload));
}

function error(res, status, message, requestId) {
  send(res, status, { error: { message, requestId } });
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

function validateStudent(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const year = typeof body.year === 'string' ? body.year.trim() : '';
  const schoolClass = typeof body.class === 'string' ? body.class.trim().toUpperCase() : '';
  if (!name || name.length > 120) return 'Name is required and must be at most 120 characters.';
  if (!/^Year [1-6]$/.test(year)) return 'Year must be Year 1 through Year 6.';
  if (!/^[A-Z0-9]{1,8}$/.test(schoolClass)) return 'Class is required and must be 1 to 8 letters or numbers.';
  return null;
}

const server = http.createServer(async (req, res) => {
  const requestId = randomUUID();
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'access-control-allow-origin': process.env.CORS_ORIGIN || 'http://localhost:5500',
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      return res.end();
    }
    if (url.pathname === '/health' && req.method === 'GET') return send(res, 200, { status: 'ok' });
    if (parts[0] !== 'api' || parts[1] !== 'v1') return error(res, 404, 'Route not found.', requestId);
    const resource = parts[2];
    const id = parts[3];

    if (resource === 'students') {
      if (!id && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const year = url.searchParams.get('year');
        const students = data.students.filter(s => (!q || `${s.name} ${s.studentNumber} ${s.class}`.toLowerCase().includes(q)) && (!year || s.year === year));
        return send(res, 200, { data: students, count: students.length });
      }
      if (!id && req.method === 'POST') {
        const body = await readBody(req);
        const invalid = validateStudent(body);
        if (invalid) return error(res, 400, invalid, requestId);
        const student = {
          id: randomUUID(), name: body.name.trim(), year: body.year,
          class: body.class.trim().toUpperCase(), status: 'ENROLLED',
          studentNumber: `STU-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
          createdAt: new Date().toISOString(),
        };
        data.students.push(student);
        await persist();
        return send(res, 201, { data: student });
      }
      const student = data.students.find(s => s.id === id);
      if (!student) return error(res, 404, 'Student not found.', requestId);
      if (req.method === 'GET') return send(res, 200, { data: student });
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        const merged = { ...student, ...body };
        const invalid = validateStudent(merged);
        if (invalid) return error(res, 400, invalid, requestId);
        Object.assign(student, { name: merged.name.trim(), year: merged.year, class: merged.class.trim().toUpperCase(), updatedAt: new Date().toISOString() });
        await persist();
        return send(res, 200, { data: student });
      }
      if (req.method === 'DELETE') {
        data.students = data.students.filter(s => s.id !== id);
        await persist();
        return send(res, 204, {});
      }
    }

    if (resource === 'settings') {
      if (!id && req.method === 'GET') return send(res, 200, { data: data.settings });
      if (!id && req.method === 'PUT') {
        const body = await readBody(req);
        if (!body || Array.isArray(body) || typeof body !== 'object') return error(res, 400, 'Settings must be a JSON object.', requestId);
        data.settings = { ...data.settings, ...body, updatedAt: new Date().toISOString() };
        await persist();
        return send(res, 200, { data: data.settings });
      }
    }

    if (resource === 'attendance') {
      if (!id && req.method === 'GET') {
        const date = url.searchParams.get('date');
        const records = data.attendance.filter(r => !date || r.date === date);
        return send(res, 200, { data: records, count: records.length });
      }
      if (!id && req.method === 'PUT') {
        const body = await readBody(req);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !Array.isArray(body.records)) return error(res, 400, 'Provide a date (YYYY-MM-DD) and records array.', requestId);
        const records = body.records;
        if (records.some(r => !r.studentId || !['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'].includes(r.status))) return error(res, 400, 'Each record needs a studentId and valid status.', requestId);
        data.attendance = data.attendance.filter(r => r.date !== body.date);
        data.attendance.push(...records.map(r => ({ id: randomUUID(), date: body.date, studentId: r.studentId, status: r.status, updatedAt: new Date().toISOString() })));
        await persist();
        return send(res, 200, { data: data.attendance.filter(r => r.date === body.date) });
      }
    }
    return error(res, 404, 'Route not found.', requestId);
  } catch (err) {
    return error(res, err.status || 500, err.status ? err.message : 'Internal server error.', requestId);
  }
});

loadData().then(() => server.listen(PORT, () => {
  console.log(`Fieldnotes API listening at http://localhost:${PORT}`);
})).catch(err => {
  console.error('Could not load API data:', err.message);
  process.exitCode = 1;
});
