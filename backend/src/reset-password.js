const { randomUUID } = require('node:crypto');
const { pool, transaction } = require('./database');
const { hashPassword } = require('./security');
const { verifySchoolOperator } = require('./operator-auth');

async function resetPassword() {
  const schoolId = String(process.env.SCHOOL_ID || '').trim();
  const operatorEmail = String(process.env.OPERATOR_EMAIL || '').trim().toLowerCase();
  const userEmail = String(process.env.USER_EMAIL || '').trim().toLowerCase();
  const password = process.env.USER_PASSWORD || '';
  if (!schoolId || !operatorEmail || !process.env.OPERATOR_PASSWORD || !userEmail || password.length < 15 || password.length > 128) {
    throw new Error('Set SCHOOL_ID, OPERATOR_EMAIL, OPERATOR_PASSWORD, USER_EMAIL, and USER_PASSWORD (15–128 characters).');
  }
  if (operatorEmail === userEmail) throw new Error('Choose a different operator and target account.');
  const passwordHash = await hashPassword(password);
  await transaction(async client => {
    const operatorId = await verifySchoolOperator(client, schoolId);
    const target = await client.query(
      `SELECT u.id, count(m.school_id)::int AS school_count
         FROM users u JOIN school_memberships m ON m.user_id = u.id
        WHERE u.email = $1 AND u.active = true
        GROUP BY u.id HAVING bool_or(m.school_id = $2)`,
      [userEmail, schoolId],
    );
    if (!target.rowCount) throw new Error('The target account was not found or is inactive.');
    if (target.rows[0].school_count > 1) throw new Error('This identity belongs to multiple schools; use the organization-level recovery procedure.');
    const targetId = target.rows[0].id;
    await client.query('UPDATE users SET password_hash = $2, mfa_enabled = false, mfa_secret_enc = NULL, mfa_last_step = NULL, password_change_required = true, updated_at = now() WHERE id = $1', [targetId, passwordHash]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [targetId]);
    await client.query(
      `INSERT INTO audit_events (school_id, actor_id, action, entity_type, entity_id, request_id, details)
       VALUES ($1, $2, 'user.password_reset', 'user', $3, $4, $5::jsonb)`,
      [schoolId, operatorId, targetId, `operator-reset-${randomUUID()}`, JSON.stringify({ source: 'operator-cli', sessionsRevoked: true, mfaReset: true })],
    );
  });
  process.stdout.write('Password reset completed; all target account sessions were revoked and MFA was cleared for re-enrollment. Deliver the new password through an approved secure channel.\n');
}

resetPassword().catch(error => {
  process.stderr.write(`Password reset failed: ${error.message}\n`);
  process.exitCode = 1;
}).finally(() => pool.end());

