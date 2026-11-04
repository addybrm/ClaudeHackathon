-- MarginOS core schema (PostgreSQL 15+, Supabase-compatible).
-- Locally this runs inside PGlite (embedded Postgres). On Supabase, apply this file
-- followed by 0002_stock_and_orders.sql and 0090_rls.sql.
--
-- Money columns are numeric(12,4) in GBP. Ingredient quantities are stored in the
-- ingredient's base unit (kg, l or each) on invoices; recipes store the unit as written
-- (g, kg, ml, l, each) and are converted by the calculation layer.

-- gen_random_uuid() is built into PostgreSQL 13+, so no extension is required.

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  currency text not null default 'GBP' check (currency = 'GBP'),
  vat_registered boolean not null default true,
  vat_rate numeric(5,2) not null default 20 check (vat_rate >= 0 and vat_rate < 100),
  prices_include_vat boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'owner' check (role in ('owner','manager','viewer')),
  created_at timestamptz not null default now(),
  unique (business_id, email)
);

create table if not exists data_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('pos_sales','supplier_invoice','menu_recipes','delivery_settlement','waste','labour')),
  label text not null,
  created_at timestamptz not null default now(),
  unique (business_id, kind)
);

create table if not exists uploaded_files (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  data_source_id uuid references data_sources(id) on delete set null,
  source_type text not null check (source_type in ('pos_sales','supplier_invoice','menu_recipes','delivery_settlement','waste','labour')),
  file_name text not null,
  mime_type text,
  size_bytes integer,
  sha256 text not null,
  storage_path text,
  extraction_method text not null check (extraction_method in ('csv_parser','claude','demo_seed')),
  status text not null default 'processing' check (status in ('processing','awaiting_review','imported','failed','discarded')),
  records_extracted integer not null default 0,
  records_valid integer not null default 0,
  records_imported integer not null default 0,
  validation_errors jsonb not null default '[]'::jsonb,
  staged jsonb,
  error_message text,
  uploaded_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists uploaded_files_business_idx on uploaded_files (business_id, uploaded_at desc);
create index if not exists uploaded_files_hash_idx on uploaded_files (business_id, sha256);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  category text,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  category text,
  base_unit text not null check (base_unit in ('kg','l','each')),
  -- Fallback cost per base unit when no invoice price exists. Always treated as ESTIMATED.
  standard_cost numeric(12,4) check (standard_cost is null or standard_cost >= 0),
  created_at timestamptz not null default now()
);
create unique index if not exists ingredients_name_uq on ingredients (business_id, lower(name));

create table if not exists supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  invoice_number text not null,
  invoice_date date not null,
  subtotal numeric(12,4) not null,
  vat_amount numeric(12,4) not null default 0,
  total numeric(12,4) not null,
  uploaded_file_id uuid references uploaded_files(id) on delete set null,
  source text not null default 'import' check (source in ('demo','import')),
  created_at timestamptz not null default now(),
  unique (business_id, supplier_id, invoice_number)
);
create index if not exists supplier_invoices_date_idx on supplier_invoices (business_id, invoice_date);

create table if not exists supplier_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  invoice_id uuid not null references supplier_invoices(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete set null,
  description text not null,
  pack_description text,
  quantity numeric(12,4) not null check (quantity > 0),   -- in the ingredient base unit
  unit text not null check (unit in ('kg','l','each')),
  unit_price numeric(12,4) not null check (unit_price >= 0), -- ex VAT, per base unit
  line_total numeric(12,4) not null
);
create index if not exists invoice_lines_ingredient_idx on supplier_invoice_lines (business_id, ingredient_id);
create index if not exists invoice_lines_invoice_idx on supplier_invoice_lines (invoice_id);

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  category text not null default 'Other',
  price_gross numeric(12,4) not null check (price_gross >= 0),          -- in-house price, VAT inclusive
  delivery_price_gross numeric(12,4) check (delivery_price_gross >= 0), -- platform menu price, VAT inclusive
  packaging_cost numeric(12,4) not null default 0,                      -- per unit, collection & delivery only
  packaging_is_estimate boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists menu_items_name_uq on menu_items (business_id, lower(name));

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  menu_item_id uuid not null unique references menu_items(id) on delete cascade,
  portions numeric(8,2) not null default 1 check (portions > 0),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete restrict,
  quantity numeric(12,4) not null check (quantity > 0),
  unit text not null check (unit in ('g','kg','ml','l','each')),
  unique (recipe_id, ingredient_id)
);

