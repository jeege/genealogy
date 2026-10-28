-- 移除配偶备注文本列。
--
-- 结构化的配偶关系已经由 marriages 表完整表达（关系图会为配偶建立独立节点），
-- family_members.spouse 只剩下历史遗留的自由文本，不再有任何写入路径。
-- 该列的旧数据已确认清理完毕，这里直接删除，避免两套配偶数据继续并存。

ALTER TABLE public.family_members DROP COLUMN IF EXISTS spouse;
