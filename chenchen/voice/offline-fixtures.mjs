import { VoiceSession } from './voice-session.mjs';
import { VoiceQuota } from './voice-quota.mjs';
import { signToken } from './voice-security.mjs';
import worker from './voice-gateway.mjs';
export function wav(durationMs = 1000) {
  const bytes = new Uint8Array(44 + durationMs * 32), view = new DataView(bytes.buffer);
  const put = (offset, text) => bytes.set(new TextEncoder().encode(text), offset);
  put(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); put(8, 'WAVE'); put(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  put(36, 'data'); view.setUint32(40, bytes.length - 44, true); return bytes;
}
export function memoryStorage() {
  const data = new Map();
  const storage = { data, get: async key => structuredClone(data.get(key)), put: async (key, value) => data.set(key, structuredClone(value)),
    transaction: async operation => operation(storage), setAlarm: async () => {}, deleteAll: async () => data.clear() };
  return storage;
}
function namespace(Type, env) {
  const objects = new Map();
  return { objects, idFromName: name => name, get(id) {
    if (!objects.has(id)) {
      const storage = memoryStorage(); storage.transaction = async fn => fn(storage);
      objects.set(id, { storage, instance: new Type({ storage }, env) });
    }
    return objects.get(id).instance;
  } };
}
export function setup() {
  const env = { VOICE_AUTH_SECRET: 'synthetic-secret-at-least-32-characters', VOICE_TOKEN_ISSUER: 'synthetic-identity-owner',
    VOICE_ALLOWED_ORIGINS: 'https://bank.test', VOICE_ASR_ENABLED: 'true', VOICE_ASR_REGION: 'cn-beijing', VOICE_ASR_MODEL: 'qwen3-asr-flash',
    DASHSCOPE_API_KEY: 'synthetic-asr-key', VOICE_DAILY_AUDIO_SECONDS: '120', VOICE_TOTAL_AUDIO_SECONDS: '240' };
  env.VOICE_SESSIONS = namespace(VoiceSession, env); env.VOICE_QUOTA = namespace(VoiceQuota, env);
  const claims = patch => ({ iss: env.VOICE_TOKEN_ISSUER, aud: 'voice-gateway', sub: 'alice', account_id: 'demo-alice', jti: 'token-test',
    scope: 'voice:transcribe', capability: 'REVIEW_ONLY', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 240, ...patch });
  async function token(patch) { return signToken(claims(patch), env.VOICE_AUTH_SECRET); }
  async function request(path = '', options = {}, identity = {}) {
    const headers = new Headers({ Origin: 'https://bank.test', Authorization: 'Bearer ' + await token(identity), ...options.headers });
    return worker.fetch(new Request('https://voice.test/api/voice/sessions' + path, { ...options, headers }), env);
  }
  async function create(identity) { const r = await request('', { method: 'POST' }, identity); if (r.status !== 201) throw new Error(await r.text()); return (await r.json()).session_id; }
  async function upload(sid, options = {}, identity) {
    return request('/' + sid + '/audio', { method: 'POST', body: wav(), ...options,
      headers: { 'Content-Type': 'audio/wav', 'X-Audio-Consent': 'true', 'X-Request-ID': 'request-one', ...options.headers } }, identity);
  }
  return { env, request, create, upload, token, claims };
}
