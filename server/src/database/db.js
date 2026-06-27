const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

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
