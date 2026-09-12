// Which configuration this deployment has, without printing any secret.
const want = ['APP_URL', 'SMTP_USER', 'SMTP_PASS', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SERVICE', 'MAIL_FROM',
  'OUTREACH_POSTAL_ADDRESS', 'OUTREACH_FROM_NAME', 'GOOGLE_SITE_VERIFICATION', 'BING_SITE_VERIFICATION',
  'PLAUSIBLE_DOMAIN', 'GA_MEASUREMENT_ID', 'JWT_SECRET', 'STRIPE_SECRET_KEY', 'DATABASE_URL'];
for (const k of want) {
  const v = process.env[k];
  // Only APP_URL is safe to echo; it is a public URL by definition.
  const shown = k === 'APP_URL' && v ? `  (${v})` : '';
  console.log(`${v ? 'set    ' : 'NOT SET'}  ${k}${shown}`);
}
process.exit(0);
