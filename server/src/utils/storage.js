/**
 * Image storage.
 *
 * Photos used to live in Postgres as base64 TEXT, which bloats the database,
 * slows every backup, and makes rows expensive to read. This module puts them
 * somewhere sensible instead and hands back a URL.
 *
 * Backends, chosen automatically:
 *   1. S3-compatible object storage (Cloudflare R2, AWS S3, Backblaze B2)
 *      when S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY are set.
 *      Signed with plain SigV4 over https, so there is no SDK dependency.
 *   2. A local directory (UPLOAD_DIR, default server/uploads) otherwise, served
 *      by the API at /uploads. Fine for development and for a Railway volume.
 *
 * Callers that get null back should fall back to storing the bytes in the
 * database, which keeps older deployments working unchanged.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
};

const S3 = {
  bucket: process.env.S3_BUCKET,
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,            // e.g. https://<account>.r2.cloudflarestorage.com
  accessKey: process.env.S3_ACCESS_KEY_ID,
  secretKey: process.env.S3_SECRET_ACCESS_KEY,
  publicBase: process.env.S3_PUBLIC_BASE_URL,   // e.g. https://images.cigarbuddy.com
};

const LOCAL_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');

function backend() {
  if (S3.bucket && S3.accessKey && S3.secretKey && S3.endpoint) return 's3';
  if (process.env.DISABLE_LOCAL_UPLOADS === '1') return 'none';
  return 'local';
}

function extFor(contentType, fallback = 'jpg') {
  return EXT_BY_TYPE[String(contentType || '').toLowerCase()] || fallback;
}

function keyFor(prefix, contentType) {
  const id = crypto.randomBytes(16).toString('hex');
  return `${prefix}/${id}.${extFor(contentType)}`;
}

// ── SigV4, just enough of it for a single PUT ────────────────────────────────

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();

function signedHeaders({ method, host, canonicalUri, payload, contentType, region, service = 's3' }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(payload);

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaderList = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaderList, payloadHash].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(Buffer.from(canonicalRequest))].join('\n');

  const kDate = hmac(Buffer.from(`AWS4${S3.secretKey}`), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const signature = crypto.createHmac('sha256', hmac(kService, 'aws4_request')).update(stringToSign).digest('hex');

  return {
    'Content-Type': contentType,
    'Content-Length': payload.length,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${S3.accessKey}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`,
  };
}

function putToS3(key, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(S3.endpoint);
    const canonicalUri = `/${S3.bucket}/${key}`;
    const headers = signedHeaders({
      method: 'PUT', host: endpoint.host, canonicalUri,
      payload: buffer, contentType, region: S3.region,
    });
    const req = https.request({ hostname: endpoint.host, path: canonicalUri, method: 'PUT', headers, timeout: 20000 }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(true);
        reject(new Error(`S3 responded ${res.statusCode}: ${body.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('S3 upload timed out')); });
    req.end(buffer);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Store an image and return its URL, or null when no backend is available
 * (the caller should then keep the bytes in the database).
 */
async function putImage(buffer, contentType, prefix = 'images') {
  const key = keyFor(prefix, contentType);
  const mode = backend();

  if (mode === 's3') {
    await putToS3(key, buffer, contentType || 'application/octet-stream');
    const base = (S3.publicBase || `${S3.endpoint.replace(/\/$/, '')}/${S3.bucket}`).replace(/\/$/, '');
    return `${base}/${key}`;
  }

  if (mode === 'local') {
    const dest = path.join(LOCAL_DIR, key);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, buffer);
    return `/uploads/${key}`;
  }

  return null;
}

/** Best-effort delete; never throws, because a missing file is not an error worth failing a request over. */
async function deleteImage(url) {
  if (!url) return;
  try {
    if (url.startsWith('/uploads/')) {
      await fs.promises.unlink(path.join(LOCAL_DIR, url.slice('/uploads/'.length)));
    }
    // Objects in S3 are left in place: they are cheap, and a delete needs a
    // second signed request that can fail in ways nobody is watching.
  } catch { /* already gone */ }
}

function describe() {
  const mode = backend();
  if (mode === 's3') return `S3-compatible bucket ${S3.bucket}`;
  if (mode === 'local') return `local directory ${LOCAL_DIR}`;
  return 'database (no object storage configured)';
}

module.exports = { putImage, deleteImage, backend, describe, LOCAL_DIR, extFor };
