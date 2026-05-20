'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    console.log('[LOGIN] handleSubmit called, mode:', mode, 'email:', email);

    if (loading) {
      console.log('[LOGIN] Already loading, skip');
      return;
    }

    setLoading(true);
    setError('');

    let supabase;
    try {
      supabase = createClient();
      console.log('[LOGIN] Supabase client created:', !!supabase);
    } catch (clientErr: any) {
      console.error('[LOGIN] Failed to create Supabase client:', clientErr);
      setError('Supabase 客户端初始化失败: ' + (clientErr.message || String(clientErr)));
      setLoading(false);
      return;
    }

    try {
      if (mode === 'register') {
        console.log('[LOGIN] Attempting signUp...');
        const { error: signUpError, data } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name: email.split('@')[0] },
          },
        });

        console.log('[LOGIN] signUp result:', { user: !!data.user, session: !!data.session, error: signUpError?.message });

        if (signUpError) {
          if (signUpError.message?.includes('rate limit')) {
            setError('注册请求过于频繁，请稍后再试');
          } else {
            throw signUpError;
          }
        } else if (data.user && !data.session) {
          setError('注册成功！但 Supabase 默认要求邮箱确认。\n请在 Supabase Dashboard → Authentication → Settings 中关闭"Confirm email"后再试。');
        } else if (data.session) {
          setError('注册成功！可直接登录');
        }
      } else {
        console.log('[LOGIN] Attempting signInWithPassword...');
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        console.log('[LOGIN] signIn result:', { user: !!data.user, session: !!data.session, error: signInError?.message });

        if (signInError) {
          if (signInError.message?.includes('Invalid login credentials')) {
            throw new Error('邮箱或密码错误，或账号尚未注册。请先注册账号。');
          }
          if (signInError.message?.includes('Email not confirmed')) {
            throw new Error('邮箱尚未确认，请先点击邮箱中的确认链接');
          }
          throw signInError;
        }

        if (data.session) {
          console.log('[LOGIN] Login success, fetching profile...');
          const { data: profile } = await supabase
            .from('users')
            .select('role')
            .eq('id', data.session.user.id)
            .single();

          const isAdmin = profile?.role === 'admin';
          console.log('[LOGIN] Role:', profile?.role, 'isAdmin:', isAdmin);
          router.push(isAdmin ? '/admin/dashboard' : '/user/dashboard');
        }
      }
    } catch (err: any) {
      console.error('[LOGIN] Error caught:', err.message || err);
      setError(err.message || '操作失败');
    } finally {
      console.log('[LOGIN] Setting loading false');
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-gradient-to-br from-blue-500 to-green-500 min-h-screen">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 mx-4">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">BUPT 校园充电站</h1>
          <p className="text-sm text-gray-500 mt-1">Supabase Auth · 真实数据</p>
          <p className="text-xs text-gray-400 mt-1">打开 F12 控制台查看调试日志</p>
        </div>

        {error && (
          <div className={`mb-4 p-3 border rounded-lg text-sm whitespace-pre-line ${error.includes('成功') ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="name@bupt.edu.cn"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="至少6位密码"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" required minLength={6} />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition">
            {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            className="text-sm text-blue-600 hover:text-blue-800">
            {mode === 'login' ? '没有账号？立即注册' : '已有账号？去登录'}
          </button>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-400 text-center mb-3">快速体验（模拟登录，无需Supabase）</p>
          <div className="flex gap-3">
            <button onClick={() => {
              localStorage.setItem('bupt_user', JSON.stringify({ id: 'user_demo', name: '演示用户', email: 'user@demo.com', role: 'user', phone: '13800000000', vehiclePlate: '京B88888', vehicleModel: 'BYD Han EV', batteryCapacity: 76.9 }));
              localStorage.setItem('bupt_role', 'user');
              router.push('/user/dashboard');
            }}
              className="flex-1 py-2 text-sm border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition">用户演示</button>
            <button onClick={() => {
              localStorage.setItem('bupt_user', JSON.stringify({ id: 'admin_demo', name: '管理员', email: 'admin@demo.com', role: 'admin', phone: '', vehiclePlate: '', vehicleModel: '', batteryCapacity: 0 }));
              localStorage.setItem('bupt_role', 'admin');
              router.push('/admin/dashboard');
            }}
              className="flex-1 py-2 text-sm border border-green-300 text-green-600 rounded-lg hover:bg-green-50 transition">管理员演示</button>
          </div>
        </div>
      </div>
    </div>
  );
}
