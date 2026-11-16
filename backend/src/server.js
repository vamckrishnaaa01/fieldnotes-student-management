const path = require('node:path');
const crypto = require('node:crypto');
const Fastify = require('fastify');
const cookie = require('@fastify/cookie');
const helmet = require('@fastify/helmet');
const rateLimit = require('@fastify/rate-limit');
const fastifyStatic = require('@fastify/static');
const Redis = require('ioredis');
const argon2 = require('argon2');
const { config, validateConfig } = require('./config');
const { pool, transaction } = require('./database');
const {
  SESSION_COOKIE, CSRF_COOKIE, SAFE_METHODS, hashToken, createCsrfToken,
  requireSameOrigin, hashPassword, verifyPassword,
} = require('./security');

validateConfig();

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  lazyConnect: true,
  connectTimeout: 5_000,
  retryStrategy: attempt => Math.min(attempt * 250, 2_000),
});
const app = Fastify({
  trustProxy: config.trustProxy,
  bodyLimit: 256 * 1024,
  requestTimeout: 30_000,
  connectionTimeout: 10_000,
  keepAliveTimeout: 5_000,
  requestIdHeader: false,
  genReqId: () => crypto.randomUUID(),
  disableRequestLogging: true,
  logger: {
    level: process.env.LOG_LEVEL || (config.production ? 'info' : 'debug'),
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password', 'req.body.passwordConfirmation', 'res.headers.set-cookie'],
      censor: '[REDACTED]',
    },
  },
  schemaErrorFormatter: () => new Error('Request validation failed.'),
});

const htmlPages = new Set(['index.html', 'students.html', 'attendance.html', 'classes.html', 'reports.html', 'calendar.html', 'settings.html']);
const publicAssets = new Set(['styles.css', 'login.js']);
const uuid = { type: 'string', format: 'uuid' };
const noAdditional = { additionalProperties: false };

