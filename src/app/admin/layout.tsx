'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';

const navItems = [
  { href: '/admin/dashboard', label: '实时监控', icon: '📊' },
  { href: '/admin/requests', label: '请求审核', icon: '✅' },
  { href: '/admin/queue', label: '队列管理', icon: '📋' },
  { href: '/admin/faults', label: '故障处理', icon: '⚠️' },
  { href: '/admin/overtime', label: '超时管理', icon: '⏰' },
  { href: '/admin/bills', label: '账单管理', icon: '💰' },
  { href: '/admin/reports', label: '运营报表', icon: '📈' },
  { href: '/admin/config', label: '参数配置', icon: '⚙️' },
  { href: '/admin/stations', label: '充电桩管理', icon: '🔌' },
  { href: '/admin/maintenance', label: '数据维护', icon: '🗄️' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [userName, setUserName] = useState('');

  useEffect(() => {
    async function loadUser() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('users').select('name').eq('id', user.id).single();
          setUserName(profile?.name || user.email?.split('@')[0] || '管理员');
          return;
        }
      } catch { /* fallback */ }

      const stored = localStorage.getItem('bupt_user');
      if (stored && localStorage.getItem('bupt_role') === 'admin') {
        setUserName(JSON.parse(stored).name);
        return;
      }
      router.push('/');
    }
    loadUser();
  }, [router]);

  function logout() {
    localStorage.removeItem('bupt_user');
    localStorage.removeItem('bupt_role');
    document.cookie.split(';').forEach(c => {
      document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/');
    });
    router.push('/');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-lg font-bold">BUPT 管理后台</h1>
          <p className="text-xs text-gray-400 mt-1">{userName || '...'}</p>
        </div>
        <nav className="flex-1 p-2 overflow-y-auto space-y-0.5">
          {navItems.map(item => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${pathname === item.href ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}>
              <span>{item.icon}</span>{item.label}
            </Link>
          ))}
        </nav>
        <div className="p-2 border-t border-gray-700">
          <button onClick={logout} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 transition">
            <span>🚪</span>退出
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-auto bg-gray-50">{children}</main>
    </div>
  );
}
