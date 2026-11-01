import { requireValue, json, failure } from './voice-contract.mjs';
export class VoiceQuota {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.queue = Promise.resolve(); }
  fetch(request) {
    const job = this.queue.then(() => this.handle(request));
    this.queue = job.catch(() => {}); return job.catch(failure);
  }
  async handle(request) {
    requireValue(this.env.VOICE_AUTH_SECRET?.length >= 32 && request.headers.get('X-Voice-Internal') === this.env.VOICE_AUTH_SECRET, 'INTERNAL_AUTH_REQUIRED', 403);
    const body = await request.json();
    requireValue(/^[a-f0-9]{64}$/.test(body.owner || ''), 'INVALID_IDENTITY', 403);
    const now = Date.now(), minute = Math.floor(now / 60000), day = Math.floor(now / 86400000);
    await this.ctx.storage.transaction(async storage => {
      const limits = { daily: Number(this.env.VOICE_DAILY_AUDIO_SECONDS), total: Number(this.env.VOICE_TOTAL_AUDIO_SECONDS) };
      requireValue(Number.isSafeInteger(limits.daily) && limits.daily > 0 && Number.isSafeInteger(limits.total) && limits.total > 0, 'VOICE_BUDGET_NOT_CONFIGURED', 503);
      const data = await storage.get('quota') || { minute, day, users: {}, seconds: 0, total: 0 };
      if (data.minute !== minute) { data.minute = minute; data.users = {}; }
      if (data.day !== day) { data.day = day; data.seconds = 0; }
      requireValue(Object.keys(data.users).length < 1000 || data.users[body.owner], 'VOICE_CAPACITY_LIMIT', 429);
      requireValue((data.users[body.owner] || 0) < 6, 'VOICE_RATE_LIMITED', 429);
      if (body.seconds !== undefined) {
        requireValue(Number.isSafeInteger(body.seconds) && body.seconds > 0 && body.seconds <= 60, 'INVALID_DURATION');
        requireValue(data.seconds + body.seconds <= limits.daily && data.total + body.seconds <= limits.total, 'VOICE_BUDGET_EXHAUSTED', 429);
        data.seconds += body.seconds; data.total += body.seconds;
      }
      data.users[body.owner] = (data.users[body.owner] || 0) + 1;
      await storage.put('quota', data);
    });
    return json({ admitted: true });
  }
}
