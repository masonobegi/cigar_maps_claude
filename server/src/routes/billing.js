/**
 * Billing: paid placement for claimed stores.
 *
 * Free forever: the listing itself, claiming, inventory, deals, events, and a
 * capped number of broadcasts. Paid plans buy placement and reach, never the
 * ability to be found at all, because a directory that hides unpaid shops is a
 * worse directory.
 *
 * Stripe is talked to over plain https so there is no SDK dependency. When
 * STRIPE_SECRET_KEY is unset every endpoint still works and reports the plans
 * as unavailable, so the dashboard renders sensibly in development.
 */
'use strict';

const router = require('express').Router();
const https = require('https');
const crypto = require('crypto');
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = db;

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const APP_URL = process.env.APP_URL || 'https://cigarmapsclaude-production.up.railway.app';

/**
 * Prices are per store per month. Cigar shops run thinner margins than the
 * dispensaries Weedmaps sold to, so this starts well below their several
 * hundred a month and can move once the metro is dense.
 */
const PLANS = {
  free: {
    id: 'free', name: 'Free', price: 0,
    tagline: 'Everything you need to be found.',
    features: [
      'Your shop on the map and in search',
      'Claim and correct your details',
      'Unlimited inventory and deals',
      'Events and community posts',
      '4 broadcasts to followers per month',
    ],
  },
  featured: {
    id: 'featured', name: 'Featured', price: 49,
    priceId: process.env.STRIPE_PRICE_FEATURED,
    tagline: 'Come up first when someone is nearby.',
    features: [
      'Everything in Free',
      'Top placement in your city and on the map',
      'Featured badge on your listing',
      'Unlimited broadcasts to followers',
      'Visitor and search analytics',
    ],
  },
  partner: {
    id: 'partner', name: 'Partner', price: 149,
    priceId: process.env.STRIPE_PRICE_PARTNER,
    tagline: 'For shops that want the whole metro to know.',
    features: [
      'Everything in Featured',
      'Top placement across your whole metro',
      'Promoted events and deals',
      'Partner badge and priority support',
      'We load your first inventory for you',
    ],
  },
};

const PAID = ['featured', 'partner'];
const configured = () => !!STRIPE_KEY;

// ── Minimal Stripe client ────────────────────────────────────────────────────

