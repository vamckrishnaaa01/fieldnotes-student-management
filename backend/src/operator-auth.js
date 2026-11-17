const { config } = require('./config');
const { verifyPassword, verifyTotpCode, decryptTotpSecret } = require('./security');

async function verifySchoolOperator(client, schoolId) {
  const email = String(process.env.OPERATOR_EMAIL || '').trim().toLowerCase();
  const password = process.env.OPERATOR_PASSWORD || '';
  const mfaCode = String(process.env.OPERATOR_MFA_CODE || '');
  if (!schoolId || !email || !password) throw new Error('Set SCHOOL_ID, OPERATOR_EMAIL, and OPERATOR_PASSWORD for operator verification.');
  const result = await client.query(
    `SELECT u.id, u.password_hash, u.mfa_enabled, u.mfa_secret_enc
       FROM users u JOIN school_memberships m ON m.user_id = u.id
      WHERE m.school_id = $1 AND u.email = $2 AND u.active = true AND m.role IN ('owner', 'admin')`,
    [schoolId, email],
  );
  if (!result.rowCount || !await verifyPassword(result.rows[0].password_hash, password)) {
    throw new Error('Operator verification failed.');
  }
  const operator = result.rows[0];
  if (config.mfaRequired && !operator.mfa_enabled) throw new Error('Operator MFA enrollment is required by server policy.');
  if (operator.mfa_enabled) {
    let valid = false;
    try { valid = verifyTotpCode(decryptTotpSecret(operator.mfa_secret_enc), mfaCode); } catch {}
    if (!valid) throw new Error('Operator MFA verification failed.');
  }
  return operator.id;
}

module.exports = { verifySchoolOperator };

