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
    CREATE INDEX IF NOT EXISTS idx_inv_requests_store ON inventory_requests(store_id)
  `);
}

module.exports = { initSchema };
