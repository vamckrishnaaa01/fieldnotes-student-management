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
  requireSameOrigin, hashPassword, verifyPassword,
};

