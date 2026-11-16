const crypto = require('node:crypto');
require('dotenv').config();

const production = process.env.NODE_ENV === 'production';
const rawTrustProxy = process.env.TRUST_PROXY || 'false';
const trustProxy = rawTrustProxy === 'true' ? true
  : rawTrustProxy === 'false' ? false
    : /^\d+$/.test(rawTrustProxy) ? Number(rawTrustProxy)
      : rawTrustProxy.split(',').map(value => value.trim()).filter(Boolean);
const config = {
  production,
  host: process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
  port: Number(process.env.PORT || 3000),
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: process.env.DATABASE_SSL === 'true',
  databasePoolSize: Number(process.env.DATABASE_POOL_SIZE || 10),
  redisUrl: process.env.REDIS_URL,
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('base64url'),
  csrfSecret: process.env.CSRF_SECRET || crypto.randomBytes(32).toString('base64url'),
  trustProxy,
  sessionHours: 8,
};

function validateConfig() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required.');
  if (!config.redisUrl) throw new Error('REDIS_URL is required for shared rate limiting.');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('PORT must be a valid TCP port.');
  if (!Number.isInteger(config.databasePoolSize) || config.databasePoolSize < 2 || config.databasePoolSize > 100) throw new Error('DATABASE_POOL_SIZE must be between 2 and 100.');
  let appOrigin;
  try { appOrigin = new URL(config.appOrigin); } catch { throw new Error('APP_ORIGIN must be a valid origin URL.'); }
  if (appOrigin.origin !== config.appOrigin.replace(/\/$/, '')) throw new Error('APP_ORIGIN must contain only the scheme, host, and optional port.');
  config.appOrigin = appOrigin.origin;
  if (config.production) {
    if (!config.appOrigin.startsWith('https://')) throw new Error('APP_ORIGIN must use HTTPS in production.');
    if (config.sessionSecret.length < 32 || !process.env.SESSION_SECRET) throw new Error('Set a unique SESSION_SECRET with at least 32 characters.');
    if (config.csrfSecret.length < 32 || !process.env.CSRF_SECRET) throw new Error('Set a different CSRF_SECRET with at least 32 characters.');
    if (!config.databaseSsl) throw new Error('DATABASE_SSL=true is required in production.');
    if (!config.redisUrl.startsWith('rediss://')) throw new Error('REDIS_URL must use TLS (rediss://) in production.');
  }
}

module.exports = { config, validateConfig };

