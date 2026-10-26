-- 保留 GEDCOM 原始日期表达式（如「ABT 1850」「BEF 12 MAR 1900」），
-- 使用户在 Excel 之外的 GEDCOM 往返导入导出时不丢失日期精度。
ALTER TABLE public.family_members ADD COLUMN IF NOT EXISTS birth_date_raw text;
ALTER TABLE public.family_members ADD COLUMN IF NOT EXISTS death_date_raw text;
