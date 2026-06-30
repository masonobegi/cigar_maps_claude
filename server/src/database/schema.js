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
      user_id INTEGER NOT NULL REFERENCES users(id),
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
