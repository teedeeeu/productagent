-- Supabase grants table privileges to these roles by default; mirror that here.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
revoke all on public.store_credentials from anon, authenticated;
