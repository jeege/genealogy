-- 参考定义；实际迁移由 backend/internal/database/migrations/001_init.sql 管理。
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
