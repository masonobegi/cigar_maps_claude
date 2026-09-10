const path = require('path');

/**
 * Database connection.
 *
 * Production (Railway): DATABASE_URL is set and we use a normal pg Pool.
 * Local development: when DATABASE_URL is missing we fall back to PGlite, an
 * embedded Postgres that needs no install or native build. Data lives in
 * server/data/pglite (gitignored). Delete that folder to reset.
 */
let pool;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
} else {
  const { PGlite } = require('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || path.join(__dirname, '..', '..', 'data', 'pglite');
  const pg = new PGlite(dir);
  console.log(`[db] No DATABASE_URL set — using embedded PGlite at ${dir}`);
  pool = {
    query: async (text, params = []) => {
      const r = await pg.query(text, params);
      return { rows: r.rows, rowCount: r.affectedRows || r.rows.length };
    },
    end: () => pg.close(),
  };
}

function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
  all: (sql, params = []) =>
    pool.query(toPositional(sql), params).then(r => r.rows),

  get: (sql, params = []) =>
    pool.query(toPositional(sql), params).then(r => r.rows[0]),

  // For INSERT ... RETURNING id: lastInsertRowid is populated. For UPDATE/DELETE: null.
  run: (sql, params = []) =>
    pool.query(toPositional(sql), params).then(r => ({
      lastInsertRowid: r.rows[0]?.id ?? null,
      changes: r.rowCount,
    })),

  exec: async (sql) => {
    const stmts = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) await pool.query(stmt);
  },

  pool,
};

// Wrap async route handlers so thrown errors reach the Express error handler
db.asyncRoute = fn => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) { next(e); }
};

module.exports = db;
