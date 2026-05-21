const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

async function request(path, options = {}, bearer = anon) {
  const res = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const email = `codex-probe-${Date.now()}@example.com`;
const password = 'Test123456';

const signup = await request('/auth/v1/signup', {
  method: 'POST',
  body: JSON.stringify({
    email,
    password,
    data: { name: 'Codex Probe' },
  }),
});

console.log('signup_status=', signup.status);
console.log('signup_error=', signup.body?.msg || signup.body?.error_description || signup.body?.message || '');
const token = signup.body?.access_token;
const userId = signup.body?.user?.id;
console.log('has_session=', Boolean(token));
console.log('user_id=', userId || '');

if (!token || !userId) {
  console.log('result=blocked_auth_confirmation_or_signup');
  process.exit(0);
}

const insert = await request('/rest/v1/charging_orders?select=*', {
  method: 'POST',
  body: JSON.stringify({
    user_id: userId,
    mode: 'fast',
    status: 'pending',
    request_battery_level: 0,
    target_battery_level: 10,
  }),
}, token);

console.log('insert_order_status=', insert.status);
console.log('insert_order_error=', insert.body?.message || insert.body?.msg || '');
const orderId = Array.isArray(insert.body) ? insert.body[0]?.id : insert.body?.id;
console.log('insert_order_id=', orderId || '');

if (orderId) {
  const del = await request(`/rest/v1/charging_orders?id=eq.${orderId}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  }, token);
  console.log('delete_order_status=', del.status);
}
