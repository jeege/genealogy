-- 成员照片：一位成员可挂多张，按 sort_order 排序。
--
-- 原图与缩略图都落在磁盘（PHOTO_STORAGE_DIR），数据库只记录相对路径与元信息：
-- 这样备份数据库不会把二进制一起卷进来，迁移存储位置也只需搬目录。
-- 路径统一使用正斜杠的相对路径，由后端拼成 URL，避免把主机名写死进库。
CREATE TABLE IF NOT EXISTS public.member_photos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id bigint NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
  -- 相对 PHOTO_STORAGE_DIR 的路径，如 "12/20261029-abc123.jpg"。
  original_path text NOT NULL,
  thumbnail_path text NOT NULL,
  -- 原图像素尺寸，前端用于预留占位比例、避免加载后跳动。
  width integer NOT NULL DEFAULT 0,
  height integer NOT NULL DEFAULT 0,
  -- 原文件字节数，便于展示与后续配额统计。
  byte_size bigint NOT NULL DEFAULT 0,
  -- 说明文字，如「民国三十年摄于福州」。
  caption text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 详情页按成员取照片，并保持用户排序。
CREATE INDEX IF NOT EXISTS member_photos_member_idx
  ON public.member_photos(member_id, sort_order, id);
