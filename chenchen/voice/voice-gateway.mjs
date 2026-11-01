import { authenticate, checkOrigin, digest } from './voice-security.mjs';
import { requireValue, identifier, failure } from './voice-contract.mjs';
export { VoiceSession } from './voice-session.mjs';
export { VoiceQuota } from './voice-quota.mjs';
export default { async fetch(request, env) {
  let origin;
  try {
    origin = checkOrigin(request, env);
    const url = new URL(request.url);
    requireValue(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)), 'HTTPS_REQUIRED', 400);
    requireValue(!url.search, 'QUERY_NOT_ALLOWED');
    const match = /^\/api\/voice\/sessions(?:\/([A-Za-z0-9_-]{8,100})(\/audio)?)?$/.exec(url.pathname);
    requireValue(match, 'NOT_FOUND', 404);
    if (request.method === 'OPTIONS') {
      requireValue(origin && ['POST', 'GET', 'DELETE'].includes(request.headers.get('Access-Control-Request-Method')), 'PREFLIGHT_DENIED', 403);
      const headers = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
      requireValue(headers.every(h => ['authorization', 'content-type', 'x-request-id', 'x-audio-consent', 'x-voice-language'].includes(h)), 'PREFLIGHT_DENIED', 403);
      return withCors(new Response(null, { status: 204 }), origin);
    }
    const principal = await authenticate(request, env);
    requireValue(env.VOICE_SESSIONS && env.VOICE_QUOTA, 'VOICE_STORAGE_NOT_CONFIGURED', 503);
    const create = !match[1] && request.method === 'POST';
    requireValue(create || (match[1] && ((!match[2] && ['GET', 'DELETE'].includes(request.method)) || (match[2] && request.method === 'POST'))), 'METHOD_NOT_ALLOWED', 405);
    if (create) requireValue(!request.body, 'SESSION_BODY_NOT_ALLOWED');
    const sid = create ? 'voice-' + crypto.randomUUID() : identifier(match[1]);
    const owner = await digest(JSON.stringify([principal.subject, principal.account]));
    const objectId = env.VOICE_SESSIONS.idFromName(await digest(owner + ':' + sid));
    const headers = new Headers();
    for (const name of ['Content-Type', 'Content-Length', 'X-Request-ID', 'X-Audio-Consent', 'X-Voice-Language']) { const value = request.headers.get(name); if (value !== null) headers.set(name, value); }
    headers.set('X-Voice-Internal', env.VOICE_AUTH_SECRET); headers.set('X-Voice-Owner', owner); headers.set('X-Voice-Session', sid);
    const internal = new Request('https://voice.internal/' + (create ? 'create' : match[2] ? 'audio' : 'session'), { method: request.method, headers,
      ...(match[2] ? { body: request.body, duplex: 'half' } : {}), signal: request.signal });
    const response = await env.VOICE_SESSIONS.get(objectId).fetch(internal);
    return withCors(response, origin);
  } catch (error) { return withCors(failure(error), origin); }
} };
function withCors(response, origin) {
  const result = new Response(response.body, response);
  if (origin) { result.headers.set('Access-Control-Allow-Origin', origin); result.headers.set('Vary', 'Origin'); result.headers.set('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS'); result.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-ID, X-Audio-Consent, X-Voice-Language'); }
  return result;
}