function stripe(path, method = 'POST', form = null) {
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams(form).toString() : '';
    const req = https.request({
      hostname: 'api.stripe.com', path: `/v1/${path}`, method,
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Stripe-Version': '2024-06-20',
      },
      timeout: 20000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(d); } catch { return reject(new Error(`Stripe sent back something unreadable (${res.statusCode})`)); }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        reject(new Error(parsed?.error?.message || `Stripe error ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Stripe timed out')); });
    req.end(body);
  });
}

async function ownedStore(req) {
  const store = await db.get('SELECT * FROM stores WHERE id = ?', [req.params.id]);
  if (!store) return { error: [404, 'Store not found'] };
  if (store.user_id !== req.user.id) return { error: [403, 'Only the owner can manage billing for this store'] };
  return { store };
}

// ── Endpoints ────────────────────────────────────────────────────────────────

router.get('/plans', (req, res) => {
  res.json({
    configured: configured(),
    plans: Object.values(PLANS).map(p => ({
      id: p.id, name: p.name, price: p.price, tagline: p.tagline, features: p.features,
      // A paid plan is only purchasable once its Stripe price exists.
      available: p.price === 0 || (configured() && !!p.priceId),
    })),
  });
});

router.get('/stores/:id', requireAuth, asyncRoute(async (req, res) => {
  const { store, error } = await ownedStore(req);
  if (error) return res.status(error[0]).json({ error: error[1] });
  res.json({
    plan: store.plan || 'free',
    plan_status: store.plan_status || null,
    renews_at: store.plan_renews_at || null,
    featured_until: store.featured_until || null,
    can_manage: !!store.stripe_customer_id && configured(),
    configured: configured(),
  });
}));

router.post('/stores/:id/checkout', requireAuth, asyncRoute(async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'Billing is not switched on yet. Nothing to pay for today.' });
  const { store, error } = await ownedStore(req);
  if (error) return res.status(error[0]).json({ error: error[1] });

  const plan = PLANS[req.body?.plan];
  if (!plan || !PAID.includes(plan.id)) return res.status(400).json({ error: 'Unknown plan' });
  if (!plan.priceId) return res.status(503).json({ error: `The ${plan.name} plan is not available yet.` });

  let customerId = store.stripe_customer_id;
  if (!customerId) {
    const owner = await db.get('SELECT email, name FROM users WHERE id = ?', [store.user_id]);
    const customer = await stripe('customers', 'POST', {
      email: owner?.email || '',
      name: store.name,
      'metadata[store_id]': store.id,
    });
    customerId = customer.id;
    await db.run('UPDATE stores SET stripe_customer_id = ? WHERE id = ?', [customerId, store.id]);
  }

  const session = await stripe('checkout/sessions', 'POST', {
    mode: 'subscription',
    customer: customerId,
    'line_items[0][price]': plan.priceId,
    'line_items[0][quantity]': 1,
    success_url: `${APP_URL}/store-dashboard?billing=success`,
    cancel_url: `${APP_URL}/store-dashboard?billing=cancelled`,
    'metadata[store_id]': store.id,
    'metadata[plan]': plan.id,
    'subscription_data[metadata][store_id]': store.id,
    'subscription_data[metadata][plan]': plan.id,
    allow_promotion_codes: 'true',
  });

  res.json({ url: session.url });
}));

router.post('/stores/:id/portal', requireAuth, asyncRoute(async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'Billing is not switched on yet.' });
  const { store, error } = await ownedStore(req);
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (!store.stripe_customer_id) return res.status(400).json({ error: 'This store has no billing history yet.' });

  const session = await stripe('billing_portal/sessions', 'POST', {
    customer: store.stripe_customer_id,
    return_url: `${APP_URL}/store-dashboard`,
  });
  res.json({ url: session.url });
}));

router.post('/stores/:id/cancel', requireAuth, asyncRoute(async (req, res) => {
  const { store, error } = await ownedStore(req);
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (!store.stripe_subscription_id) return res.status(400).json({ error: 'Nothing to cancel.' });
  if (!configured()) return res.status(503).json({ error: 'Billing is not switched on yet.' });

  // Cancel at period end: they keep what they paid for until it runs out.
  await stripe(`subscriptions/${store.stripe_subscription_id}`, 'POST', { cancel_at_period_end: 'true' });
  await db.run("UPDATE stores SET plan_status = 'cancelling' WHERE id = ?", [store.id]);
  res.json({ ok: true, message: 'Your plan stays active until the end of the billing period.' });
}));

// ── Webhook ──────────────────────────────────────────────────────────────────
// Mounted with a raw body parser in index.js so the signature can be checked.

function signatureValid(rawBody, header) {
  if (!STRIPE_WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(String(header || '').split(',').map(p => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${parts.t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function applySubscription(sub) {
  const storeId = sub?.metadata?.store_id;
  if (!storeId) return;
  const plan = sub?.metadata?.plan || 'featured';
  const active = ['active', 'trialing'].includes(sub.status);
  const renews = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;

  await db.run(`
    UPDATE stores SET plan = ?, plan_status = ?, stripe_subscription_id = ?, plan_renews_at = ?, featured_until = ?
    WHERE id = ?
  `, [active ? plan : 'free', sub.status, sub.id, renews, active ? renews : null, storeId]);
}

router.post('/webhook', asyncRoute(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {});
  if (STRIPE_WEBHOOK_SECRET && !signatureValid(raw, req.headers['stripe-signature'])) {
    return res.status(400).json({ error: 'Bad signature' });
  }

  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Bad payload' }); }

  // Stripe retries, so record the id first and ignore anything already seen.
  const seen = await db.get('SELECT id FROM billing_events WHERE id = ?', [event.id]);
  if (seen) return res.json({ received: true, duplicate: true });
  await db.run('INSERT INTO billing_events (id, store_id, type, payload) VALUES (?, ?, ?, ?)',
    [event.id, event.data?.object?.metadata?.store_id || null, event.type, JSON.stringify(event).slice(0, 20000)]);

  const obj = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed':
      if (obj.subscription && configured()) {
        const sub = await stripe(`subscriptions/${obj.subscription}`, 'GET');
        if (!sub.metadata?.store_id && obj.metadata?.store_id) sub.metadata = { ...sub.metadata, ...obj.metadata };
        await applySubscription(sub);
      }
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await applySubscription(obj);
      break;
    case 'invoice.payment_failed':
      if (obj.subscription) {
        await db.run("UPDATE stores SET plan_status = 'past_due' WHERE stripe_subscription_id = ?", [obj.subscription]);
      }
      break;
    default:
      break;
  }

  res.json({ received: true });
}));

module.exports = router;
module.exports.PLANS = PLANS;
