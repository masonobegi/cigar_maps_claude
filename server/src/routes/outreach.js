/**
 * The way out of the outreach email.
 *
 * One click, no sign-in, no "are you sure", no form. A shop that asks not to be
 * written to again is never written to again — by the job, and by anything else
 * that reads store_outreach. The link is signed per shop so that knowing a
 * store id is not enough to unsubscribe somebody else.
 */
'use strict';

const express = require('express');
const db = require('../database/db');
const { unsubToken } = require('../jobs/outreach');

const router = express.Router();

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{background:#17130E;color:#E8DDD0;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
main{max-width:34rem}h1{font-size:22px;margin:0 0 12px}p{margin:0 0 10px;color:#9E8E7E}
a{color:#D4882A}</style></head><body><main>${body}</main></body></html>`;

router.get('/unsubscribe', db.asyncRoute(async (req, res) => {
  const id = Number(req.query.store);
  const token = String(req.query.t || '');
  if (!id || !token || token !== unsubToken(id)) {
    return res.status(400).type('html').send(page('Link not recognised',
      '<h1>That link is not one of ours</h1><p>If you would rather not hear from us, reply to the email '
      + 'and say so — that works just as well.</p>'));
  }

  const store = await db.get('SELECT id, name FROM stores WHERE id = ?', [id]);
  await db.run(`INSERT INTO store_outreach (store_id, unsubscribed_at) VALUES (?, NOW())
    ON CONFLICT (store_id) DO UPDATE SET unsubscribed_at = NOW()`, [id]);

  res.type('html').send(page('Done', `<h1>Done — we will not write again</h1>
    <p>${store ? String(store.name).replace(/[<>&]/g, '') : 'That shop'} will not be emailed by us again.</p>
    <p>The listing itself stays up and stays free; if anything on it is wrong, it can be corrected at any time.</p>`));
}));

module.exports = router;
