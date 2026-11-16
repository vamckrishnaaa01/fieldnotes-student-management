const fs = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('./database');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [741_290_021]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = path.join(__dirname, '..', 'migrations');
    const files = (await fs.readdir(directory)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
    for (const filename of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
      if (applied.rowCount) continue;
      const sql = await fs.readFile(path.join(directory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      process.stdout.write(`Applied ${filename}\n`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [741_290_021]).catch(() => {});
    client.release();
    await pool.end();
  }
}

migrate().catch(error => {
  process.stderr.write(`Database migration failed (${error.code || 'unknown'}).\n`);
  process.exitCode = 1;
});

