// Thin API client. Token lives in sessionStorage only (cleared when the tab/app closes).
let token = null;
try { token = sessionStorage.getItem('mh_token'); } catch { /* storage unavailable */ }
export const getToken = () => token;
export function setToken(t) { token = t; try { t ? sessionStorage.setItem('mh_token', t) : sessionStorage.removeItem('mh_token'); } catch { /* ignore */ } }
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (f) => (onUnauthorized = f);

export async function api(method, path, body, opts = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  let payload;
  if (opts.raw) payload = body; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, { method, headers, body: payload }); } catch { throw new Error('تعذر الاتصال بالخادم. تحقق من الشبكة.'); }
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== '/api/auth/login') { setToken(null); onUnauthorized(); }
  if (!res.ok) { const e = new Error(data?.error ?? 'حدث خطأ'); e.status = res.status; e.data = data; throw e; }
  return data;
}
