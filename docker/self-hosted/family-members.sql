-- 可在外部 Supabase 的 SQL Editor 直接执行；新安装只需执行一次。
BEGIN;
CREATE TABLE public.family_members (
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
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX idx_family_members_father_id ON public.family_members(father_id);
CREATE INDEX idx_family_members_name ON public.family_members(name);
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
-- 一个部署共享一份族谱；仅已登录用户可操作，不是多租户权限模型。
CREATE POLICY family_members_authenticated ON public.family_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
REVOKE ALL ON public.family_members FROM anon;
REVOKE ALL ON SEQUENCE public.family_members_id_seq FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_members TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.family_members_id_seq TO authenticated, service_role;
COMMIT;
