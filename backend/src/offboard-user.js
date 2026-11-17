const { randomUUID } = require('node:crypto');
const { pool, transaction } = require('./database');
const { verifySchoolOperator } = require('./operator-auth');

async function offboardUser() {
  const schoolId = String(process.env.SCHOOL_ID || '').trim();
  const operatorEmail = String(process.env.OPERATOR_EMAIL || '').trim().toLowerCase();
  const userEmail = String(process.env.USER_EMAIL || '').trim().toLowerCase();
  if (!schoolId || !operatorEmail || !process.env.OPERATOR_PASSWORD || !userEmail) throw new Error('Set SCHOOL_ID, OPERATOR_EMAIL, OPERATOR_PASSWORD, and USER_EMAIL.');
  if (operatorEmail === userEmail) throw new Error('An operator cannot offboard their own account.');
  await transaction(async client => {
    const operatorId = await verifySchoolOperator(client, schoolId);
    const target = await client.query(
      `SELECT u.id, m.role FROM users u JOIN school_memberships m ON m.user_id = u.id
        WHERE m.school_id = $1 AND u.email = $2 AND u.active = true FOR UPDATE OF u, m`,
      [schoolId, userEmail],
    );
    if (!target.rowCount) throw new Error('The target account was not found or is already offboarded from this school.');
    if (target.rows[0].role === 'owner') {
      const owners = await client.query(
        `SELECT count(*)::int AS count FROM school_memberships m JOIN users u ON u.id = m.user_id
          WHERE m.school_id = $1 AND m.role = 'owner' AND u.active = true`, [schoolId],
      );
      if (owners.rows[0].count <= 1) throw new Error('Promote another school owner before offboarding the last owner.');
    }
    const targetId = target.rows[0].id;
    await client.query(
      `INSERT INTO audit_events (school_id, actor_id, action, entity_type, entity_id, request_id, details)
       VALUES ($1, $2, 'user.school_access_revoked', 'user', $3, $4, $5::jsonb)`,
      [schoolId, operatorId, targetId, `offboard-${randomUUID()}`, JSON.stringify({ role: target.rows[0].role })],
    );
    await client.query('DELETE FROM sessions WHERE school_id = $1 AND user_id = $2', [schoolId, targetId]);
    await client.query('DELETE FROM school_memberships WHERE school_id = $1 AND user_id = $2', [schoolId, targetId]);
  });
  process.stdout.write('School access revoked and active sessions ended. Other school memberships, if any, remain unchanged.\n');
}

offboardUser().catch(error => {
  process.stderr.write(`Offboarding failed: ${error.message}\n`);
  process.exitCode = 1;
}).finally(() => pool.end());

