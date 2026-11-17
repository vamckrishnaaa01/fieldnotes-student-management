process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.CSRF_SECRET = 'test-csrf-secret-that-is-only-for-tests';
process.env.MFA_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCsrfToken,
  verifyCsrfToken,
  requireSameOrigin,
  generateTotpCode,
  matchTotpStep,
  verifyTotpCode,
  encryptTotpSecret,
  decryptTotpSecret,
  hashPassword,
  verifyPassword,
} = require('./src/security');

test('CSRF tokens validate only for the session they are bound to', () => {
  const sessionToken = 'session-token-for-test';
  const token = createCsrfToken(sessionToken);
  assert.equal(verifyCsrfToken(token, sessionToken), true);
  assert.equal(verifyCsrfToken(token, 'different-session'), false);
  assert.equal(verifyCsrfToken(token, null), false);
  assert.equal(verifyCsrfToken(`${token}x`, sessionToken), false);
  assert.equal(verifyCsrfToken('malformed', sessionToken), false);
});

test('guest CSRF tokens remain separate from authenticated sessions', () => {
  const token = createCsrfToken(null);
  assert.equal(verifyCsrfToken(token, null), true);
  assert.equal(verifyCsrfToken(token, 'session-token'), false);
});

test('mutations require the configured origin and matching session-bound CSRF tokens', () => {
  const sessionToken = 'session-token-for-origin-check';
  const token = createCsrfToken(sessionToken);
  const rejected = [];
  const reply = { code(status) { rejected.push(status); return this; }, send() {} };
  const request = {
    headers: { origin: 'https://attacker.example', 'x-csrf-token': token },
    cookies: { fieldnotes_session: sessionToken, fieldnotes_csrf: token },
    id: 'request-test',
  };
  assert.equal(requireSameOrigin(request, reply), false);
  assert.deepEqual(rejected, [403]);

  request.headers.origin = 'http://localhost:3000';
  assert.equal(requireSameOrigin(request, reply), true);
});

test('password hashes use Argon2id and verify only the original password', async () => {
  const password = 'a unique test password that is never used outside this test';
  const hash = await hashPassword(password);
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, password), true);
  assert.equal(await verifyPassword(hash, 'incorrect password'), false);
  assert.equal(await verifyPassword('not-an-argon-hash', password), false);
});

test('TOTP code matches the RFC 6238 SHA-1 test vector and accepts a one-step clock skew', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const code = generateTotpCode(secret, 59_000);
  assert.equal(code, '287082');
  assert.equal(verifyTotpCode(secret, code, 59_000), true);
  assert.equal(verifyTotpCode(secret, code, 89_000), true);
  assert.equal(verifyTotpCode(secret, '000000', 59_000), false);
  assert.equal(matchTotpStep(secret, code, 59_000), 1n);
  assert.equal(matchTotpStep(secret, 'not-a-code', 59_000), null);
});

test('MFA secrets are encrypted at rest and authenticated against tampering', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const encrypted = encryptTotpSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptTotpSecret(encrypted), secret);
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => decryptTotpSecret(tampered));
});

