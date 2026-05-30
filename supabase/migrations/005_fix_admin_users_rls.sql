-- Migration: 允许管理员读取所有用户数据
-- 问题: users 表 RLS 策略 "Users can read own data" 只允许读自己的数据
--       导致管理员仪表盘 JOIN users 时返回 null，显示"未知"

-- 添加管理员可读所有用户数据的策略
DROP POLICY IF EXISTS "Admins can read all users" ON public.users;
CREATE POLICY "Admins can read all users" ON public.users FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid())
);

-- 同样为 queue_entries 的 users join 添加管理员策略（已存在 users own or admins read queue，但 join 到 users 表仍被 users RLS 限制）
-- 以上 users 表策略已足够
