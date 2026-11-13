import {createHash, createHmac, timingSafeEqual} from 'node:crypto';

const COOKIE = 'scorebug_session';
const AGE = 7 * 24 * 60 * 60;

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

export function equal(left, right) {
  return timingSafeEqual(digest(left), digest(right));
}

function signature(secret, purpose) {
  return createHmac('sha256', secret).update(purpose).digest('base64url');
}

export function overlayKey(secret) {
  return signature(secret, 'scorebug:overlay:v1');
}

export function operatorSession(request, secret) {
  const cookie = request.headers.get('cookie')?.split(';').map(item => item.trim())
    .find(item => item.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (!cookie) return false;
  const [expires, token] = cookie.split('.');
  const time = Number(expires);
  const now = Math.floor(Date.now() / 1000);
  return Number.isSafeInteger(time) && time > now && time <= now + AGE &&
    Boolean(token) && equal(token, signature(secret, 'scorebug:operator:' + expires));
}

export function sessionCookie(request, secret, signOut = false) {
  const expires = Math.floor(Date.now() / 1000) + AGE;
  const value = signOut ? '' : expires + '.' + signature(secret, 'scorebug:operator:' + expires);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Max-Age=${signOut ? 0 : AGE}; HttpOnly; Path=/; SameSite=Strict${secure}`;
}
