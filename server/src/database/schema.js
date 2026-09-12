const db = require('./db');

async function initSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'user',
      avatar_url TEXT,
      bio TEXT,
      location_city TEXT,
      location_state TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      phone TEXT,
      website TEXT,
      logo_url TEXT,
      cover_url TEXT,
      instagram TEXT,
      lat FLOAT,
      lng FLOAT,
      hours TEXT,
      tags TEXT,
      has_lounge INTEGER DEFAULT 0,
      has_walk_in_humidor INTEGER DEFAULT 0,
      verified INTEGER DEFAULT 0,
      setup_complete INTEGER DEFAULT 0,
      claimed INTEGER DEFAULT 0,
      claimed_at TIMESTAMP,
      source TEXT DEFAULT 'owner',
      source_id TEXT,
      osm_id TEXT,
      store_type TEXT DEFAULT 'cigar_shop',
      confidence FLOAT DEFAULT 1,
      visible INTEGER DEFAULT 1,
      hours_raw TEXT,
      last_verified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS store_claims (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      method TEXT NOT NULL DEFAULT 'manual',
      contact_email TEXT,
      contact_phone TEXT,
      message TEXT,
      code_hash TEXT,
      code_expires_at TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      reviewed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS store_reports (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS verification_requests (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      business_name TEXT NOT NULL,
      business_ein TEXT,
      business_phone TEXT,
      business_address TEXT,
      business_website TEXT,
      license_number TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      submitted_at TIMESTAMP DEFAULT NOW(),
      reviewed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cigars (
      id SERIAL PRIMARY KEY,
      brand TEXT NOT NULL,
      name TEXT NOT NULL,
      country TEXT,
      wrapper TEXT,
      binder TEXT,
      filler TEXT,
      strength TEXT,
      flavor_notes TEXT,
      description TEXT,
      image_url TEXT,
      year_introduced INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vitolas (
      id SERIAL PRIMARY KEY,
      cigar_id INTEGER NOT NULL REFERENCES cigars(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      length FLOAT,
      ring_gauge INTEGER,
      msrp FLOAT
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      cigar_id INTEGER NOT NULL REFERENCES cigars(id),
      vitola_id INTEGER REFERENCES vitolas(id),
      price FLOAT NOT NULL,
      quantity INTEGER DEFAULT 0,
      in_stock INTEGER DEFAULT 1,
      is_featured INTEGER DEFAULT 0,
      is_new_arrival INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_cigars (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cigar_id INTEGER NOT NULL REFERENCES cigars(id),
      vitola_id INTEGER REFERENCES vitolas(id),
      status TEXT NOT NULL DEFAULT 'humidor',
      quantity INTEGER DEFAULT 1,
      purchase_price FLOAT,
      purchase_date TEXT,
      notes TEXT,
      aging_goal_date TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS smoke_list (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cigar_id INTEGER NOT NULL REFERENCES cigars(id),
      priority TEXT DEFAULT 'medium',
      notes TEXT,
      recommended_by TEXT,
      status TEXT DEFAULT 'pending',
      smoked_on TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cigar_id INTEGER NOT NULL REFERENCES cigars(id),
      vitola_id INTEGER REFERENCES vitolas(id),
      store_id INTEGER REFERENCES stores(id),
      logged_date TEXT,
      rating INTEGER NOT NULL,
      draw_rating INTEGER,
      burn_rating INTEGER,
      appearance_rating INTEGER,
      flavor_intensity INTEGER,
      first_third_notes TEXT,
      second_third_notes TEXT,
      final_third_notes TEXT,
      first_third_text TEXT,
      second_third_text TEXT,
      final_third_text TEXT,
      ash_color TEXT,
      finish_length TEXT,
      retrohale_notes TEXT,
      would_buy_again TEXT,
      strength_start TEXT,
      strength_end TEXT,
      flavor_notes TEXT,
      strength_experienced TEXT,
      smoke_time INTEGER,
      pairing TEXT,
      occasion TEXT,
      review_text TEXT,
      photo_data TEXT,
      photo_type TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS deals (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      discount_percent INTEGER,
      deal_price FLOAT,
      cigar_id INTEGER REFERENCES cigars(id),
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS store_follows (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      notify_broadcasts INTEGER DEFAULT 1,
      notify_deals INTEGER DEFAULT 1,
      notify_new_arrivals INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, store_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'announcement',
      cigar_id INTEGER REFERENCES cigars(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notification_reads (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      read_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, notification_id)
    );

    CREATE TABLE IF NOT EXISTS store_ratings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, store_id)
    );

    CREATE TABLE IF NOT EXISTS store_views (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      viewed_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cigar_follows (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cigar_id INTEGER NOT NULL REFERENCES cigars(id) ON DELETE CASCADE,
      notify_in_stock INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, cigar_id)
    );

    CREATE TABLE IF NOT EXISTS inventory_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      cigar_id INTEGER REFERENCES cigars(id),
      cigar_name_free TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_cigars_brand ON cigars(brand);
    CREATE INDEX IF NOT EXISTS idx_cigars_name ON cigars(name);
    CREATE INDEX IF NOT EXISTS idx_inventory_store ON inventory(store_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_cigar ON inventory(cigar_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_cigar ON reviews(cigar_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_cigars_user ON user_cigars(user_id);
    CREATE INDEX IF NOT EXISTS idx_smoke_list_user ON smoke_list(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_store ON notifications(store_id);
    CREATE INDEX IF NOT EXISTS idx_store_follows_user ON store_follows(user_id);
    CREATE INDEX IF NOT EXISTS idx_stores_city ON stores(city);
    CREATE INDEX IF NOT EXISTS idx_stores_state ON stores(state);
    CREATE INDEX IF NOT EXISTS idx_verif_store ON verification_requests(store_id);
    CREATE INDEX IF NOT EXISTS idx_verif_status ON verification_requests(status);
    CREATE INDEX IF NOT EXISTS idx_cigar_follows_user ON cigar_follows(user_id);
    CREATE INDEX IF NOT EXISTS idx_inv_requests_store ON inventory_requests(store_id);

    CREATE TABLE IF NOT EXISTS cigar_images (
      id SERIAL PRIMARY KEY,
      cigar_id INTEGER NOT NULL REFERENCES cigars(id) ON DELETE CASCADE,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      image_data TEXT NOT NULL,
      image_type VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
      is_default INTEGER NOT NULL DEFAULT 0,
      uploaded_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_cigar_images_cigar ON cigar_images(cigar_id);
    CREATE INDEX IF NOT EXISTS idx_cigar_images_default ON cigar_images(cigar_id, is_default);

    CREATE TABLE IF NOT EXISTS seed_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_posts (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'post',
      content TEXT NOT NULL,
      cigar_id INTEGER REFERENCES cigars(id),
      is_pinned INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS store_events (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      created_by INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT,
      event_date TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS event_rsvps (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL REFERENCES store_events(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'going',
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_community_store ON community_posts(store_id);
    CREATE INDEX IF NOT EXISTS idx_events_store ON store_events(store_id);

    CREATE TABLE IF NOT EXISTS community_likes (
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS community_replies (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_community_replies_post ON community_replies(post_id);
  `);
}

// ── Schema migrations ────────────────────────────────────────────────────────
// When you need to add a column or index to an EXISTING table, add an entry
// here instead of (or in addition to) editing the CREATE TABLE above.
//
// Rules:
//   1. Give it a unique name in the format NNN_short_description
//   2. Write the SQL as idempotent as possible (IF NOT EXISTS, etc.)
//   3. Also add the column to the CREATE TABLE block above so fresh DBs get it
//
// Each migration runs EXACTLY ONCE and is recorded in schema_migrations.
// Safe to deploy as many times as you like — already-run migrations are skipped.
const MIGRATIONS = [
  // Example (do not delete this comment — it shows the format):
  // { name: '001_stores_add_slug', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS slug TEXT' },
  { name: '001_stores_add_sheet_url', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS sheet_url TEXT' },
  { name: '002_stores_add_sheet_last_synced', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS sheet_last_synced TIMESTAMP' },
  { name: '003_inventory_synced_from_sheet', sql: 'ALTER TABLE inventory ADD COLUMN IF NOT EXISTS synced_from_sheet BOOLEAN DEFAULT false' },
  { name: '004_users_add_home_lat', sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS home_lat FLOAT' },
  { name: '005_users_add_home_lng', sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS home_lng FLOAT' },
  { name: '006_users_add_home_label', sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS home_label TEXT' },
  { name: '007_store_follows_notify_community', sql: 'ALTER TABLE store_follows ADD COLUMN IF NOT EXISTS notify_community INTEGER DEFAULT 1' },
  { name: '008_users_add_humidor_sheet_url', sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS humidor_sheet_url TEXT' },
  { name: '009_notifications_add_created_by', sql: 'ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER' },
  { name: '010_community_likes', sql: `CREATE TABLE IF NOT EXISTS community_likes (post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (post_id, user_id))` },
  { name: '011_community_replies', sql: `CREATE TABLE IF NOT EXISTS community_replies (id SERIAL PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())` },
  { name: '012_community_replies_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_community_replies_post ON community_replies(post_id)' },
  { name: '013_store3_dallas', sql: `UPDATE stores SET address='2803 Elm St', city='Dallas', state='TX', zip='75226', phone='(214) 555-2803', lat=32.7834, lng=-96.7908, description='Upscale Deep Ellum lounge. Craft cocktail bar, private lockers, and a curated walk-in humidor.' WHERE user_id=(SELECT id FROM users WHERE email='store3@demo.com')` },
  { name: '014_store4_tampa',  sql: `UPDATE stores SET address='712 S Dale Mabry Hwy', city='Tampa', state='FL', zip='33609', phone='(813) 555-0712', lat=27.9395, lng=-82.4991, description='Hyde Park cigar shop. Friendly staff, fair prices, over 150 SKUs. Great everyday selection.' WHERE user_id=(SELECT id FROM users WHERE email='store4@demo.com')` },
  { name: '015_store5_newyork', sql: `UPDATE stores SET address='19 W 44th St', city='New York', state='NY', zip='10036', phone='(212) 555-0019', lat=40.7553, lng=-73.9822, description='Midtown Manhattan cigar lounge. Whiskey bar, private events, and a world-class humidor.' WHERE user_id=(SELECT id FROM users WHERE email='store5@demo.com')` },
  { name: '016_user_cigars_size_label', sql: 'ALTER TABLE user_cigars ADD COLUMN IF NOT EXISTS size_label TEXT' },
  { name: '017_reviews_photo_data', sql: 'ALTER TABLE reviews ADD COLUMN IF NOT EXISTS photo_data TEXT' },
  { name: '018_reviews_photo_type', sql: 'ALTER TABLE reviews ADD COLUMN IF NOT EXISTS photo_type TEXT' },
  { name: '019_user_follows', sql: `CREATE TABLE IF NOT EXISTS user_follows (follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT NOW(), PRIMARY KEY (follower_id, followed_id))` },
  // ── Unclaimed store listings (auto-imported directory) ──
  { name: '020_stores_user_id_nullable', sql: 'ALTER TABLE stores ALTER COLUMN user_id DROP NOT NULL' },
  { name: '021_stores_claimed', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS claimed INTEGER DEFAULT 0' },
  { name: '022_stores_claimed_backfill', sql: 'UPDATE stores SET claimed = 1 WHERE user_id IS NOT NULL' },
  { name: '023_stores_claimed_at', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP' },
  { name: '024_stores_source', sql: "ALTER TABLE stores ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'owner'" },
  { name: '025_stores_source_id', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS source_id TEXT' },
  { name: '026_stores_store_type', sql: "ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_type TEXT DEFAULT 'cigar_shop'" },
  { name: '027_stores_confidence', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS confidence FLOAT DEFAULT 1' },
  { name: '028_stores_visible', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS visible INTEGER DEFAULT 1' },
  { name: '029_stores_hours_raw', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS hours_raw TEXT' },
  { name: '030_stores_last_verified_at', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMP' },
  { name: '031_stores_osm_id', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS osm_id TEXT' },
  { name: '032_stores_source_idx', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_source ON stores(source, source_id) WHERE source_id IS NOT NULL' },
  { name: '033_stores_geo_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_stores_lat_lng ON stores(lat, lng)' },
  { name: '034_stores_visible_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_stores_visible ON stores(visible, claimed)' },
  { name: '035_store_claims', sql: `CREATE TABLE IF NOT EXISTS store_claims (id SERIAL PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, method TEXT NOT NULL DEFAULT 'manual', contact_email TEXT, contact_phone TEXT, message TEXT, code_hash TEXT, code_expires_at TIMESTAMP, status TEXT NOT NULL DEFAULT 'pending', admin_notes TEXT, created_at TIMESTAMP DEFAULT NOW(), reviewed_at TIMESTAMP)` },
  { name: '036_store_reports', sql: `CREATE TABLE IF NOT EXISTS store_reports (id SERIAL PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, reason TEXT NOT NULL, details TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMP DEFAULT NOW())` },
  { name: '037_inventory_store_cigar_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_inventory_store_cigar ON inventory(store_id, cigar_id)' },
  { name: '038_inventory_cigar_stock_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_inventory_cigar_stock ON inventory(cigar_id, in_stock)' },
  // ── Inventory provenance (owner-entered vs. read from the shop's own website / POS) ──
  { name: '039_inventory_source', sql: "ALTER TABLE inventory ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'owner'" },
  { name: '040_inventory_source_url', sql: 'ALTER TABLE inventory ADD COLUMN IF NOT EXISTS source_url TEXT' },
  { name: '041_inventory_external_id', sql: 'ALTER TABLE inventory ADD COLUMN IF NOT EXISTS external_id TEXT' },
  { name: '042_inventory_last_confirmed', sql: 'ALTER TABLE inventory ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMP DEFAULT NOW()' },
  { name: '043_inventory_external_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_inventory_external ON inventory(store_id, source, external_id)' },
  { name: '044_stores_menu_url', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS menu_url TEXT' },
  { name: '045_stores_menu_platform', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS menu_platform TEXT' },
  { name: '046_stores_menu_last_synced', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS menu_last_synced TIMESTAMP' },
  { name: '047_stores_menu_status', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS menu_status TEXT' },
  { name: '048_stores_menu_opt_out', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS menu_opt_out INTEGER DEFAULT 0' },
  { name: '049_stores_menu_checked_at', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS menu_checked_at TIMESTAMP' },
  // ── Account security: password reset + email verification ──
  { name: '050_password_resets', sql: `CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL, expires_at TIMESTAMP NOT NULL, used_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())` },
  { name: '051_password_resets_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id)' },
  { name: '052_users_email_verified', sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 0' },
  { name: '053_users_verify_token_hash', sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_hash TEXT' },
  { name: '054_users_verify_sent_at', sql: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_sent_at TIMESTAMP' },
  // ── Pending catalog entries discovered from menus/imports that did not match a known cigar ──
  { name: '055_catalog_pending', sql: `CREATE TABLE IF NOT EXISTS catalog_pending (id SERIAL PRIMARY KEY, raw_name TEXT NOT NULL, normalized TEXT NOT NULL, store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL, source TEXT, price FLOAT, seen_count INTEGER DEFAULT 1, suggested_cigar_id INTEGER REFERENCES cigars(id) ON DELETE SET NULL, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())` },
  { name: '056_catalog_pending_idx', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_pending_norm ON catalog_pending(normalized)' },
  // ── Claim abuse controls and staff edits that survive a directory re-import ──
  { name: '057_store_claims_attempts', sql: 'ALTER TABLE store_claims ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0' },
  { name: '058_store_claims_last_sent', sql: 'ALTER TABLE store_claims ADD COLUMN IF NOT EXISTS code_sent_at TIMESTAMP' },
  { name: '059_stores_staff_edited', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS staff_edited INTEGER DEFAULT 0' },
  { name: '060_store_reports_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_store_reports_store ON store_reports(store_id, created_at)' },
  // ── Billing: paid placement for claimed stores ──
  { name: '061_stores_plan', sql: "ALTER TABLE stores ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'" },
  { name: '062_stores_plan_status', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS plan_status TEXT' },
  { name: '063_stores_stripe_customer', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT' },
  { name: '064_stores_stripe_subscription', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT' },
  { name: '065_stores_plan_renews_at', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS plan_renews_at TIMESTAMP' },
  { name: '066_stores_featured_until', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS featured_until TIMESTAMP' },
  { name: '067_billing_events', sql: `CREATE TABLE IF NOT EXISTS billing_events (id TEXT PRIMARY KEY, store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL, type TEXT, payload TEXT, created_at TIMESTAMP DEFAULT NOW())` },
  { name: '068_stores_plan_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_stores_plan ON stores(plan, featured_until)' },
  // ── Images moved out of Postgres: a URL replaces the base64 blob ──
  { name: '069_cigar_images_url', sql: 'ALTER TABLE cigar_images ADD COLUMN IF NOT EXISTS image_url TEXT' },
  { name: '070_cigar_images_data_nullable', sql: 'ALTER TABLE cigar_images ALTER COLUMN image_data DROP NOT NULL' },
  { name: '071_reviews_photo_url', sql: 'ALTER TABLE reviews ADD COLUMN IF NOT EXISTS photo_url TEXT' },
  // ── Website health: source data is full of dead domains ──
  { name: '072_stores_website_status', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS website_status TEXT' },
  { name: '073_stores_website_checked_at', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS website_checked_at TIMESTAMP' },
  { name: '074_stores_website_final_url', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS website_final_url TEXT' },
  { name: '075_stores_website_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_stores_website_check ON stores(website_checked_at) WHERE website IS NOT NULL' },
  // ── Storefront check: the directory is full of companies, wholesalers and
  //    online-only sellers registered at an address. Only walk-in shops belong.
  { name: '076_stores_storefront', sql: "ALTER TABLE stores ADD COLUMN IF NOT EXISTS storefront TEXT" },
  { name: '077_stores_storefront_reason', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS storefront_reason TEXT' },
  { name: '078_stores_storefront_checked_at', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS storefront_checked_at TIMESTAMP' },
  { name: '079_stores_storefront_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_stores_storefront ON stores(storefront, visible)' },
  // ── Is the shop still trading? Source data lags reality by months, so this
  //    records what each signal said and when.
  { name: '080_stores_operating_status', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS operating_status TEXT' },
  { name: '081_stores_closed_reason', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS closed_reason TEXT' },
  { name: '082_stores_closed_at', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP' },
  { name: '083_stores_closure_checked_at', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS closure_checked_at TIMESTAMP' },
  { name: '084_stores_closed_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_stores_operating ON stores(operating_status, visible)' },

  // Which matcher read this shop's menu. A fix to the matcher makes every
  // shop read by the old one stale, so the correction reaches existing rows.
  { name: '085_stores_menu_matcher_version', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS menu_matcher_version INTEGER' },

  // Where a catalog line came from. 'curated' lines were written by a person
  // and carry tasting notes; 'shop_feed' lines were learned from what shops
  // actually sell, and know only brand, line and sizes until someone fills
  // them in. Keeping them apart means a curator can find the thin ones.
  { name: '086_cigars_source', sql: "ALTER TABLE cigars ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'curated'" },
  { name: '087_cigars_seen_at_stores', sql: 'ALTER TABLE cigars ADD COLUMN IF NOT EXISTS seen_at_stores INTEGER DEFAULT 0' },
  { name: '088_cigars_brand_name_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_cigars_brand_name ON cigars (LOWER(brand), LOWER(name))' },

  // A shop's own time zone, so "open now" is judged on its clock and not the
  // visitor's or the server's. Filled from state and longitude on boot.
  { name: '089_stores_timezone', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS timezone TEXT' },
  // The picture a shop's own website offers for sharing (og:image), shown as
  // the listing's thumbnail until the owner uploads their own.
  { name: '090_stores_web_image', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS web_image_url TEXT' },
  // Where a listing's hours came from ('osm', 'website', 'owner'), so a
  // website reading never overwrites an owner's hours and can be traced.
  { name: '091_stores_hours_source', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS hours_source TEXT' },
  { name: '092_stores_hours_checked_at', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS hours_checked_at TIMESTAMP' },
  // Which hand last wrote each field, so an import refreshes only what the
  // directory still owns and a sweep's correction survives. See utils/storeEdits.js.
  { name: '093_stores_field_sources', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS field_sources TEXT' },
  { name: '094_store_edits', sql: `CREATE TABLE IF NOT EXISTS store_edits (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      before TEXT,
      after TEXT,
      source TEXT NOT NULL,
      job TEXT,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )` },
  { name: '095_store_edits_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_store_edits_store ON store_edits(store_id, created_at DESC)' },

  // ── The menu scanner's back-off ───────────────────────────────────────────
  // The scan used to pick the same forty shops by placement every six hours,
  // because a failed read left menu_matcher_version NULL and the selection was
  // ordered by confidence rather than by when a shop was last looked at. These
  // three columns make "when is this shop next due" a thing the database knows.
  { name: '096_stores_menu_next_check', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS menu_next_check_at TIMESTAMP' },
  { name: '097_stores_menu_fail_count', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS menu_fail_count INTEGER DEFAULT 0' },
  { name: '098_stores_menu_due_idx', sql: 'CREATE INDEX IF NOT EXISTS idx_stores_menu_due ON stores(menu_next_check_at) WHERE menu_opt_out = 0' },
  // A stock row that has not been confirmed for three weeks is marked out of
  // stock and says why. Never deleted: the shop may well still carry it, and a
  // deleted row loses the price and the history with it.
  { name: '099_inventory_stale_marker', sql: 'ALTER TABLE inventory ADD COLUMN IF NOT EXISTS stale_reason TEXT' },

  // Why a claim could not take the self-serve shortcut, kept on the claim so
  // staff see the same reasons the claimant was given.
  { name: '100_store_claims_proof_reasons', sql: 'ALTER TABLE store_claims ADD COLUMN IF NOT EXISTS proof_reasons TEXT' },
  // One email-verified claim per address. Without this, one mailbox could hold
  // an instant claim on every listing that happens to share its domain.
  { name: '101_store_claims_one_email_verified', sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_store_claims_email_verified
      ON store_claims (lower(contact_email)) WHERE method = 'email' AND status = 'approved'` },

  // What a domain registry says about a domain, cached. The claim gate asks
  // RDAP whether the website's domain is registered at all and when — a dead
  // listing's domain is usually for sale, and about 480 listings could be taken
  // over by anyone willing to spend ten dollars. Cached because a retried claim
  // and the staff claim card must not each cost a lookup.
  { name: '102_domain_facts', sql: `CREATE TABLE IF NOT EXISTS domain_facts (
      domain TEXT PRIMARY KEY,
      rdap_status TEXT,
      registered_at TIMESTAMP,
      checked_at TIMESTAMP DEFAULT NOW()
    )` },

  // The name the directory gave a shop, kept beside the name we show. Every
  // name sweep is display-only and reversible from this: without it, a tidy
  // that turns "SMOKE SHOP #4 - BEST PRICES!!" into "Smoke Shop" cannot be
  // undone, and cannot tell a later directory rename from its own edit.
  // Refreshed on every import, whoever owns the displayed name.
  { name: '103_stores_source_name', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS source_name TEXT' },

  // Names this shop has also gone by: what it was called before a rebrand, its
  // legal name, its chain's brand. A JSON array. Search reads it, so a
  // customer looking for "Cheap Tobacco" still finds the shop that is now
  // called something else — which is the whole point of recording a rename
  // rather than overwriting it.
  { name: '104_stores_name_aliases', sql: 'ALTER TABLE stores ADD COLUMN IF NOT EXISTS name_aliases TEXT' },

  // Backfill: on today's rows the displayed name IS the directory's name,
  // because no name sweep has run. Stating that explicitly costs one pass and
  // means source_name is never null on an existing row, so the importer's
  // "has the source renamed this shop?" test has something to compare against
  // from the very first refresh rather than from the second.
  { name: '105_backfill_source_name', sql: 'UPDATE stores SET source_name = name WHERE source_name IS NULL' },

  // Deleting a user who owns a listing used to fail outright: the foreign key
  // was NO ACTION, so DELETE /admin/users/:id threw a constraint violation for
  // every store account. The listing should outlive the account — it is a real
  // shop either way — so the owner is detached rather than the row destroyed.
  // Clearing `claimed` is done at boot (runStartupImport), because a foreign
  // key cannot set a second column and a trigger is more machinery than this
  // needs.
  { name: '106_stores_user_id_set_null', sql: `ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_user_id_fkey` },
  // Who we have written to about their own listing, and what came of it.
  // One row per shop, so a shop can never be written to twice by accident.
  { name: '108_store_outreach', sql: `CREATE TABLE IF NOT EXISTS store_outreach (
    id SERIAL PRIMARY KEY,
    store_id INTEGER UNIQUE NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    email TEXT,
    candidates TEXT,
    looked_at TIMESTAMP,
    queued_at TIMESTAMP,
    sent_at TIMESTAMP,
    followed_up_at TIMESTAMP,
    replied_at TIMESTAMP,
    unsubscribed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  )` },
  { name: '107_stores_user_id_fk', sql: `ALTER TABLE stores
      ADD CONSTRAINT stores_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL` },
];

async function runMigrations() {
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);

  for (const m of MIGRATIONS) {
    const { rows } = await db.pool.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1', [m.name]
    );
    if (rows.length) {
      continue;
    }
    await db.pool.query(m.sql);
    await db.pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
    console.log(`[migrate] Applied: ${m.name}`);
  }
}

module.exports = { initSchema, runMigrations };
