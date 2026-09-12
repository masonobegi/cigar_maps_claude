/**
 * Who owns each field of a listing, and what was changed.
 *
 * A listing is written by several hands: the national directory on every
 * import, our own sweeps (a shop's website, a chain's store list, a licence
 * registry, a geocoder), staff, and the owner once a shop is claimed. Without
 * a record of which hand wrote what, the import overwrites every correction —
 * a renamed shop goes back to its old name, a pin moved to the right door
 * jumps back across town.
 *
 * stores.field_sources holds that record as JSON, one entry per field. A field
 * with no entry belongs to the directory, so nothing changes until a sweep
 * writes. store_edits keeps the before and after of every change, so a wrong
 * sweep can be traced and undone.
 *
 * Ranked weakest to strongest: directory < rule < geocode < registry < chain <
 * website < staff < owner. A source never overwrites a stronger one.
 */
'use strict';

const db = require('../database/db');

const RANK = { directory: 0, rule: 1, geocode: 2, registry: 3, chain: 4, website: 5, staff: 6, owner: 7 };
const DEFAULT_SOURCE = 'directory';

function parseSources(value) {
  if (!value) return {};
  try { const o = JSON.parse(value); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}

/** Which hand last wrote this field. */
function fieldSource(row, field) {
  return parseSources(row && row.field_sources)[field] || DEFAULT_SOURCE;
}

/** May this source write over what is there? */
function canWrite(row, field, source) {
  const held = fieldSource(row, field);
  return (RANK[source] ?? 0) >= (RANK[held] ?? 0);
}

/**
 * Write fields on one listing, record who wrote them, and log what changed.
 * Returns the fields actually written. Claimed and staff-edited listings are
 * left alone unless the source is staff or owner, so a sweep never argues with
 * the shop itself.
 */
async function writeFields(storeId, changes, { source = 'rule', job = 'unknown', reason = '', force = false } = {}) {
  const fields = Object.keys(changes || {});
  if (!fields.length) return [];
  const row = await db.get('SELECT * FROM stores WHERE id = ?', [storeId]);
  if (!row) return [];
  const ownerHeld = row.claimed || row.staff_edited;
  if (ownerHeld && !force && source !== 'staff' && source !== 'owner') return [];

  const sources = parseSources(row.field_sources);
  const written = [];
  for (const field of fields) {
    if (!force && !canWrite(row, field, source)) continue;
    const before = row[field];
    const after = changes[field];
    if (String(before ?? '') === String(after ?? '')) continue;
    await db.run(`UPDATE stores SET "${field}" = ? WHERE id = ?`, [after, storeId]);
    await db.run(
      'INSERT INTO store_edits (store_id, field, before, after, source, job, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [storeId, field, before === null || before === undefined ? null : String(before).slice(0, 2000),
        after === null || after === undefined ? null : String(after).slice(0, 2000), source, job, String(reason).slice(0, 500)]);
    sources[field] = source;
    written.push(field);
  }
  if (written.length) await db.run('UPDATE stores SET field_sources = ? WHERE id = ?', [JSON.stringify(sources), storeId]);
  return written;
}

/** Give a listing's fields back to the directory, so the next import refreshes them. */
async function releaseFields(storeId, fields) {
  const row = await db.get('SELECT field_sources FROM stores WHERE id = ?', [storeId]);
  if (!row) return;
  const sources = parseSources(row.field_sources);
  for (const f of fields) delete sources[f];
  await db.run('UPDATE stores SET field_sources = ? WHERE id = ?', [JSON.stringify(sources), storeId]);
}

module.exports = { writeFields, releaseFields, fieldSource, canWrite, parseSources, RANK, DEFAULT_SOURCE };
