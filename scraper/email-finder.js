/**
 * Email finder — visits a store's website and extracts any email addresses
 * Strategy:
 *   1. Check home page for mailto: links and email patterns
 *   2. Find and check /contact, /about, /contact-us pages
 *   3. Return all unique emails found
 */
const axios = require('axios');
const cheerio = require('cheerio');

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const THROWAWAY_DOMAINS = new Set(['example.com', 'sentry.io', 'google.com', 'amazonaws.com', 'wix.com', 'shopify.com', 'godaddy.com', 'wordpress.com', 'squarespace.com', 'mailchimp.com', 'jquery.com']);
const CONTACT_PATHS = ['/contact', '/contact-us', '/about', '/about-us', '/info', '/reach-us', '/get-in-touch'];

const httpClient = axios.create({
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  },
  maxRedirects: 5,
});

function normalizeUrl(raw) {
  if (!raw) return null;
  let url = raw.trim();
  if (!url.startsWith('http')) url = `https://${url}`;
  // Remove trailing slash
  return url.replace(/\/$/, '');
}

function extractEmails(html, domain) {
  const emails = new Set();

  // From mailto: links
  const $ = cheerio.load(html);
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const email = href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
    if (isValidEmail(email, domain)) emails.add(email);
  });

  // From page text / source
  const matches = html.match(EMAIL_REGEX) || [];
  for (const email of matches) {
    const lower = email.toLowerCase();
    if (isValidEmail(lower, domain)) emails.add(lower);
  }

  return [...emails];
}

function isValidEmail(email, siteDomain) {
  if (!email || !email.includes('@') || !email.includes('.')) return false;
  const domain = email.split('@')[1];
  if (THROWAWAY_DOMAINS.has(domain)) return false;
  // Prefer emails that match the store's own domain
  if (siteDomain && domain && !siteDomain.includes(domain) && !domain.includes(siteDomain.split('.')[0])) {
    // Still include if it looks like a real business email
    if (email.includes('noreply') || email.includes('no-reply')) return false;
  }
  if (email.includes('..')) return false;
  return true;
}

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

async function fetchPage(url) {
  try {
    const { data, status } = await httpClient.get(url);
    if (status === 200 && typeof data === 'string') return data;
    return null;
  } catch { return null; }
}

async function findEmailsForWebsite(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) return [];

  const domain = getDomain(url);
  const allEmails = new Set();

  // 1. Try home page
  const home = await fetchPage(url);
  if (home) {
    for (const e of extractEmails(home, domain)) allEmails.add(e);
  }

  // 2. If no emails found on home, try contact/about pages
  if (allEmails.size === 0) {
    for (const path of CONTACT_PATHS) {
      const html = await fetchPage(`${url}${path}`);
      if (html) {
        for (const e of extractEmails(html, domain)) allEmails.add(e);
        if (allEmails.size > 0) break; // stop after first hit
      }
      await sleep(300);
    }
  }

  return [...allEmails];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { findEmailsForWebsite };
