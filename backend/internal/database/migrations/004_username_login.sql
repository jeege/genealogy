-- 登录标识从邮箱改为用户名。
--
-- 旧版本用 email 列存储登录名（可能本身就是用户名），这里原位改名并放开
-- 字符集限制；不再需要邮箱唯一索引的 lower(email) 语义，改按 lower(username)
-- 唯一，保持「大小写不敏感」的登录体验。
--
-- 同时删除密码重置相关结构与 SMTP 流程：忘记密码功能已移除，
-- 管理员通过 `user set-password` 命令重置。

ALTER TABLE public.users RENAME COLUMN email TO username;

DROP INDEX IF EXISTS public.users_email_lower_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON public.users (lower(username));

-- 密码重置令牌表不再使用。
DROP TABLE IF EXISTS public.password_reset_tokens;
