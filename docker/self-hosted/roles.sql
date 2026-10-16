\getenv auth_password AUTH_DB_PASSWORD
\getenv rest_password REST_DB_PASSWORD

-- 仅新建空数据库时执行；Auth 自己负责 auth.* 表与后续迁移。
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD :'rest_password';
GRANT anon, authenticated, service_role TO authenticator;
CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE NOREPLICATION PASSWORD :'auth_password';
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
GRANT CREATE ON DATABASE postgres TO supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path TO auth;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 提前提供 helper；所有者为 Auth admin，GoTrue 启动迁移可以安全替换它。
SET ROLE supabase_auth_admin;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
RESET ROLE;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
