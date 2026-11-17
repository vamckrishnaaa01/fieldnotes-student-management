const { randomUUID } = require('node:crypto');
const { pool, transaction } = require('./database');
const { hashPassword } = require('./security');
const { verifySchoolOperator } = require('./operator-auth');

async function createUser() {
  const schoolId = String(process.env.SCHOOL_ID || '').trim();
  const email = String(process.env.USER_EMAIL || '').trim().toLowerCase();
  const name = String(process.env.USER_NAME || '').trim();
  const password = process.env.USER_PASSWORD || '';
  const role = String(process.env.USER_ROLE || '').trim();
  if (!schoolId || !email || !name || password.length < 15 || password.length > 128 || !['admin', 'teacher', 'attendance_staff', 'viewer'].includes(role)) {
    throw new Error('Set SCHOOL_ID, USER_EMAIL, USER_NAME, USER_PASSWORD (15–128 characters), and USER_ROLE (admin, teacher, attendance_staff, viewer).');
  }
  const passwordHash = await hashPassword(password);
  const userId = randomUUID();
  await transaction(async client => {
    const operatorId = await verifySchoolOperator(client, schoolId);
    const school = await client.query('SELECT 1 FROM schools WHERE id = $1', [schoolId]);
    if (!school.rowCount) throw new Error('SCHOOL_ID was not found.');
    await client.query('INSERT INTO users (id, email, full_name, password_hash, password_change_required) VALUES ($1, $2, $3, $4, true)', [userId, email, name, passwordHash]);
    await client.query('INSERT INTO school_memberships (school_id, user_id, role) VALUES ($1, $2, $3)', [schoolId, userId, role]);
    await client.query(
      `INSERT INTO audit_events (school_id, actor_id, action, entity_type, entity_id, request_id, details)
       VALUES ($1, $2, 'user.created', 'user', $3, $4, $5::jsonb)`,
      [schoolId, operatorId, userId, `operator-create-${randomUUID()}`, JSON.stringify({ role })],
    );
  });
  process.stdout.write(`Created ${role} account ${userId}. Share the account credentials through your approved secure channel.\n`);
}

createUser().catch(error => {
  process.stderr.write(`User creation failed: ${error.message}\n`);
  process.exitCode = 1;
}).finally(() => pool.end());

