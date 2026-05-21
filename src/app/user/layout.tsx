'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';

const navItems = [
  { href: '/user/dashboard', label: '充电监控', icon: '⚡' },
  { href: '/user/charge', label: '发起充电', icon: '🔌' },
  { href: '/user/queue', label: '排队状态', icon: '📋' },
  { href: '/user/bills', label: '我的账单', icon: '💰' },
  { href: '/user/notifications', label: '通知中心', icon: '🔔' },
];

export default function UserLayout({ children }: { children: React.ReactNode }) {
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
          setUserName(profile?.name || user.email?.split('@')[0] || '用户');
          return;
        }
      } catch { /* fallback to localStorage */ }

      // Demo fallback
      const stored = localStorage.getItem('bupt_user');
      if (stored && localStorage.getItem('bupt_role') === 'user') {
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
      <aside className="w-60 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="p-5 border-b border-gray-700">
          <h1 className="text-lg font-bold">BUPT 充电站</h1>
          <p className="text-xs text-gray-400 mt-1">欢迎，{userName || '...'}</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${pathname === item.href ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}>
              <span>{item.icon}</span>{item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-700">
          <button onClick={logout} className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800 transition">
            <span>🚪</span>退出
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-auto bg-gray-50">{children}</main>
    </div>
  );
}
