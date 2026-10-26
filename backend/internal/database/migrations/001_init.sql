-- 自建认证与族谱数据结构。应用启动时自动执行，已执行版本记录在 schema_migrations。
CREATE TABLE IF NOT EXISTS public.users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON public.users (lower(email));

CREATE TABLE IF NOT EXISTS public.sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON public.sessions(expires_at);

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON public.password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx ON public.password_reset_tokens(expires_at);

CREATE TABLE IF NOT EXISTS public.family_members (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  generation integer,
  sibling_order integer,
  father_id bigint REFERENCES public.family_members(id),
  gender text CHECK (gender IN ('男', '女')),
  official_position text,
  is_alive boolean DEFAULT true,
  spouse text,
  remarks text,
  birthday date,
  death_date date,
  residence_place text,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_family_members_father_id ON public.family_members(father_id);
CREATE INDEX IF NOT EXISTS idx_family_members_name ON public.family_members(name);
CREATE INDEX IF NOT EXISTS idx_family_members_order ON public.family_members(generation, sibling_order, id);

-- 本系统使用独立数据库角色直接访问，不依赖 Supabase RLS。
-- 兼容从旧 Supabase 数据库迁移时残留的 RLS 策略。
ALTER TABLE public.family_members DISABLE ROW LEVEL SECURITY;
