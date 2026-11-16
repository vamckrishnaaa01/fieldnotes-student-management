const { randomUUID } = require('node:crypto');
const { pool, transaction } = require('./database');
const { hashPassword } = require('./security');

async function bootstrap() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const fullName = String(process.env.ADMIN_NAME || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  const schoolName = String(process.env.SCHOOL_NAME || '').trim();
  if (!email || !fullName || !schoolName || password.length < 16 || password.length > 128) {
    throw new Error('Set ADMIN_EMAIL, ADMIN_NAME, SCHOOL_NAME, and a unique ADMIN_PASSWORD (16–128 characters) in the secret environment.');
  }
  const passwordHash = await hashPassword(password);
  const schoolId = randomUUID();
  await transaction(async client => {
    const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existing.rowCount) throw new Error('An account already exists for ADMIN_EMAIL; bootstrap stopped without changing it.');
    const userId = randomUUID();
    await client.query('INSERT INTO schools (id, name) VALUES ($1, $2)', [schoolId, schoolName]);
    await client.query('INSERT INTO users (id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)', [userId, email, fullName, passwordHash]);
    await client.query('INSERT INTO school_memberships (school_id, user_id, role) VALUES ($1, $2, $3)', [schoolId, userId, 'owner']);
  });
  process.stdout.write(`Initial school owner created. SCHOOL_ID=${schoolId}. Remove bootstrap secrets from the environment.\n`);
}

bootstrap().catch(error => {
  process.stderr.write(`Bootstrap failed: ${error.message}\n`);
  process.exitCode = 1;
}).finally(() => pool.end());

