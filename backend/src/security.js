const crypto = require('node:crypto');
const argon2 = require('argon2');
const { config } = require('./config');

const SESSION_COOKIE = config.production ? '__Host-fieldnotes_session' : 'fieldnotes_session';
const CSRF_COOKIE = config.production ? '__Host-fieldnotes_csrf' : 'fieldnotes_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createCsrfToken(sessionToken) {
  const nonce = crypto.randomBytes(32).toString('base64url');
  const binding = sessionToken ? hashToken(sessionToken) : 'guest';
  const signature = crypto.createHmac('sha256', config.csrfSecret).update(`${nonce}.${binding}`).digest('base64url');
  return `${nonce}.${signature}`;
}

function verifyCsrfToken(token, sessionToken) {
  if (typeof token !== 'string' || token.length > 160) return false;
  const [nonce, signature, extra] = token.split('.');
  if (!nonce || !signature || extra || !/^[A-Za-z0-9_-]{40,50}$/.test(nonce)) return false;
  const binding = sessionToken ? hashToken(sessionToken) : 'guest';
  const expected = crypto.createHmac('sha256', config.csrfSecret).update(`${nonce}.${binding}`).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return false; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += base32Alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const char of value.replace(/=+$/, '').toUpperCase()) {
    const index = base32Alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid MFA secret.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function createTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function generateTotpCode(secret, timestamp = Date.now()) {
  const counter = BigInt(Math.floor(timestamp / 30_000));
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

function matchTotpStep(secret, code, timestamp = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const supplied = Buffer.from(code);
  const currentStep = Math.floor(timestamp / 30_000);
  for (const drift of [-1, 0, 1]) {
    const step = currentStep + drift;
    if (step < 0) continue;
    const expected = Buffer.from(generateTotpCode(secret, step * 30_000));
    if (crypto.timingSafeEqual(supplied, expected)) return BigInt(step);
  }
  return null;
}

function verifyTotpCode(secret, code, timestamp = Date.now()) {
  return matchTotpStep(secret, code, timestamp) !== null;
}

function mfaKey() {
  const key = Buffer.from(config.mfaEncryptionKey, 'base64url');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must encode exactly 32 random bytes.');
  return key;
}

function encryptTotpSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', mfaKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}

function decryptTotpSecret(encrypted) {
  const [encodedIv, encodedTag, encodedCiphertext, extra] = String(encrypted).split('.');
  if (!encodedIv || !encodedTag || !encodedCiphertext || extra) throw new Error('Stored MFA secret is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', mfaKey(), Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, 'base64url')), decipher.final()]).toString('utf8');
}

function requireSameOrigin(request, reply) {
  const origin = request.headers.origin;
  if (origin !== config.appOrigin) {
    reply.code(403).send({ error: { code: 'origin_rejected', message: 'Request origin is not allowed.', requestId: request.id } });
    return false;
  }
  const cookieToken = request.cookies[CSRF_COOKIE];
  const headerToken = request.headers['x-csrf-token'];
  const sessionToken = request.cookies[SESSION_COOKIE];
  if (!cookieToken || !headerToken || cookieToken !== headerToken || !verifyCsrfToken(cookieToken, sessionToken)) {
    reply.code(403).send({ error: { code: 'csrf_rejected', message: 'Request token is missing or invalid.', requestId: request.id } });
    return false;
  }
  return true;
}

async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 2,
  });
}

async function verifyPassword(hash, password) {
  try { return await argon2.verify(hash, password); }
  catch { return false; }
}

module.exports = {
  SESSION_COOKIE, CSRF_COOKIE, SAFE_METHODS, hashToken, createCsrfToken,
  verifyCsrfToken, requireSameOrigin, createTotpSecret, generateTotpCode, matchTotpStep, verifyTotpCode,
  encryptTotpSecret, decryptTotpSecret, hashPassword, verifyPassword,
};

