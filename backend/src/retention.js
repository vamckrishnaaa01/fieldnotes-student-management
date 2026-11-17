const { randomUUID } = require('node:crypto');
const { pool, transaction } = require('./database');
const { verifySchoolOperator } = require('./operator-auth');

const batchSize = 500;

async function runRetention() {
  const schoolId = String(process.env.SCHOOL_ID || '').trim();
  const operatorEmail = String(process.env.OPERATOR_EMAIL || '').trim().toLowerCase();
  const retentionDays = Number(process.env.RETENTION_DAYS);
  const execute = process.argv.includes('--execute');
  const unknownArgs = process.argv.slice(2).filter(argument => argument !== '--execute');
  if (unknownArgs.length || !schoolId || !operatorEmail || !process.env.OPERATOR_PASSWORD || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 36_500) {
    throw new Error('Set SCHOOL_ID, OPERATOR_EMAIL, OPERATOR_PASSWORD, RETENTION_DAYS (1–36500), and optionally pass --execute after policy approval.');
  }
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const { operatorId, eligibleCount } = await transaction(async client => {
    const actorId = await verifySchoolOperator(client, schoolId);
    const eligible = await client.query('SELECT count(*)::int AS count FROM students WHERE school_id = $1 AND deleted_at <= $2', [schoolId, cutoff]);
    return { operatorId: actorId, eligibleCount: eligible.rows[0].count };
  });
  if (!execute) {
    process.stdout.write(`${eligibleCount} deleted student record(s) meet the ${retentionDays}-day retention window (cutoff ${cutoff.toISOString()}). Dry run only. Add --execute after school policy approval to purge them.\n`);
    return;
  }

  let purgedCount = 0;
  while (true) {
    const batchCount = await transaction(async client => {
      const stillAuthorized = await client.query(
        `SELECT 1 FROM users u JOIN school_memberships m ON m.user_id = u.id
          WHERE m.school_id = $1 AND u.id = $2 AND u.active = true AND m.role IN ('owner', 'admin')`,
        [schoolId, operatorId],
      );
      if (!stillAuthorized.rowCount) throw new Error('Operator school access was revoked during retention processing.');
      const targets = await client.query(
        `SELECT id FROM students WHERE school_id = $1 AND deleted_at <= $2
          ORDER BY deleted_at, id LIMIT $3 FOR UPDATE SKIP LOCKED`,
        [schoolId, cutoff, batchSize],
      );
      const studentIds = targets.rows.map(row => row.id);
      if (!studentIds.length) return 0;
      await client.query('DELETE FROM attendance_records WHERE school_id = $1 AND student_id = ANY($2::uuid[])', [schoolId, studentIds]);
      await client.query('DELETE FROM enrollments WHERE school_id = $1 AND student_id = ANY($2::uuid[])', [schoolId, studentIds]);
      await client.query("DELETE FROM audit_events WHERE school_id = $1 AND entity_type = 'student' AND entity_id = ANY($2::uuid[])", [schoolId, studentIds]);
      const deleted = await client.query('DELETE FROM students WHERE school_id = $1 AND id = ANY($2::uuid[])', [schoolId, studentIds]);
      await client.query(
        `INSERT INTO audit_events (school_id, actor_id, action, entity_type, request_id, details)
         VALUES ($1, $2, 'student.retention_purge', 'student_retention_batch', $3, $4::jsonb)`,
        [schoolId, operatorId, `retention-${randomUUID()}`, JSON.stringify({ studentCount: deleted.rowCount, retentionDays })],
      );
      return deleted.rowCount;
    });
    purgedCount += batchCount;
    if (batchCount < batchSize) break;
  }
  process.stdout.write(`Retention purge completed: ${purgedCount} student record(s) and their linked attendance, enrollment, and student audit data were deleted.\n`);
}

runRetention().catch(error => {
  process.stderr.write(`Retention job failed: ${error.message}\n`);
  process.exitCode = 1;
}).finally(() => pool.end());

