-- Stock, expiry and supplier order checks (capabilities adapted from the LarderCheck prototype).

-- Shelf life and storage drive the stock & expiry forecast.
alter table ingredients add column if not exists shelf_life_days integer check (shelf_life_days is null or shelf_life_days > 0);
alter table ingredients add column if not exists storage_area text;

-- What the invoice/receipt says, as printed.
alter table supplier_invoices add column if not exists order_ref text;
alter table supplier_invoice_lines add column if not exists expiry_date date;
alter table supplier_invoice_lines add column if not exists confidence text check (confidence is null or confidence in ('high','medium','low'));

-- Supplier order confirmations (from order emails or a CSV export). Invoices are checked against these.
create table if not exists supplier_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  order_ref text not null,
  status text not null default 'confirmed' check (status in ('confirmed','dispatched','delivered')),
  ordered_on date,
  delivery_date date not null,
  note text,
  uploaded_file_id uuid references uploaded_files(id) on delete set null,
  source text not null default 'import' check (source in ('demo','import')),
  created_at timestamptz not null default now(),
  unique (business_id, order_ref)
);
create index if not exists supplier_orders_delivery_idx on supplier_orders (business_id, delivery_date);

create table if not exists supplier_order_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_id uuid not null references supplier_orders(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete set null,
  description text not null,
  quantity numeric(12,4) not null check (quantity > 0), -- ingredient base unit
  unit text not null,
  unit_price numeric(12,4) not null check (unit_price >= 0) -- agreed price per base unit, ex VAT
);
create index if not exists supplier_order_lines_order_idx on supplier_order_lines (order_id);

-- New import source and extraction method.
alter table data_sources drop constraint if exists data_sources_kind_check;
alter table data_sources add constraint data_sources_kind_check check (kind in ('pos_sales','supplier_invoice','menu_recipes','delivery_settlement','waste','labour','supplier_orders'));
alter table uploaded_files drop constraint if exists uploaded_files_source_type_check;
alter table uploaded_files add constraint uploaded_files_source_type_check check (source_type in ('pos_sales','supplier_invoice','menu_recipes','delivery_settlement','waste','labour','supplier_orders'));
alter table uploaded_files drop constraint if exists uploaded_files_extraction_method_check;
alter table uploaded_files add constraint uploaded_files_extraction_method_check check (extraction_method in ('csv_parser','claude','demo_seed','preread_sample'));
