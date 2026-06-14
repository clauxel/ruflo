INSERT INTO users (
  id,
  email,
  name,
  password_hash,
  role,
  status,
  created_at,
  updated_at,
  last_login_at
)
VALUES (
  'guest-user',
  'guest@ruflo.local',
  'Guest checkout',
  'disabled',
  'operator',
  'disabled',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
)
ON CONFLICT(email) DO NOTHING;