app.register(cookie);
app.register(helmet, {
  global: true,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(config.production ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  hsts: config.production ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
});
app.register(rateLimit, {
  redis,
  max: 300,
  timeWindow: '1 minute',
  errorResponseBuilder: request => ({ error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.', requestId: request.id } }),
});
app.register(fastifyStatic, {
  root: path.resolve(__dirname, '..', '..'),
  serve: false,
  dotfiles: 'deny',
});

app.addHook('onRequest', async (request, reply) => {
  reply.header('x-request-id', request.id);
  if (request.url.startsWith('/api/v1/') && !SAFE_METHODS.has(request.method) && !requireSameOrigin(request, reply)) return;
});

app.addHook('onResponse', async request => {
  request.log.info({ requestId: request.id, method: request.method, route: request.routeOptions.url || 'unmatched', statusCode: request.raw.res.statusCode, responseTime: request.elapsedTime }, 'request completed');
});

app.setErrorHandler((error, request, reply) => {
  let status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  let code = status < 500 ? 'request_failed' : 'internal_error';
  let message = status < 500 ? (error.validation ? 'Request validation failed.' : error.message) : 'An internal error occurred.';
  if (error.code === '23505') { status = 409; code = 'conflict'; message = 'A record with those details already exists.'; }
  if (error.code === '23503' || error.code === '23514') { status = 422; code = 'invalid_reference'; message = 'The requested record or values are not valid.'; }
  if (status >= 500) request.log.error({ requestId: request.id, code: error.code || 'unknown' }, 'request failed');
  if (!reply.sent) reply.code(status).send({ error: { code, message, requestId: request.id } });
});

async function authenticate(request, reply, page = false) {
  const rawToken = request.cookies[SESSION_COOKIE];
  if (!rawToken) {
    if (page) reply.redirect('/login.html');
    else reply.code(401).send({ error: { code: 'unauthenticated', message: 'Sign in to continue.', requestId: request.id } });
    return;
  }
  const result = await pool.query(
    `SELECT u.id AS user_id, u.email, u.full_name, m.role,
            s.id AS school_id, s.name AS school_name, s.timezone,
            ss.expires_at, ss.last_seen_at
       FROM sessions ss
       JOIN users u ON u.id = ss.user_id AND u.active = true
       JOIN school_memberships m ON m.user_id = u.id AND m.school_id = ss.school_id
       JOIN schools s ON s.id = ss.school_id
      WHERE ss.token_hash = $1 AND ss.expires_at > now()`,
    [hashToken(rawToken)],
  );
  if (!result.rowCount) {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    if (page) reply.redirect('/login.html');
    else reply.code(401).send({ error: { code: 'unauthenticated', message: 'Your session has expired. Sign in again.', requestId: request.id } });
    return;
  }
  request.auth = result.rows[0];
  if (Date.now() - new Date(request.auth.last_seen_at).getTime() > 300_000) {
    await pool.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [hashToken(rawToken)]);
  }
}

async function requirePageAuth(request, reply) {
  return authenticate(request, reply, true);
}

function requireRoles(...roles) {
  return async (request, reply) => {
    await authenticate(request, reply);
    if (reply.sent) return;
    if (!roles.includes(request.auth.role)) {
      reply.code(403).send({ error: { code: 'forbidden', message: 'Your school role cannot perform this action.', requestId: request.id } });
    }
  };
}

function setCsrfCookie(reply, rawSession) {
  const token = createCsrfToken(rawSession);
  reply.setCookie(CSRF_COOKIE, token, {
    path: '/', httpOnly: false, secure: config.production, sameSite: 'strict', maxAge: 60 * 60,
  });
  return token;
}

async function audit(client, request, auth, action, entityType, entityId, details = {}) {
  await client.query(
    `INSERT INTO audit_events (school_id, actor_id, action, entity_type, entity_id, request_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [auth.school_id, auth.user_id, action, entityType, entityId || null, request.id, JSON.stringify(details)],
  );
}

function safeSession(auth) {
  return {
    user: { id: auth.user_id, email: auth.email, name: auth.full_name },
    school: { id: auth.school_id, name: auth.school_name, timezone: auth.timezone },
    role: auth.role,
  };
}

app.get('/health/live', async () => ({ status: 'ok' }));
app.get('/health/ready', async (request, reply) => {
  try {
    await Promise.all([pool.query('SELECT 1'), redis.ping()]);
    return { status: 'ready' };
  } catch {
    reply.code(503);
    return { status: 'unavailable' };
  }
});

app.get('/api/v1/csrf', async (request, reply) => {
  const session = request.cookies[SESSION_COOKIE] || null;
  return { data: { token: setCsrfCookie(reply, session) } };
});

app.post('/api/v1/session', {
  config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  schema: { body: { type: 'object', required: ['email', 'password'], properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', minLength: 1, maxLength: 128 },
    schoolId: uuid,
  }, ...noAdditional } },
}, async (request, reply) => {
  const email = request.body.email.trim().toLowerCase();
  const memberships = await pool.query(
    `SELECT u.id AS user_id, u.email, u.full_name, u.password_hash,
            m.school_id, m.role, s.name AS school_name, s.timezone
       FROM users u
       JOIN school_memberships m ON m.user_id = u.id
       JOIN schools s ON s.id = m.school_id
      WHERE u.email = $1 AND u.active = true
      ORDER BY s.name`, [email],
  );
  const passwordHash = memberships.rows[0]?.password_hash || dummyPasswordHash;
  const passwordMatches = await verifyPassword(passwordHash, request.body.password);
  if (!memberships.rowCount || !passwordMatches) {
    reply.code(401);
    return { error: { code: 'invalid_credentials', message: 'Email or password is incorrect.', requestId: request.id } };
  }
  const matches = request.body.schoolId ? memberships.rows.filter(row => row.school_id === request.body.schoolId) : memberships.rows;
  if (!matches.length) {
    reply.code(403);
    return { error: { code: 'school_access_denied', message: 'This account does not have access to that school.', requestId: request.id } };
  }
  if (!request.body.schoolId && matches.length > 1) {
    reply.code(409);
    return { error: { code: 'school_selection_required', message: 'Choose a school to continue.', requestId: request.id }, data: {
      schools: matches.map(row => ({ id: row.school_id, name: row.school_name })),
    } };
  }
  const account = matches[0];
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const auth = { ...account, timezone: account.timezone };
  await transaction(async client => {
    await client.query('INSERT INTO sessions (token_hash, user_id, school_id, expires_at) VALUES ($1, $2, $3, now() + interval \'8 hours\')', [hashToken(rawToken), account.user_id, account.school_id]);
    await audit(client, request, auth, 'session.created', 'session', null);
  });
  reply.setCookie(SESSION_COOKIE, rawToken, {
    path: '/', httpOnly: true, secure: config.production, sameSite: 'strict', maxAge: config.sessionHours * 60 * 60,
  });
  return { data: { ...safeSession(auth), csrfToken: setCsrfCookie(reply, rawToken) } };
});

app.get('/api/v1/session', { preHandler: authenticate }, async request => ({ data: safeSession(request.auth) }));

app.delete('/api/v1/session', { preHandler: authenticate }, async (request, reply) => {
  const rawToken = request.cookies[SESSION_COOKIE];
  await transaction(async client => {
    await audit(client, request, request.auth, 'session.revoked', 'session', null);
    await client.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(rawToken)]);
  });
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
  return reply.code(204).send();
});

app.put('/api/v1/password', { preHandler: authenticate, schema: { body: { type: 'object', required: ['currentPassword', 'newPassword'], properties: {
  currentPassword: { type: 'string', minLength: 1, maxLength: 128 }, newPassword: { type: 'string', minLength: 15, maxLength: 128 },
}, ...noAdditional } } }, async (request, reply) => {
  const account = await pool.query('SELECT password_hash FROM users WHERE id = $1 AND active = true', [request.auth.user_id]);
  if (!account.rowCount || !await verifyPassword(account.rows[0].password_hash, request.body.currentPassword)) {
    return reply.code(400).send({ error: { code: 'invalid_current_password', message: 'Current password is incorrect.', requestId: request.id } });
  }
  if (request.body.currentPassword === request.body.newPassword) return reply.code(400).send({ error: { code: 'password_unchanged', message: 'Choose a different password.', requestId: request.id } });
  const passwordHash = await hashPassword(request.body.newPassword);
  const rawToken = crypto.randomBytes(32).toString('base64url');
  await transaction(async client => {
    await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [request.auth.user_id, passwordHash]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [request.auth.user_id]);
    await client.query('INSERT INTO sessions (token_hash, user_id, school_id, expires_at) VALUES ($1, $2, $3, now() + interval \'8 hours\')', [hashToken(rawToken), request.auth.user_id, request.auth.school_id]);
    await audit(client, request, request.auth, 'user.password_changed', 'user', request.auth.user_id);
  });
  reply.setCookie(SESSION_COOKIE, rawToken, { path: '/', httpOnly: true, secure: config.production, sameSite: 'strict', maxAge: config.sessionHours * 60 * 60 });
  return { data: { csrfToken: setCsrfCookie(reply, rawToken) } };
});

app.get('/api/v1/users', { preHandler: requireRoles('owner', 'admin'), schema: { querystring: { type: 'object', properties: { role: { type: 'string', enum: ['owner', 'admin', 'teacher', 'attendance_staff', 'viewer'] } }, ...noAdditional } } }, async request => {
  const result = await pool.query(
    `SELECT u.id, u.email, u.full_name AS name, m.role, u.active
       FROM school_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.school_id = $1 AND ($2::text IS NULL OR m.role = $2)
      ORDER BY u.full_name, u.email`, [request.auth.school_id, request.query.role || null],
  );
  return { data: result.rows, count: result.rowCount };
});

app.get('/api/v1/students', { preHandler: authenticate, schema: { querystring: {
  type: 'object', properties: { q: { type: 'string', maxLength: 120 }, year: { type: 'string', pattern: '^Year ([1-9]|1[0-2])$' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }, offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0 } }, ...noAdditional,
} } }, async request => {
  const { q = '', year, limit = 50, offset = 0 } = request.query;
  const result = await pool.query(
    `SELECT st.id, st.student_number AS "studentNumber", st.full_name AS name,
            st.year_group AS "yearGroup", ('Year ' || st.year_group) AS year,
            cg.name AS class, st.status, st.created_at AS "createdAt",
            count(*) OVER()::int AS total
       FROM students st
       LEFT JOIN class_groups cg ON cg.id = st.class_group_id AND cg.school_id = st.school_id
      WHERE st.school_id = $1 AND st.status = 'enrolled'
        AND ($2 = '' OR strpos(lower(st.full_name || ' ' || st.student_number || ' ' || coalesce(cg.name, '')), lower($2)) > 0)
        AND ($3::smallint IS NULL OR st.year_group = $3)
        AND ($6 <> 'teacher' OR EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.school_id = st.school_id AND cm.user_id = $7 AND cm.class_group_id = st.class_group_id))
      ORDER BY st.full_name, st.student_number LIMIT $4 OFFSET $5`,
    [request.auth.school_id, q, year ? Number(year.slice(5)) : null, limit, offset, request.auth.role, request.auth.user_id],
  );
  return { data: result.rows.map(({ total, ...row }) => row), count: result.rows[0]?.total || 0, limit, offset };
});

app.post('/api/v1/students', { preHandler: requireRoles('owner', 'admin', 'teacher'), schema: { body: {
  type: 'object', required: ['name', 'year', 'classGroupId'], properties: {
    name: { type: 'string', minLength: 1, maxLength: 160 }, year: { type: 'string', pattern: '^Year ([1-9]|1[0-2])$' }, classGroupId: uuid,
  }, ...noAdditional,
} } }, async (request, reply) => {
  const id = crypto.randomUUID();
  const yearGroup = Number(request.body.year.slice(5));
  const number = `STU-${yearGroup}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const result = await transaction(async client => {
    const group = await client.query('SELECT id, name, year_group FROM class_groups WHERE school_id = $1 AND id = $2', [request.auth.school_id, request.body.classGroupId]);
    if (!group.rowCount || group.rows[0].year_group !== yearGroup) {
      const error = new Error('Choose a class from the selected year group.'); error.statusCode = 422; throw error;
    }
    if (request.auth.role === 'teacher') {
      const assigned = await client.query('SELECT 1 FROM class_memberships WHERE school_id = $1 AND user_id = $2 AND class_group_id = $3', [request.auth.school_id, request.auth.user_id, group.rows[0].id]);
      if (!assigned.rowCount) { const error = new Error('You can only enroll students in your assigned classes.'); error.statusCode = 403; throw error; }
    }
    const inserted = await client.query(
      `INSERT INTO students (id, school_id, class_group_id, student_number, full_name, year_group)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, student_number AS "studentNumber", full_name AS name, year_group AS "yearGroup", status, created_at AS "createdAt"`,
      [id, request.auth.school_id, group.rows[0].id, number, request.body.name.trim(), yearGroup],
    );
    await client.query('INSERT INTO enrollments (id, school_id, student_id, class_group_id, start_date, created_by) VALUES ($1, $2, $3, $4, (now() AT TIME ZONE $5)::date, $6)', [crypto.randomUUID(), request.auth.school_id, id, group.rows[0].id, request.auth.timezone, request.auth.user_id]);
    await audit(client, request, request.auth, 'student.created', 'student', id);
    return { ...inserted.rows[0], year: `Year ${yearGroup}`, class: group.rows[0].name };
  });
  return reply.code(201).send({ data: result });
});

app.get('/api/v1/students/:id', { preHandler: authenticate, schema: { params: { type: 'object', properties: { id: uuid }, required: ['id'], ...noAdditional } } }, async (request, reply) => {
  const result = await pool.query(
    `SELECT st.id, st.student_number AS "studentNumber", st.full_name AS name,
            st.year_group AS "yearGroup", ('Year ' || st.year_group) AS year,
            cg.name AS class, st.status, st.created_at AS "createdAt", st.updated_at AS "updatedAt"
       FROM students st LEFT JOIN class_groups cg ON cg.id = st.class_group_id AND cg.school_id = st.school_id
      WHERE st.school_id = $1 AND st.id = $2
        AND ($3 <> 'teacher' OR EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.school_id = st.school_id AND cm.user_id = $4 AND cm.class_group_id = st.class_group_id))`, [request.auth.school_id, request.params.id, request.auth.role, request.auth.user_id],
  );
  if (!result.rowCount) return reply.code(404).send({ error: { code: 'not_found', message: 'Student not found.', requestId: request.id } });
  return { data: result.rows[0] };
});

app.get('/api/v1/students/:id/enrollments', { preHandler: requireRoles('owner', 'admin'), schema: { params: { type: 'object', properties: { id: uuid }, required: ['id'], ...noAdditional } } }, async (request, reply) => {
  const result = await pool.query(
    `SELECT e.id, cg.name AS class, cg.year_group AS "yearGroup", cg.academic_year AS "academicYear",
            e.start_date AS "startDate", e.end_date AS "endDate"
       FROM enrollments e JOIN class_groups cg ON cg.school_id = e.school_id AND cg.id = e.class_group_id
      WHERE e.school_id = $1 AND e.student_id = $2 ORDER BY e.start_date DESC, e.created_at DESC`,
    [request.auth.school_id, request.params.id],
  );
  return { data: result.rows, count: result.rowCount };
});

app.patch('/api/v1/students/:id', { preHandler: requireRoles('owner', 'admin'), schema: {
  params: { type: 'object', properties: { id: uuid }, required: ['id'], ...noAdditional },
  body: { type: 'object', minProperties: 1, properties: { name: { type: 'string', minLength: 1, maxLength: 160 }, classGroupId: uuid, status: { type: 'string', enum: ['enrolled', 'withdrawn', 'graduated'] } }, ...noAdditional },
} }, async (request, reply) => {
  const result = await transaction(async client => {
    const current = await client.query('SELECT year_group, class_group_id, status FROM students WHERE school_id = $1 AND id = $2 FOR UPDATE', [request.auth.school_id, request.params.id]);
    if (!current.rowCount) return null;
    if (request.body.classGroupId) {
      const group = await client.query('SELECT id, year_group FROM class_groups WHERE school_id = $1 AND id = $2', [request.auth.school_id, request.body.classGroupId]);
      if (!group.rowCount || group.rows[0].year_group !== current.rows[0].year_group) { const error = new Error('Choose a class from the student’s year group.'); error.statusCode = 422; throw error; }
      if (current.rows[0].class_group_id !== request.body.classGroupId && !['withdrawn', 'graduated'].includes(request.body.status)) {
        await client.query('UPDATE enrollments SET end_date = greatest(start_date, (now() AT TIME ZONE $3)::date) WHERE school_id = $1 AND student_id = $2 AND end_date IS NULL', [request.auth.school_id, request.params.id, request.auth.timezone]);
        await client.query('INSERT INTO enrollments (id, school_id, student_id, class_group_id, start_date, created_by) VALUES ($1, $2, $3, $4, (now() AT TIME ZONE $5)::date, $6)', [crypto.randomUUID(), request.auth.school_id, request.params.id, request.body.classGroupId, request.auth.timezone, request.auth.user_id]);
      }
    }
    const updated = await client.query(
      `UPDATE students SET full_name = coalesce($3, full_name),
            class_group_id = coalesce($4, class_group_id), status = coalesce($5, status), updated_at = now()
        WHERE school_id = $1 AND id = $2
        RETURNING id, student_number AS "studentNumber", full_name AS name, year_group AS "yearGroup", status, updated_at AS "updatedAt"`,
      [request.auth.school_id, request.params.id, request.body.name?.trim() || null, request.body.classGroupId || null, request.body.status || null],
    );
    if (!updated.rowCount) return null;
    if (request.body.status && request.body.status !== 'enrolled') {
      await client.query('UPDATE enrollments SET end_date = greatest(start_date, (now() AT TIME ZONE $3)::date) WHERE school_id = $1 AND student_id = $2 AND end_date IS NULL', [request.auth.school_id, request.params.id, request.auth.timezone]);
    } else if (request.body.status === 'enrolled' && current.rows[0].status !== 'enrolled' && !(request.body.classGroupId && request.body.classGroupId !== current.rows[0].class_group_id)) {
      await client.query('INSERT INTO enrollments (id, school_id, student_id, class_group_id, start_date, created_by) VALUES ($1, $2, $3, $4, (now() AT TIME ZONE $5)::date, $6)', [crypto.randomUUID(), request.auth.school_id, request.params.id, request.body.classGroupId || current.rows[0].class_group_id, request.auth.timezone, request.auth.user_id]);
    }
    await audit(client, request, request.auth, 'student.updated', 'student', request.params.id);
    return updated.rows[0];
  });
  if (!result) return reply.code(404).send({ error: { code: 'not_found', message: 'Student not found.', requestId: request.id } });
  return { data: result };
});

app.delete('/api/v1/students/:id', { preHandler: requireRoles('owner', 'admin'), schema: { params: { type: 'object', properties: { id: uuid }, required: ['id'], ...noAdditional } } }, async (request, reply) => {
  const result = await transaction(async client => {
    const updated = await client.query("UPDATE students SET status = 'withdrawn', updated_at = now() WHERE school_id = $1 AND id = $2 AND status = 'enrolled' RETURNING id", [request.auth.school_id, request.params.id]);
    if (!updated.rowCount) return false;
    await audit(client, request, request.auth, 'student.withdrawn', 'student', request.params.id);
    return true;
  });
  if (!result) return reply.code(404).send({ error: { code: 'not_found', message: 'Student not found.', requestId: request.id } });
  return reply.code(204).send();
});

app.get('/api/v1/classes', { preHandler: authenticate }, async request => {
  const result = await pool.query(
    `SELECT cg.id, cg.name, cg.year_group AS "yearGroup", cg.academic_year AS "academicYear",
            string_agg(DISTINCT u.full_name, ' · ' ORDER BY u.full_name) AS "teacherName",
            count(DISTINCT st.id) FILTER (WHERE st.status = 'enrolled')::int AS "studentCount"
       FROM class_groups cg LEFT JOIN students st ON st.school_id = cg.school_id AND st.class_group_id = cg.id
       LEFT JOIN class_memberships cm ON cm.school_id = cg.school_id AND cm.class_group_id = cg.id
       LEFT JOIN users u ON u.id = cm.user_id
      WHERE cg.school_id = $1
        AND ($2 <> 'teacher' OR EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.school_id = cg.school_id AND cm.user_id = $3 AND cm.class_group_id = cg.id))
      GROUP BY cg.id ORDER BY cg.year_group, cg.name`, [request.auth.school_id, request.auth.role, request.auth.user_id],
  );
  return { data: result.rows, count: result.rowCount };
});

app.get('/api/v1/classes/:id/teachers', { preHandler: requireRoles('owner', 'admin'), schema: { params: { type: 'object', properties: { id: uuid }, required: ['id'], ...noAdditional } } }, async (request, reply) => {
  const result = await pool.query(
    `SELECT u.id, u.full_name AS name, u.email
       FROM class_memberships cm JOIN users u ON u.id = cm.user_id
      WHERE cm.school_id = $1 AND cm.class_group_id = $2 AND u.active = true ORDER BY u.full_name`,
    [request.auth.school_id, request.params.id],
  );
  return { data: result.rows, count: result.rowCount };
});

app.get('/api/v1/classes/:id/roster', { preHandler: authenticate, schema: { params: { type: 'object', properties: { id: uuid }, required: ['id'], ...noAdditional } } }, async (request, reply) => {
  const result = await pool.query(
    `SELECT id, student_number AS "studentNumber", full_name AS name, year_group AS "yearGroup", ('Year ' || year_group) AS year
       FROM students WHERE school_id = $1 AND class_group_id = $2 AND status = 'enrolled'
        AND ($3 <> 'teacher' OR EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.school_id = students.school_id AND cm.user_id = $4 AND cm.class_group_id = students.class_group_id))
      ORDER BY full_name, student_number LIMIT 300`, [request.auth.school_id, request.params.id, request.auth.role, request.auth.user_id],
  );
  return { data: result.rows, count: result.rowCount };
});

app.post('/api/v1/classes', { preHandler: requireRoles('owner', 'admin'), schema: { body: {
  type: 'object', required: ['name', 'yearGroup', 'academicYear'], properties: {
    name: { type: 'string', minLength: 1, maxLength: 24 }, yearGroup: { type: 'integer', minimum: 1, maximum: 12 },
    academicYear: { type: 'string', minLength: 4, maxLength: 20 },
  }, ...noAdditional,
} } }, async (request, reply) => {
  const id = crypto.randomUUID();
  const row = await transaction(async client => {
    const result = await client.query(
      `INSERT INTO class_groups (id, school_id, name, year_group, academic_year)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, year_group AS "yearGroup", academic_year AS "academicYear"`,
      [id, request.auth.school_id, request.body.name.trim().toUpperCase(), request.body.yearGroup, request.body.academicYear.trim()],
    );
    await audit(client, request, request.auth, 'class.created', 'class_group', id);
    return { ...result.rows[0], studentCount: 0 };
  });
  return reply.code(201).send({ data: row });
});

app.put('/api/v1/classes/:id/teachers', { preHandler: requireRoles('owner', 'admin'), schema: {
  params: { type: 'object', properties: { id: uuid }, required: ['id'], ...noAdditional },
  body: { type: 'object', required: ['userIds'], properties: { userIds: { type: 'array', maxItems: 100, uniqueItems: true, items: uuid } }, ...noAdditional },
} }, async (request, reply) => {
  await transaction(async client => {
    const group = await client.query('SELECT 1 FROM class_groups WHERE school_id = $1 AND id = $2', [request.auth.school_id, request.params.id]);
    if (!group.rowCount) { const error = new Error('Class not found.'); error.statusCode = 404; throw error; }
    if (request.body.userIds.length) {
      const teachers = await client.query(
        `SELECT m.user_id FROM school_memberships m
          WHERE m.school_id = $1 AND m.user_id = ANY($2::uuid[]) AND m.role = 'teacher'`,
        [request.auth.school_id, request.body.userIds],
      );
      if (teachers.rowCount !== request.body.userIds.length) { const error = new Error('Every assigned account must be a teacher in this school.'); error.statusCode = 422; throw error; }
    }
    await client.query('DELETE FROM class_memberships WHERE school_id = $1 AND class_group_id = $2', [request.auth.school_id, request.params.id]);
    for (const userId of request.body.userIds) {
      await client.query('INSERT INTO class_memberships (school_id, user_id, class_group_id, assigned_by) VALUES ($1, $2, $3, $4)', [request.auth.school_id, userId, request.params.id, request.auth.user_id]);
    }
    await audit(client, request, request.auth, 'class.teachers_assigned', 'class_group', request.params.id, { teacherCount: request.body.userIds.length });
  });
  return reply.code(204).send();
});

app.get('/api/v1/attendance', { preHandler: authenticate, schema: { querystring: { type: 'object', required: ['date'], properties: { date: { type: 'string', format: 'date' } }, ...noAdditional } } }, async request => {
  const result = await pool.query(
    `SELECT ar.student_id AS "studentId", st.student_number AS "studentNumber", st.full_name AS name,
            st.year_group AS "yearGroup", cg.name AS class, upper(ar.status) AS status, ar.updated_at AS "updatedAt"
       FROM attendance_records ar
       JOIN attendance_sessions ats ON ats.id = ar.session_id AND ats.school_id = ar.school_id
       JOIN students st ON st.id = ar.student_id AND st.school_id = ar.school_id
       JOIN class_groups cg ON cg.id = ats.class_group_id AND cg.school_id = ar.school_id
      WHERE ar.school_id = $1 AND ats.attendance_date = $2
        AND ($3 <> 'teacher' OR EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.school_id = ats.school_id AND cm.user_id = $4 AND cm.class_group_id = ats.class_group_id))
      ORDER BY st.full_name`, [request.auth.school_id, request.query.date, request.auth.role, request.auth.user_id],
  );
  return { data: result.rows, count: result.rowCount };
});

app.put('/api/v1/attendance', { preHandler: requireRoles('owner', 'admin', 'teacher', 'attendance_staff'), schema: { body: {
  type: 'object', required: ['date', 'records'], properties: {
    date: { type: 'string', format: 'date' }, records: { type: 'array', maxItems: 300, items: { type: 'object', required: ['studentId', 'status'], properties: { studentId: uuid, status: { type: 'string', enum: ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] } }, ...noAdditional } },
  }, ...noAdditional,
} } }, async (request, reply) => {
  const statuses = new Map(request.body.records.map(record => [record.studentId, record.status.toLowerCase()]));
  if (statuses.size !== request.body.records.length) return reply.code(400).send({ error: { code: 'duplicate_student', message: 'A student may appear only once per register submission.', requestId: request.id } });
  const result = await transaction(async client => {
    const studentIds = [...statuses.keys()];
    const students = await client.query(
      `SELECT id, class_group_id FROM students WHERE school_id = $1 AND id = ANY($2::uuid[]) AND status = 'enrolled'`,
      [request.auth.school_id, studentIds],
    );
    if (students.rowCount !== studentIds.length || students.rows.some(student => !student.class_group_id)) {
      const error = new Error('All register students must be enrolled in a class at this school.'); error.statusCode = 422; throw error;
    }
    if (request.auth.role === 'teacher') {
      const assigned = await client.query('SELECT class_group_id FROM class_memberships WHERE school_id = $1 AND user_id = $2 AND class_group_id = ANY($3::uuid[])', [request.auth.school_id, request.auth.user_id, students.rows.map(student => student.class_group_id)]);
      if (new Set(assigned.rows.map(row => row.class_group_id)).size !== new Set(students.rows.map(student => student.class_group_id)).size) { const error = new Error('You can only submit attendance for your assigned classes.'); error.statusCode = 403; throw error; }
    }
    const byClass = new Map();
    for (const student of students.rows) {
      if (!byClass.has(student.class_group_id)) byClass.set(student.class_group_id, []);
      byClass.get(student.class_group_id).push(student.id);
    }
    const sessions = [];
    for (const [classId, ids] of byClass) {
      const register = await client.query(
        `INSERT INTO attendance_sessions (id, school_id, class_group_id, attendance_date, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (school_id, class_group_id, attendance_date) DO UPDATE SET updated_at = now()
         RETURNING id`, [crypto.randomUUID(), request.auth.school_id, classId, request.body.date, request.auth.user_id],
      );
      const sessionId = register.rows[0].id;
      sessions.push(sessionId);
      for (const studentId of ids) {
        await client.query(
          `INSERT INTO attendance_records (id, school_id, session_id, student_id, status, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (session_id, student_id) DO UPDATE SET status = EXCLUDED.status, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [crypto.randomUUID(), request.auth.school_id, sessionId, studentId, statuses.get(studentId), request.auth.user_id],
        );
      }
      await audit(client, request, request.auth, 'attendance.saved', 'attendance_session', sessionId, { recordCount: ids.length });
    }
    return sessions;
  });
  return { data: { date: request.body.date, sessionIds: result, recordCount: statuses.size } };
});

app.get('/api/v1/reports/attendance', { preHandler: authenticate, schema: { querystring: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } }, ...noAdditional } } }, async (request, reply) => {
  if (request.query.from > request.query.to) return reply.code(400).send({ error: { code: 'invalid_date_range', message: 'from must not be after to.', requestId: request.id } });
  const result = await pool.query(
    `SELECT ats.attendance_date AS date, cg.id AS "classId", cg.name AS class,
            count(ar.id)::int AS total,
            count(ar.id) FILTER (WHERE ar.status = 'present')::int AS present,
            count(ar.id) FILTER (WHERE ar.status = 'late')::int AS late,
            count(ar.id) FILTER (WHERE ar.status = 'absent')::int AS absent,
            count(ar.id) FILTER (WHERE ar.status = 'excused')::int AS excused
       FROM attendance_sessions ats JOIN class_groups cg ON cg.id = ats.class_group_id AND cg.school_id = ats.school_id
       LEFT JOIN attendance_records ar ON ar.session_id = ats.id AND ar.school_id = ats.school_id
      WHERE ats.school_id = $1 AND ats.attendance_date BETWEEN $2 AND $3
        AND ($4 <> 'teacher' OR EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.school_id = ats.school_id AND cm.user_id = $5 AND cm.class_group_id = ats.class_group_id))
      GROUP BY ats.id, ats.attendance_date, cg.id, cg.name ORDER BY ats.attendance_date, cg.name`,
    [request.auth.school_id, request.query.from, request.query.to, request.auth.role, request.auth.user_id],
  );
  return { data: result.rows, count: result.rowCount };
});

app.get('/api/v1/events', { preHandler: authenticate, schema: { querystring: { type: 'object', properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } }, ...noAdditional } } }, async request => {
  const result = await pool.query(
    `SELECT id, title, event_date AS date, description, created_at AS "createdAt"
       FROM calendar_events WHERE school_id = $1
        AND ($2::date IS NULL OR event_date >= $2) AND ($3::date IS NULL OR event_date <= $3)
      ORDER BY event_date, title LIMIT 500`,
    [request.auth.school_id, request.query.from || null, request.query.to || null],
  );
  return { data: result.rows, count: result.rowCount };
});

app.post('/api/v1/events', { preHandler: requireRoles('owner', 'admin'), schema: { body: { type: 'object', required: ['title', 'date'], properties: { title: { type: 'string', minLength: 1, maxLength: 160 }, date: { type: 'string', format: 'date' }, description: { type: 'string', maxLength: 2000 } }, ...noAdditional } } }, async (request, reply) => {
  const id = crypto.randomUUID();
  const event = await transaction(async client => {
    const result = await client.query(
      `INSERT INTO calendar_events (id, school_id, title, event_date, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title, event_date AS date, description, created_at AS "createdAt"`,
      [id, request.auth.school_id, request.body.title.trim(), request.body.date, request.body.description?.trim() || '', request.auth.user_id],
    );
    await audit(client, request, request.auth, 'event.created', 'calendar_event', id);
    return result.rows[0];
  });
  return reply.code(201).send({ data: event });
});

app.get('/api/v1/settings', { preHandler: authenticate }, async request => {
  const result = await pool.query('SELECT id, name, timezone, settings, updated_at AS "updatedAt" FROM schools WHERE id = $1', [request.auth.school_id]);
  const school = result.rows[0];
  return { data: { schoolName: school.name, timezone: school.timezone, ...school.settings, updatedAt: school.updatedAt } };
});

app.put('/api/v1/settings', { preHandler: requireRoles('owner', 'admin'), schema: { body: { type: 'object', minProperties: 1, properties: {
  schoolName: { type: 'string', minLength: 1, maxLength: 160 }, schoolType: { type: 'string', maxLength: 80 },
  schoolYear: { type: 'string', minLength: 4, maxLength: 20 }, address: { type: 'string', maxLength: 300 },
  timezone: { type: 'string', minLength: 1, maxLength: 100 }, openTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, lateAfter: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
}, ...noAdditional } } }, async request => {
  const { schoolName, timezone, ...settings } = request.body;
  await transaction(async client => {
    const rows = await client.query('SELECT settings FROM schools WHERE id = $1 FOR UPDATE', [request.auth.school_id]);
    if (schoolName || timezone) await client.query('UPDATE schools SET name = coalesce($2, name), timezone = coalesce($3, timezone), updated_at = now() WHERE id = $1', [request.auth.school_id, schoolName?.trim() || null, timezone || null]);
    await client.query('UPDATE schools SET settings = settings || $2::jsonb, updated_at = now() WHERE id = $1', [request.auth.school_id, JSON.stringify(settings)]);
    await audit(client, request, request.auth, 'school.settings_updated', 'school', request.auth.school_id, { changedFields: Object.keys(request.body) });
  });
  const saved = await pool.query('SELECT name, timezone, settings, updated_at AS "updatedAt" FROM schools WHERE id = $1', [request.auth.school_id]);
  return { data: { schoolName: saved.rows[0].name, timezone: saved.rows[0].timezone, ...saved.rows[0].settings, updatedAt: saved.rows[0].updatedAt } };
});

app.get('/api/v1/overview', { preHandler: authenticate }, async request => {
  const result = await pool.query(
    `SELECT (SELECT count(*)::int FROM students st WHERE st.school_id = $1 AND st.status = 'enrolled' AND ($3 <> 'teacher' OR EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.school_id = st.school_id AND cm.user_id = $4 AND cm.class_group_id = st.class_group_id))) AS "studentCount",
            (SELECT count(*)::int FROM class_groups cg WHERE cg.school_id = $1 AND ($3 <> 'teacher' OR EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.school_id = cg.school_id AND cm.user_id = $4 AND cm.class_group_id = cg.id))) AS "classCount",
            (SELECT count(*)::int FROM attendance_records ar JOIN attendance_sessions ats ON ats.id = ar.session_id AND ats.school_id = ar.school_id WHERE ar.school_id = $1 AND ats.attendance_date = (now() AT TIME ZONE $2)::date AND ($3 <> 'teacher' OR EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.school_id = ats.school_id AND cm.user_id = $4 AND cm.class_group_id = ats.class_group_id))) AS "markedCount",
            (SELECT count(*)::int FROM attendance_records ar JOIN attendance_sessions ats ON ats.id = ar.session_id AND ats.school_id = ar.school_id WHERE ar.school_id = $1 AND ats.attendance_date = (now() AT TIME ZONE $2)::date AND ar.status IN ('present','late') AND ($3 <> 'teacher' OR EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.school_id = ats.school_id AND cm.user_id = $4 AND cm.class_group_id = ats.class_group_id))) AS "presentCount",
            (SELECT count(*)::int FROM attendance_records ar JOIN attendance_sessions ats ON ats.id = ar.session_id AND ats.school_id = ar.school_id WHERE ar.school_id = $1 AND ats.attendance_date = (now() AT TIME ZONE $2)::date AND ar.status = 'absent' AND ($3 <> 'teacher' OR EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.school_id = ats.school_id AND cm.user_id = $4 AND cm.class_group_id = ats.class_group_id))) AS "absentCount"`,
    [request.auth.school_id, request.auth.timezone, request.auth.role, request.auth.user_id],
  );
  const values = result.rows[0];
  return { data: { ...values, attendanceRate: values.markedCount ? Math.round(100 * values.presentCount / values.markedCount) : null, attentionCount: values.absentCount } };
});

app.get('/api/v1/audit', { preHandler: requireRoles('owner', 'admin'), schema: { querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }, offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0 } }, ...noAdditional } } }, async request => {
  const { limit = 50, offset = 0 } = request.query;
  const result = await pool.query(
    `SELECT id, actor_id AS "actorId", action, entity_type AS "entityType", entity_id AS "entityId", request_id AS "requestId", created_at AS "createdAt"
       FROM audit_events WHERE school_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3`, [request.auth.school_id, limit, offset],
  );
  return { data: result.rows, count: result.rowCount };
});

app.get('/login.html', async (request, reply) => reply.sendFile('login.html'));
app.get('/login.js', async (request, reply) => reply.sendFile('login.js'));
app.get('/auth.css', async (request, reply) => reply.sendFile('auth.css'));
app.get('/styles.css', async (request, reply) => reply.sendFile('styles.css'));
app.get('/app.js', async (request, reply) => reply.sendFile('app.js'));
app.get('/', { preHandler: requirePageAuth }, async (request, reply) => reply.redirect('/index.html'));
app.get('/index.html', { preHandler: requirePageAuth }, async (request, reply) => reply.sendFile('index.html'));
for (const page of htmlPages) {
  if (page === 'index.html') continue;
  app.get(`/${page}`, { preHandler: requirePageAuth }, async (request, reply) => reply.sendFile(page));
}

let dummyPasswordHash;
async function start() {
  await redis.connect();
  await pool.query('SELECT 1');
  dummyPasswordHash = await argon2.hash(crypto.randomBytes(32), { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 2 });
  const expirySweep = setInterval(() => pool.query('DELETE FROM sessions WHERE expires_at < now()').catch(() => {}), 15 * 60 * 1000);
  expirySweep.unref();
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ host: config.host, port: config.port, environment: process.env.NODE_ENV || 'development' }, 'Fieldnotes API listening');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close().catch(() => {});
    await Promise.all([pool.end().catch(() => {}), redis.quit().catch(() => {})]);
    process.exit(0);
  });
}

start().catch(async error => {
  process.stderr.write(`Startup failed (${error.code || 'configuration'}).\n`);
  redis.disconnect();
  await pool.end().catch(() => {});
  process.exitCode = 1;
});

