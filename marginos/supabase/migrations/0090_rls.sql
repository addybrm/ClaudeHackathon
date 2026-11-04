-- Supabase only (not applied to the local PGlite database, which has no auth schema).
-- Business-level isolation: a signed-in user can only see rows for businesses they belong to.
-- The server uses the service-role key, which bypasses RLS and must never reach the browser.

alter table users add column if not exists auth_user_id uuid unique;

create or replace function public.is_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.business_id = b and u.auth_user_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'data_sources','uploaded_files','suppliers','ingredients','supplier_invoices',
    'supplier_invoice_lines','menu_items','recipes','recipe_ingredients','sales_channels',
    'sales','sale_items','delivery_fees','waste_records','labour_records','investigations',
    'investigation_findings','recommendations','users','supplier_orders','supplier_order_lines'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists member_access on %I', t);
    execute format('create policy member_access on %I for all using (public.is_member(business_id)) with check (public.is_member(business_id))', t);
  end loop;
end $$;

alter table businesses enable row level security;
drop policy if exists member_access on businesses;
create policy member_access on businesses for all using (public.is_member(id)) with check (public.is_member(id));
