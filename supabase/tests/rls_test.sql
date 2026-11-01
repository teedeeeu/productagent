-- Tenant-isolation tests. Run: npm run test:db (see README). Fails loudly on any leak.
\set ON_ERROR_STOP on
begin;

-- Two merchants sign up (trigger creates their organizations)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@a.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@b.test');

-- Seed data as the server (bypasses RLS)
set local role service_role;
insert into public.stores (id, organization_id, name)
  select '10000000-0000-0000-0000-00000000000a', organization_id, 'Alice store' from public.users where email = 'alice@a.test';
insert into public.stores (id, organization_id, name)
  select '10000000-0000-0000-0000-00000000000b', organization_id, 'Bob store' from public.users where email = 'bob@b.test';
insert into public.products (id, organization_id, store_id, external_id, title)
  select '20000000-0000-0000-0000-00000000000b', organization_id, id, 'p1', 'Bob product' from public.stores where name = 'Bob store';
insert into public.store_credentials (store_id, encrypted_access_token)
  values ('10000000-0000-0000-0000-00000000000b', 'enc:secret');
do $$ begin perform set_config('test.bob_org', (select organization_id::text from public.users where email = 'bob@b.test'), true); end $$;
reset role;

-- Act as Alice
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

do $$
begin
  if (select count(*) from public.stores) <> 1 then raise exception 'Alice sees % stores', (select count(*) from public.stores); end if;
  if (select name from public.stores) <> 'Alice store' then raise exception 'Alice sees wrong store'; end if;
  if exists (select 1 from public.products) then raise exception 'Alice can read Bob''s products'; end if;
  if (select count(*) from public.organizations) <> 1 then raise exception 'Alice sees other organizations'; end if;
  if (select count(*) from public.users) <> 1 then raise exception 'Alice sees other users'; end if;
end $$;

-- Alice cannot write into Bob's organization, either by naming Bob's
-- organization directly or by pointing at Bob's store from her own.
do $$
begin
  begin
    insert into public.products (organization_id, store_id, external_id, title)
      values (current_setting('test.bob_org')::uuid, '10000000-0000-0000-0000-00000000000b', 'x', 'smuggled');
    raise exception 'LEAK: Alice inserted a row into Bob''s organization';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.products (organization_id, store_id, external_id, title)
      values (public.current_organization_id(), '10000000-0000-0000-0000-00000000000b', 'x', 'smuggled');
    raise exception 'LEAK: Alice attached a product to Bob''s store';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Alice cannot update or delete Bob's rows (affects zero rows)
update public.products set title = 'hacked' where id = '20000000-0000-0000-0000-00000000000b';
delete from public.stores where id = '10000000-0000-0000-0000-00000000000b';

-- Alice cannot read tokens at all, not even her own organization's
do $$
begin
  begin
    perform 1 from public.store_credentials;
    raise exception 'LEAK: authenticated role can read store_credentials';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Alice can work within her own organization
insert into public.products (organization_id, store_id, external_id, title)
  values (public.current_organization_id(), '10000000-0000-0000-0000-00000000000a', 'a1', 'Alice product');
reset role;

-- Verify Bob's data is untouched
do $$
begin
  if (select title from public.products where id = '20000000-0000-0000-0000-00000000000b') <> 'Bob product' then raise exception 'Bob''s product was modified'; end if;
  if not exists (select 1 from public.stores where id = '10000000-0000-0000-0000-00000000000b') then raise exception 'Bob''s store was deleted'; end if;
end $$;

-- Anonymous visitors see nothing
set local role anon;
do $$
begin
  begin
    perform 1 from public.products;
    if found then raise exception 'LEAK: anon can read products'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'RLS tests passed'
rollback;
