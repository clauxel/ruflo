CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guest_token TEXT,
  plan_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  token_cipher_text TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_tag TEXT NOT NULL,
  token_display TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  deployment_status TEXT NOT NULL,
  status_message TEXT NOT NULL,
  deployment_eta_minutes INTEGER NOT NULL,
  included_deployments INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  creem_checkout_id TEXT,
  paypal_order_id TEXT,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_mode TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  instance_name TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL,
  eta_minutes INTEGER NOT NULL,
  target_server TEXT NOT NULL,
  workspace_path TEXT,
  console_url TEXT,
  public_endpoint TEXT,
  runtime_user TEXT,
  service_name TEXT,
  console_token_cipher_text TEXT,
  console_token_iv TEXT,
  console_token_tag TEXT,
  last_message TEXT NOT NULL,
  run_logs TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_instances (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  deployment_id TEXT NOT NULL UNIQUE REFERENCES deployments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  instance_name TEXT NOT NULL UNIQUE,
  model_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  status TEXT NOT NULL,
  target_server TEXT NOT NULL,
  workspace_path TEXT,
  console_url TEXT,
  public_endpoint TEXT,
  runtime_user TEXT,
  service_name TEXT,
  runtime_state TEXT,
  multica_version TEXT,
  upgrade_status TEXT NOT NULL DEFAULT 'idle',
  upgrade_target_version TEXT,
  upgrade_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creem_products (
  lookup_key TEXT PRIMARY KEY,
  product_id TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_sessions (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  user_id TEXT,
  landing_path TEXT NOT NULL,
  referrer_host TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  device_type TEXT NOT NULL,
  browser_language TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  section_view_count INTEGER NOT NULL DEFAULT 0,
  page_view_count INTEGER NOT NULL DEFAULT 0,
  last_event_name TEXT,
  last_route_path TEXT,
  last_stage TEXT NOT NULL DEFAULT 'unknown',
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT,
  order_id TEXT,
  event_type TEXT NOT NULL,
  event_name TEXT NOT NULL,
  route_path TEXT NOT NULL,
  page_key TEXT,
  section_key TEXT,
  element_key TEXT,
  referrer_host TEXT,
  metadata_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS deployments_order_sequence_idx ON deployments(order_id, sequence_number);
CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_guest_token_idx ON orders(guest_token);
CREATE INDEX IF NOT EXISTS orders_payment_status_idx ON orders(payment_status);
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS analytics_sessions_started_at_idx ON analytics_sessions(started_at);
CREATE INDEX IF NOT EXISTS analytics_sessions_last_seen_at_idx ON analytics_sessions(last_seen_at);
CREATE INDEX IF NOT EXISTS analytics_sessions_visitor_id_idx ON analytics_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS analytics_events_session_id_idx ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS analytics_events_occurred_at_idx ON analytics_events(occurred_at);
CREATE INDEX IF NOT EXISTS analytics_events_event_name_idx ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS analytics_events_route_path_idx ON analytics_events(route_path);
CREATE INDEX IF NOT EXISTS analytics_events_element_key_idx ON analytics_events(element_key);
