-- Accounts, workspace membership and server-side sessions.
-- Passwords are scrypt hashes; session tokens are stored only as SHA-256 hashes.

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);
create unique index if not exists app_users_email_uq on app_users (lower(email));

create table if not exists memberships (
  user_id uuid not null references app_users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','manager','viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  business_id uuid references businesses(id) on delete set null, -- the workspace currently open
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on sessions (user_id);
