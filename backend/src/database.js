const { Pool } = require('pg');
const { config } = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  // Render's internal Postgres certificate is self-signed. `require` still
  // encrypts the connection while skipping CA validation; `verify-full` keeps
  // strict certificate verification for providers with a trusted CA.
  ssl: config.databaseSsl ? { rejectUnauthorized: config.databaseSslMode !== 'require' } : false,
  max: config.databasePoolSize,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  query_timeout: 12_000,
  application_name: 'fieldnotes-api',
});

pool.on('error', error => {
  // Never include query values or error text; they can contain private student data.
  process.stderr.write(`Database pool error (${error.code || 'unknown'}).\n`);
});

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, transaction };
