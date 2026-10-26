-- 结构化配偶关系：一段婚姻连接两位成员，支持多段婚姻与起止时间。
-- family_members.spouse 文本字段保留为「配偶备注」，兼容旧数据与导入模板。
CREATE TABLE IF NOT EXISTS public.marriages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  husband_id bigint NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
  wife_id bigint REFERENCES public.family_members(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'married'
    CHECK (status IN ('married', 'divorced', 'widowed')),
  married_on date,
  divorced_on date,
  married_on_raw text,
  divorced_on_raw text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marriages_distinct_partners CHECK (wife_id IS NULL OR husband_id <> wife_id)
);

CREATE INDEX IF NOT EXISTS idx_marriages_husband ON public.marriages(husband_id);
CREATE INDEX IF NOT EXISTS idx_marriages_wife ON public.marriages(wife_id);
-- 同一对成员最多一段有效婚姻记录（配偶文本姓名不参与唯一性判断）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_marriages_pair
  ON public.marriages(husband_id, wife_id)
  WHERE wife_id IS NOT NULL;
