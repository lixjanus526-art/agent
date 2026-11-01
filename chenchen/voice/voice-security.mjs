import { Buffer } from 'node:buffer';
import { requireValue } from './voice-contract.mjs';
export const encode = value => Buffer.from(value).toString('base64url');
export async function digest(value) { return Buffer.from(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value)).toString('hex'); }
async function key(secret) { return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function signToken(claims, secret) {
  const data = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + encode(JSON.stringify(claims));
  return data + '.' + encode(await crypto.subtle.sign('HMAC', await key(secret), new TextEncoder().encode(data)));
}
export async function authenticate(request, env, now = Date.now()) {
  requireValue(typeof env.VOICE_AUTH_SECRET === 'string' && env.VOICE_AUTH_SECRET.length >= 32 && env.VOICE_TOKEN_ISSUER, 'VOICE_AUTH_NOT_CONFIGURED', 503);
  const authorization = request.headers.get('Authorization') || '';
  requireValue(/^Bearer [A-Za-z0-9_.-]{1,4096}$/.test(authorization), 'AUTHENTICATION_REQUIRED', 401);
  const token = authorization.slice(7).split('.');
  requireValue(token.length === 3 && token.every(x => x.length > 0), 'INVALID_TOKEN', 401);
  let header, claims;
  try { header = JSON.parse(Buffer.from(token[0], 'base64url')); claims = JSON.parse(Buffer.from(token[1], 'base64url')); } catch { requireValue(false, 'INVALID_TOKEN', 401); }
  requireValue(header?.alg === 'HS256' && header?.typ === 'JWT', 'INVALID_TOKEN', 401);
  const valid = await crypto.subtle.verify('HMAC', await key(env.VOICE_AUTH_SECRET), Buffer.from(token[2], 'base64url'), new TextEncoder().encode(token[0] + '.' + token[1]));
  requireValue(valid, 'INVALID_TOKEN', 401);
  const time = Math.floor(now / 1000);
  requireValue(claims?.iss === env.VOICE_TOKEN_ISSUER && claims.aud === 'voice-gateway' && Number.isInteger(claims.iat) && Number.isInteger(claims.exp) && claims.iat <= time && claims.exp > time && claims.exp - claims.iat <= 300 && (claims.nbf === undefined || (Number.isInteger(claims.nbf) && claims.nbf <= time)), 'TOKEN_EXPIRED_OR_INVALID', 401);
  requireValue(claims.scope === 'voice:transcribe' && claims.capability === 'REVIEW_ONLY', 'VOICE_SCOPE_DENIED', 403);
  for (const field of ['sub', 'account_id', 'jti']) requireValue(typeof claims[field] === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(claims[field]), 'INVALID_IDENTITY', 401);
  return { subject: claims.sub, account: claims.account_id, capability: 'REVIEW_ONLY' };
}
export function checkOrigin(request, env) {
  const allowed = String(env.VOICE_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  requireValue(allowed.length > 0 && !allowed.includes('*') && allowed.every(s => { try { const u = new URL(s); return u.origin === s && (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))); } catch { return false; } }), 'VOICE_CORS_NOT_CONFIGURED', 503);
  const origin = request.headers.get('Origin');
  requireValue(!origin || allowed.includes(origin), 'ORIGIN_DENIED', 403);
  return origin;
}
