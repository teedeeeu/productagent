-- Agent Commerce QA — initial schema
--
-- Tenancy model: every row belongs to one organization. Row-level security
-- (RLS) only lets a signed-in user see rows of their own organization.
-- Shopify access tokens live in store_credentials, which has RLS enabled and
-- NO policies: only the server (service-role key) can read it, never a browser.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Organizations & users
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  -- Cost guardrails, adjustable per organization
  max_products_per_scan integer not null default 500 check (max_products_per_scan between 1 and 10000),
  max_llm_calls_per_scan integer not null default 100 check (max_llm_calls_per_scan between 0 and 5000),
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now()
);
create index users_organization_id_idx on public.users (organization_id);

-- Returns the organization of the signed-in user. SECURITY DEFINER so RLS
-- policies can call it without recursing into the users table's own policy.
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.users where id = auth.uid()
$$;
revoke all on function public.current_organization_id() from public;
grant execute on function public.current_organization_id() to authenticated;

-- On sign-up: create a personal organization and the user profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_id uuid;
begin
  insert into public.organizations (name)
  values (coalesce(nullif(new.raw_user_meta_data ->> 'company', ''), split_part(coalesce(new.email, 'My'), '@', 1) || '''s store'))
  returning id into org_id;

  insert into public.users (id, organization_id, email, full_name)
  values (new.id, org_id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Stores
-- ---------------------------------------------------------------------------

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  platform text not null default 'csv' check (platform in ('csv', 'shopify')),
  shop_domain text, -- e.g. my-store.myshopify.com
  shopify_scopes text,
  connection_status text not null default 'not_connected'
    check (connection_status in ('not_connected', 'connected', 'error', 'disconnected')),
  connected_at timestamptz,
  last_import_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stores_organization_id_idx on public.stores (organization_id);
create unique index stores_shop_domain_uidx on public.stores (shop_domain) where shop_domain is not null;

-- Server-only secrets. RLS enabled with no policies = no access for anon or
-- authenticated users. Tokens are additionally encrypted by the app
-- (AES-256-GCM, key in TOKEN_ENCRYPTION_KEY) before being stored.
create table public.store_credentials (
  store_id uuid primary key references public.stores (id) on delete cascade,
  encrypted_access_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  external_id text not null,          -- Shopify GID, handle, or CSV product id
  title text not null,
  description_html text not null default '',
  vendor text,
  product_type text,
  product_url text,
  category text not null default 'unknown',
  specifications jsonb not null default '[]'::jsonb, -- [{key, value}]
  metafields jsonb not null default '[]'::jsonb,     -- [{key, value}]
  variants jsonb not null default '[]'::jsonb,       -- [{title, sku, options}]
  manufacturer_url text,
  content_hash text,                   -- detects unchanged products on re-import
  import_source text not null default 'csv' check (import_source in ('csv', 'shopify')),
  scan_status text not null default 'not_scanned'
    check (scan_status in ('not_scanned', 'scanned', 'error')),
  last_scanned_at timestamptz,
  open_findings_count integer not null default 0,
  highest_severity text check (highest_severity in ('critical', 'high', 'medium', 'low')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, external_id)
);
create index products_organization_id_idx on public.products (organization_id);
create index products_store_id_idx on public.products (store_id);
create index products_title_search_idx on public.products using gin (to_tsvector('simple', title));

-- Normalized values extracted by the scanner, with where each came from.
create table public.product_attributes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  scan_id uuid,
  attribute_key text not null,
  value_number numeric,   -- in base unit: kg, cm, km/h, W, %
  value_boolean boolean,
  value_text text,        -- display text as written by the merchant
  source_field text not null
    check (source_field in ('title', 'description', 'specifications', 'metafield', 'variant', 'manufacturer')),
  source_key text,
  snippet text not null,
  certainty text not null default 'explicit' check (certainty in ('explicit', 'inferred')),
  created_at timestamptz not null default now()
);
create index product_attributes_product_id_idx on public.product_attributes (product_id);
create index product_attributes_organization_id_idx on public.product_attributes (organization_id);

-- ---------------------------------------------------------------------------
-- Scans & findings
-- ---------------------------------------------------------------------------

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'completed', 'partial', 'failed')),
  products_total integer not null default 0,
  products_scanned integer not null default 0,
  products_with_issues integer not null default 0,
  findings_count integer not null default 0,
  findings_by_severity jsonb not null default '{"critical":0,"high":0,"medium":0,"low":0}'::jsonb,
  llm_calls integer not null default 0,
  llm_enabled boolean not null default false,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references public.users (id) on delete set null
);
alter table public.product_attributes
  add constraint product_attributes_scan_id_fkey foreign key (scan_id) references public.scans (id) on delete set null;
create index scans_organization_id_idx on public.scans (organization_id);
create index scans_store_started_idx on public.scans (store_id, started_at desc);

-- One row per distinct issue per product. Re-scans update the row (keeping the
-- merchant's review decision) instead of creating duplicates.
create table public.findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  first_seen_scan_id uuid references public.scans (id) on delete set null,
  last_seen_scan_id uuid references public.scans (id) on delete set null,
  fingerprint text not null,
  issue_type text not null check (issue_type in ('contradiction', 'missing_attribute', 'ambiguous', 'misleading')),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  verification_status text not null
    check (verification_status in ('unverified', 'needs_verification', 'manufacturer_verified')),
  attributes text[] not null default '{}',
  title text not null,
  evidence jsonb not null default '[]'::jsonb,              -- [{source, sourceLabel, text, value}]
  explanation text not null,
  recommended_action text not null,
  suggested_corrections jsonb not null default '[]'::jsonb,
  detector text not null default 'rules' check (detector in ('rules', 'llm')),
  -- Merchant review. 'resolved' is set automatically when a re-scan no longer finds the issue.
  status text not null default 'open' check (status in ('open', 'dismissed', 'resolved')),
  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, fingerprint)
);
create index findings_organization_id_idx on public.findings (organization_id);
create index findings_product_id_idx on public.findings (product_id);
create index findings_store_status_severity_idx on public.findings (store_id, status, severity);
create index findings_last_seen_scan_idx on public.findings (last_seen_scan_id);

-- ---------------------------------------------------------------------------
-- Manufacturer references (entered manually by the merchant)
-- ---------------------------------------------------------------------------

create table public.manufacturer_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  attribute_label text not null check (char_length(attribute_label) between 1 and 200),
  value_text text not null check (char_length(value_text) between 1 and 500),
  source_url text check (source_url is null or source_url ~* '^https?://'),
  evidence_text text,  -- exact quote from the manufacturer document
  entered_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index manufacturer_references_product_id_idx on public.manufacturer_references (product_id);
create index manufacturer_references_organization_id_idx on public.manufacturer_references (organization_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger stores_updated_at before update on public.stores for each row execute function public.set_updated_at();
create trigger store_credentials_updated_at before update on public.store_credentials for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger findings_updated_at before update on public.findings for each row execute function public.set_updated_at();
create trigger manufacturer_references_updated_at before update on public.manufacturer_references for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.stores enable row level security;
alter table public.store_credentials enable row level security;
alter table public.products enable row level security;
alter table public.product_attributes enable row level security;
alter table public.scans enable row level security;
alter table public.findings enable row level security;
alter table public.manufacturer_references enable row level security;

create policy "members read own organization" on public.organizations
  for select to authenticated using (id = public.current_organization_id());
create policy "owners update own organization" on public.organizations
  for update to authenticated
  using (id = public.current_organization_id())
  with check (id = public.current_organization_id());

create policy "members read users in own organization" on public.users
  for select to authenticated using (organization_id = public.current_organization_id());
create policy "users update own profile" on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and organization_id = public.current_organization_id());

-- Same pattern for every tenant table: full access within own organization.
do $$
declare
  t text;
begin
  foreach t in array array['stores', 'products', 'product_attributes', 'scans', 'findings', 'manufacturer_references']
  loop
    execute format(
      'create policy "org members manage %1$s" on public.%1$I for all to authenticated
         using (organization_id = public.current_organization_id())
         with check (organization_id = public.current_organization_id())',
      t
    );
  end loop;
end;
$$;

-- Child rows must point at a parent in the same organization (defense in
-- depth: stops a crafted request from attaching rows to another tenant's product).
create or replace function public.check_same_organization()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  parent_org uuid;
begin
  if tg_table_name in ('products', 'scans') then
    select organization_id into parent_org from public.stores where id = new.store_id;
  else
    select organization_id into parent_org from public.products where id = new.product_id;
  end if;
  if parent_org is null or parent_org <> new.organization_id then
    raise exception 'organization mismatch on %', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger products_same_org before insert or update on public.products for each row execute function public.check_same_organization();
create trigger scans_same_org before insert or update on public.scans for each row execute function public.check_same_organization();
create trigger findings_same_org before insert or update on public.findings for each row execute function public.check_same_organization();
create trigger product_attributes_same_org before insert or update on public.product_attributes for each row execute function public.check_same_organization();
create trigger manufacturer_references_same_org before insert or update on public.manufacturer_references for each row execute function public.check_same_organization();

-- store_credentials: intentionally no policies (server-only).
revoke all on public.store_credentials from anon, authenticated;
