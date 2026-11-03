/**
 * Minimal HS256 JWT sign/verify using Web Crypto. Replaces Supabase Auth's
 * JWT issuance — same idea (short-lived access token + longer refresh token).
 */
function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signJWT(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds: number
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${base64url(sig)}`;
}

export async function verifyJWT<T = Record<string, unknown>>(token: string, secret: string): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sigB64] = parts;
  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlDecode(sigB64),
      new TextEncoder().encode(`${headerB64}.${bodyB64}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(bodyB64)));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload as T;
  } catch {
    return null;
  }
}
