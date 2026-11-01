import { envelope, failure, publicError, json, requireValue, identifier, readBounded, inspectWav, MAX_BYTES, SESSION_TTL_MS, VoiceError } from './voice-contract.mjs';
import { digest } from './voice-security.mjs';
import { transcribe, providerConfig } from './asr-provider.mjs';
export async function reserve(env, owner, seconds) {
  const response = await env.VOICE_QUOTA.get(env.VOICE_QUOTA.idFromName('account-global')).fetch(new Request('https://voice.internal/quota', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voice-Internal': env.VOICE_AUTH_SECRET }, body: JSON.stringify({ owner, ...(seconds === undefined ? {} : { seconds }) }) }));
  if (!response.ok) { const data = await response.json(); throw new VoiceError(data.error?.code || 'QUOTA_UNAVAILABLE', response.status); }
}
export class VoiceSession {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.queue = Promise.resolve(); }
  fetch(request) {
    if (request.method === 'DELETE' && this.env.VOICE_AUTH_SECRET?.length >= 32 && request.headers.get('X-Voice-Internal') === this.env.VOICE_AUTH_SECRET && request.headers.get('X-Voice-Owner') === this.processingOwner) this.controller?.abort();
    const job = this.queue.then(() => this.handle(request));
    this.queue = job.catch(() => {}); return job.catch(failure);
  }
  async handle(request) {
    requireValue(this.env.VOICE_AUTH_SECRET?.length >= 32 && request.headers.get('X-Voice-Internal') === this.env.VOICE_AUTH_SECRET, 'INTERNAL_AUTH_REQUIRED', 403);
    const owner = request.headers.get('X-Voice-Owner'), sid = identifier(request.headers.get('X-Voice-Session'));
    requireValue(/^[a-f0-9]{64}$/.test(owner || ''), 'INVALID_IDENTITY', 403);
    let session = await this.ctx.storage.get('session');
    if (request.method === 'POST' && new URL(request.url).pathname === '/create') {
      requireValue(!session, 'SESSION_EXISTS', 409);
      await reserve(this.env, owner);
      session = { owner, sid, expires: Date.now() + SESSION_TTL_MS, status: 'READY' };
      await this.ctx.storage.put('session', session); await this.ctx.storage.setAlarm(session.expires);
      return json(envelope({ session_id: sid, status: 'READY', expires_at: session.expires }), 201);
    }
    requireValue(session && session.owner === owner && session.sid === sid, 'SESSION_NOT_FOUND', 404);
    requireValue(session.expires > Date.now(), 'SESSION_EXPIRED', 410);
    if (request.method === 'GET') {
      return json(session.result || envelope({ session_id: sid, request_id: session.request_id || null, status: session.status === 'PROCESSING' ? 'OUTCOME_UNKNOWN' : session.status }));
    }
    if (request.method === 'DELETE') {
      await this.ctx.storage.put('session', { owner, sid, expires: session.expires, status: 'CANCELLED' });
      return json(envelope({ session_id: sid, status: 'CANCELLED' }));
    }
    requireValue(request.method === 'POST', 'METHOD_NOT_ALLOWED', 405);
    requireValue(!['CANCELLED'].includes(session.status), 'SESSION_CANCELLED', 409);
    const rid = identifier(request.headers.get('X-Request-ID')), language = request.headers.get('X-Voice-Language') || 'zh-CN';
    requireValue(['zh-CN', 'en-US'].includes(language), 'UNSUPPORTED_LANGUAGE', 422);
    requireValue(request.headers.get('X-Audio-Consent') === 'true', 'AUDIO_CONSENT_REQUIRED', 403);
    requireValue(/^audio\/wav(?:;|$)/i.test(request.headers.get('Content-Type') || ''), 'WAV_REQUIRED', 415);
    const length = request.headers.get('Content-Length');
    requireValue(!length || (/^\d+$/.test(length) && Number(length) <= MAX_BYTES), 'AUDIO_TOO_LARGE', 413);
    const bytes = await readBounded(request.body, MAX_BYTES, request.signal);
    try {
      const duration = inspectWav(bytes), hash = await digest(bytes);
      const fingerprint = await digest(JSON.stringify([hash, language]));
      if (session.request_id) {
        requireValue(session.request_id === rid && session.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', 409);
        requireValue(session.status !== 'PROCESSING', 'ASR_OUTCOME_UNKNOWN', 409);
        return json(session.result, session.http_status);
      }
      providerConfig(this.env);
      session = { ...session, request_id: rid, fingerprint, status: 'PROCESSING' };
      await this.ctx.storage.put('session', session);
      let result, status = 200;
      this.controller = new AbortController(); this.processingOwner = owner;
      const signal = AbortSignal.any([request.signal, this.controller.signal]);
      try {
        requireValue(!signal.aborted, 'CLIENT_DISCONNECTED', 499);
        await reserve(this.env, owner, Math.ceil(duration / 1000));
        requireValue(!signal.aborted, 'CLIENT_DISCONNECTED', 499);
        const text = await transcribe(bytes, language, this.env, signal);
        requireValue(!signal.aborted, 'CLIENT_DISCONNECTED', 499);
        result = envelope({ transcript: text, is_final: true, session_id: sid, request_id: rid, language, duration_ms: duration, status: 'TRANSCRIBED' });
      } catch (error) {
        status = error instanceof VoiceError ? error.status : 503;
        result = envelope({ session_id: sid, request_id: rid, language, duration_ms: duration, status: 'FAILED', error: publicError(error instanceof VoiceError ? error.code : 'ASR_UNAVAILABLE') });
      } finally { this.controller = null; this.processingOwner = null; }
      if (session.expires <= Date.now()) { await this.ctx.storage.deleteAll(); throw new VoiceError('SESSION_EXPIRED', 410); }
      // Never retry a persisted PROCESSING request after an uncertain storage failure.
      await this.ctx.storage.put('session', { ...session, status: result.status, http_status: status, result });
      return json(result, status);
    } finally { bytes.fill(0); }
  }
  async alarm() { this.controller?.abort(); await this.ctx.storage.deleteAll(); }
}