create table if not exists sales_channels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('dine_in','collection','delivery')),
  name text not null,
  platform text,
  -- Contractual commission rate, used ONLY to estimate fees for orders without a settlement record.
  commission_rate numeric(6,4) check (commission_rate is null or (commission_rate >= 0 and commission_rate < 1)),
  unique (business_id, name)
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  channel_id uuid not null references sales_channels(id) on delete restrict,
  order_ref text not null,
  ordered_at timestamptz not null,
  gross_amount numeric(12,4) not null check (gross_amount >= 0),     -- VAT inclusive, before discounts
  discount_amount numeric(12,4) not null default 0 check (discount_amount >= 0), -- restaurant-funded
  refund_amount numeric(12,4) not null default 0 check (refund_amount >= 0),
  uploaded_file_id uuid references uploaded_files(id) on delete set null,
  source text not null default 'import' check (source in ('demo','import')),
  unique (business_id, order_ref)
);
create index if not exists sales_period_idx on sales (business_id, ordered_at);

create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  sale_id uuid not null references sales(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete restrict,
  quantity numeric(10,2) not null check (quantity > 0),
  unit_price_gross numeric(12,4) not null,
  line_gross numeric(12,4) not null,
  line_discount numeric(12,4) not null default 0,
  line_refund numeric(12,4) not null default 0
);
create index if not exists sale_items_sale_idx on sale_items (sale_id);
create index if not exists sale_items_item_idx on sale_items (business_id, menu_item_id);

create table if not exists delivery_fees (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  sale_id uuid not null unique references sales(id) on delete cascade,
  platform text not null,
  commission_amount numeric(12,4) not null default 0, -- ex VAT
  other_fees numeric(12,4) not null default 0,
  settlement_ref text,
  uploaded_file_id uuid references uploaded_files(id) on delete set null
);

create table if not exists waste_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  recorded_on date not null,
  ingredient_id uuid references ingredients(id) on delete set null,
  menu_item_id uuid references menu_items(id) on delete set null,
  description text not null,
  quantity numeric(12,4) not null check (quantity > 0),
  unit text not null check (unit in ('g','kg','ml','l','each','portion')),
  reason text not null check (reason in ('spoilage','overproduction','prep_trim','plate_waste','damaged','other')),
  uploaded_file_id uuid references uploaded_files(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ingredient_id is not null or menu_item_id is not null)
);
create index if not exists waste_date_idx on waste_records (business_id, recorded_on);

create table if not exists labour_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  work_date date not null,
  role text not null,
  staff_ref text,
  hours numeric(6,2) not null check (hours > 0 and hours <= 24),
  hourly_rate numeric(8,2) not null check (hourly_rate >= 0),
  cost numeric(12,4) not null, -- hours x rate; excludes employer NI and pension
  uploaded_file_id uuid references uploaded_files(id) on delete set null
);
create index if not exists labour_date_idx on labour_records (business_id, work_date);

create table if not exists investigations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  question text not null,
  mode text not null check (mode in ('live','demo')),
  model text,
  status text not null default 'running' check (status in ('running','completed','failed')),
  period_current text,
  period_previous text,
  headline text,
  report jsonb,
  trace jsonb not null default '[]'::jsonb,
  verification jsonb,
  error_message text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists investigations_business_idx on investigations (business_id, created_at desc);

create table if not exists investigation_findings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  investigation_id uuid not null references investigations(id) on delete cascade,
  position integer not null,
  title text not null,
  detail text,
  previous_value text,
  current_value text,
  impact_gbp numeric(12,2),
  confidence text check (confidence in ('high','medium','low')),
  attribution text check (attribution in ('measured','estimated','correlation'))
);

create table if not exists recommendations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  investigation_id uuid not null references investigations(id) on delete cascade,
  position integer not null,
  action text not null,
  rationale text,
  estimated_impact text,
  effort text check (effort in ('low','medium','high')),
  status text not null default 'open' check (status in ('open','done','dismissed')),
  created_at timestamptz not null default now()
);
