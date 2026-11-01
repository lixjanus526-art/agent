import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, wav } from '../voice/offline-fixtures.mjs';
import { transcribe } from '../voice/asr-provider.mjs';
import { envelope, inspectWav, readBounded } from '../voice/voice-contract.mjs';
import { confirmedChatRequest } from '../voice/voice-chat-adapter.mjs';
import worker from '../voice/voice-gateway.mjs';
import { VoiceSession } from '../voice/voice-session.mjs';
import { VoiceQuota } from '../voice/voice-quota.mjs';

const successful = text => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }));
test('offline provider success yields final transcript and never calls financial endpoints', async t => {
  const f = setup(), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url); assert.equal(options.headers.Authorization, 'Bearer synthetic-asr-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen3-asr-flash'); assert.match(body.messages[0].content[0].input_audio.data, /^data:audio\/wav;base64,/);
    assert.equal(body.asr_options.language, 'zh'); return successful('转账两千元');
  });
  const sid = await f.create(), response = await f.upload(sid), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.transcript, '转账两千元'); assert.equal(data.is_final, true);
  assert.equal(data.execution_allowed, false); assert.equal(data.capability, 'REVIEW_ONLY'); assert.equal(data.requires_user_confirmation, true);
  assert.deepEqual(calls, ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions']);
  assert.throws(() => confirmedChatRequest({ result: data, edited_text: data.transcript, confirmed: false }), { code: 'USER_CONFIRMATION_REQUIRED' });
  const candidate = confirmedChatRequest({ result: data, edited_text: '我只想了解转账风险', confirmed: true, chat_id: 'chat-demo1', request_id: 'chat-req-1' });
  assert.deepEqual(candidate.body, { request_id: 'chat-req-1', text: '我只想了解转账风险' });
  assert.equal(candidate.path, '/api/local/chats/chat-demo1/turns'); assert.equal(calls.length, 1);
});
test('identical concurrent submissions and restart replay consume one provider call', async t => {
  const f = setup(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return successful('查询任务'); });
  const sid = await f.create();
  const responses = await Promise.all([f.upload(sid), f.upload(sid)]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]); assert.equal(calls, 1);
  const stored = [...f.env.VOICE_SESSIONS.objects.values()][0];
  stored.instance = new VoiceSession({ storage: stored.storage }, f.env);
  assert.equal((await f.upload(sid)).status, 200); assert.equal(calls, 1);
  assert.equal((await f.upload(sid, { headers: { 'X-Voice-Language': 'en-US' } })).status, 409);
});
test('expired or invalid tokens, missing identity and absent server secret fail closed', async () => {
  const f = setup();
  assert.equal((await f.request('', { method: 'POST', headers: { Authorization: '' } })).status, 401);
  for (const identity of [{ exp: 1 }, { aud: 'chat' }, { iat: Math.floor(Date.now() / 1000) + 10 }, { sub: '../other' }]) assert.equal((await f.request('', { method: 'POST' }, identity)).status, 401);
  for (const identity of [{ scope: 'execute' }, { capability: 'EXECUTE' }]) assert.equal((await f.request('', { method: 'POST' }, identity)).status, 403);
  const token = await f.token();
  assert.equal((await f.request('', { method: 'POST', headers: { Authorization: 'Bearer ' + token + 'bad' } })).status, 401);
  delete f.env.VOICE_AUTH_SECRET;
  const response = await worker.fetch(new Request('https://voice.test/api/voice/sessions', { method: 'POST', headers: { Authorization: 'Bearer anything' } }), f.env);
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'VOICE_AUTH_NOT_CONFIGURED');
});
test('session reads and writes are isolated across subject and account', async () => {
  const f = setup(), sid = await f.create();
  for (const identity of [{ sub: 'bob' }, { account_id: 'other-account' }]) {
    assert.equal((await f.request('/' + sid, {}, identity)).status, 404);
    assert.equal((await f.upload(sid, {}, identity)).status, 404);
  }
});
test('CORS exact whitelist and preflight reject arbitrary origin and headers', async () => {
  const f = setup();
  assert.equal((await f.request('', { method: 'POST', headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await f.request('', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } })).status, 204);
  assert.equal((await f.request('', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-voice-internal' } })).status, 403);
  f.env.VOICE_ALLOWED_ORIGINS = '*'; assert.equal((await f.request('', { method: 'POST' })).status, 503);
});
test('invalid formats, empty microphone data, oversized audio and missing consent fail before ASR', async t => {
  const f = setup(), sid = await f.create(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not call'); });
  for (const options of [{ body: new Uint8Array(0) }, { body: new Uint8Array(60) }, { body: wav(61000) },
    { headers: { 'Content-Type': 'application/json' } }, { headers: { 'X-Audio-Consent': 'false' } }, { headers: { 'X-Voice-Language': 'auto' } }]) assert.ok((await f.upload(sid, options)).status >= 400);
  assert.equal(calls, 0);
  assert.equal(inspectWav(wav(1000)), 1000);
  const forged = wav(); new DataView(forged.buffer).setUint32(24, 8000, true);
  assert.throws(() => inspectWav(forged), { code: 'UNSUPPORTED_AUDIO_FORMAT' });
  const trailing = new Uint8Array(wav().length + 2); trailing.set(wav());
  new DataView(trailing.buffer).setUint32(4, trailing.length - 8, true);
  assert.throws(() => inspectWav(trailing), { code: 'INVALID_WAV' });
});
test('slow or disconnected upload readers are cancelled', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(readBounded(stream, 100, undefined, 5), { code: 'BODY_TIMEOUT' });
  assert.equal(cancelled, true);
});
test('provider disconnect, timeout and client abort never fabricate success', async () => {
  const f = setup();
  await assert.rejects(transcribe(wav(), 'zh-CN', f.env, undefined, async () => { throw new Error('secret: must not leak'); }), { code: 'ASR_DISCONNECTED' });
  const waiting = async (_, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); if (options.signal.aborted) reject(new Error('aborted')); });
  await assert.rejects(transcribe(wav(), 'zh-CN', f.env, undefined, waiting, 5), { code: 'ASR_TIMEOUT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transcribe(wav(), 'zh-CN', f.env, controller.signal, waiting), { code: 'CLIENT_DISCONNECTED' });
});
test('provider bad responses are explicit failures and never use fallback text', async t => {
  for (const response of [new Response('denied', { status: 401 }), new Response('bad json'), successful(''), new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }))]) {
    const f = setup(); t.mock.method(globalThis, 'fetch', async () => response);
    const sid = await f.create(), r = await f.upload(sid), data = await r.json();
    assert.ok(r.status >= 400); assert.equal(data.is_final, false); assert.equal(data.transcript, null); assert.ok(data.error.code);
    t.mock.restoreAll();
  }
});
test('failed provider outcomes are persisted and repeated input does not retry billing', async t => {
  const f = setup(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('provider secret raw'); });
  const sid = await f.create(), r = await f.upload(sid);
  assert.equal(r.status, 502); assert.doesNotMatch(await r.text(), /provider secret raw|synthetic-asr-key/);
  assert.equal((await f.upload(sid)).status, 502); assert.equal(calls, 1);
});
test('quota is persistent and shared across gateway users, with atomic fail-closed limits', async t => {
  const f = setup(); f.env.VOICE_DAILY_AUDIO_SECONDS = '1';
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return successful('查询'); });
  const sid = await f.create(); assert.equal((await f.upload(sid)).status, 200);
  const quota = [...f.env.VOICE_QUOTA.objects.values()][0]; quota.instance = new VoiceQuota({ storage: quota.storage }, f.env);
  const bob = { sub: 'bob' }, other = await f.create(bob);
  assert.equal((await f.upload(other, {}, bob)).status, 429); assert.equal(calls, 1);
  assert.equal(quota.storage.data.get('quota').total, 1);
});
test('missing quota config and storage failures stop provider calls', async t => {
  const f = setup(); let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return successful('no'); });
  for (const limit of ['0', '-1', '1.5', 'Infinity', '1e100']) {
    f.env.VOICE_DAILY_AUDIO_SECONDS = limit; assert.equal((await f.request('', { method: 'POST' })).status, 503);
  }
  assert.equal(calls, 0);
  const g = setup(); g.env.VOICE_SESSIONS.get = () => { throw new Error('sensitive internal storage'); };
  const r = await g.request('', { method: 'POST' }); assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /sensitive internal storage/); assert.equal(calls, 0);
});
test('storage failure after paid ASR leaves an uncertain outcome and cannot charge again', async t => {
  const f = setup(); let calls = 0;
  const sid = await f.create(), entry = [...f.env.VOICE_SESSIONS.objects.values()][0];
  const put = entry.storage.put;
  entry.storage.put = async (key, value) => {
    if (value.status === 'TRANSCRIBED') throw new Error('storage unavailable after billing');
    return put(key, value);
  };
  t.mock.method(globalThis, 'fetch', async () => { calls++; return successful('已识别'); });
  assert.equal((await f.upload(sid)).status, 503);
  assert.equal(entry.storage.data.get('session').status, 'PROCESSING');
  assert.equal((await f.upload(sid)).status, 409); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(entry.storage.data.get('session')), /已识别|audio\/wav|base64/);
});
test('parallel sessions share a single atomic audio budget', async t => {
  const f = setup(); f.env.VOICE_DAILY_AUDIO_SECONDS = '2'; let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return successful('查询'); });
  const sessions = await Promise.all([f.create(), f.create(), f.create()]);
  const responses = await Promise.all(sessions.map(sid => f.upload(sid)));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 200, 429]);
  assert.equal(calls, 2);
});
test('user rate limit persists across requests and is independent of another user', async () => {
  const f = setup(); for (let i = 0; i < 6; i++) assert.equal((await f.request('', { method: 'POST' })).status, 201);
  assert.equal((await f.request('', { method: 'POST' })).status, 429);
  assert.equal((await f.request('', { method: 'POST' }, { sub: 'bob' })).status, 201);
});
test('cancel stops inflight provider and clears transcript; TTL alarm deletes session', async t => {
  const f = setup(); let notify;
  const started = new Promise(resolve => { notify = resolve; });
  t.mock.method(globalThis, 'fetch', async (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); notify();
  }));
  const sid = await f.create(), upload = f.upload(sid); await started;
  const cancelled = f.request('/' + sid, { method: 'DELETE' });
  assert.equal((await upload).status, 499); assert.equal((await cancelled).status, 200);
  assert.equal((await (await f.request('/' + sid)).json()).status, 'CANCELLED');
  const entry = [...f.env.VOICE_SESSIONS.objects.values()][0]; await entry.instance.alarm();
  assert.equal(entry.storage.data.size, 0); assert.equal((await f.request('/' + sid)).status, 404);
});
test('restart with uncertain provider result blocks resubmission and expiry prevents reads', async () => {
  const f = setup(), sid = await f.create(), entry = [...f.env.VOICE_SESSIONS.objects.values()][0];
  const original = entry.storage.data.get('session');
  entry.storage.data.set('session', { ...original, status: 'PROCESSING', request_id: 'unknown-request', fingerprint: 'unknown' });
  assert.equal((await (await f.request('/' + sid)).json()).status, 'OUTCOME_UNKNOWN');
  assert.equal((await f.upload(sid)).status, 409);
  entry.storage.data.set('session', { ...original, expires: 1 }); assert.equal((await f.request('/' + sid)).status, 410);
});
test('ASR configuration is required and no production mock provider can be selected', async t => {
  const f = setup(); let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return successful('fake'); });
  const sid = await f.create(); delete f.env.DASHSCOPE_API_KEY;
  assert.equal((await f.upload(sid)).status, 503); assert.equal(calls, 0);
  f.env.DASHSCOPE_API_KEY = 'synthetic'; f.env.VOICE_ASR_MODEL = 'mock';
  assert.equal((await f.upload(sid)).status, 503); assert.equal(calls, 0);
});
test('confirmation adapter never accepts interim, failure, execute capability or oversized chat text', () => {
  assert.equal(envelope({ capability: 'EXECUTE', execution_allowed: true }).execution_allowed, false);
  const result = { contract_version: 'voice-transcription.v1', is_final: true, error: null, capability: 'REVIEW_ONLY', execution_allowed: false };
  for (const patch of [{ is_final: false }, { error: { code: 'FAILED' } }, { capability: 'EXECUTE' }, { execution_allowed: true }]) {
    assert.throws(() => confirmedChatRequest({ result: { ...result, ...patch }, confirmed: true }), { code: 'FINAL_TRANSCRIPT_REQUIRED' });
  }
  assert.throws(() => confirmedChatRequest({ result, confirmed: true, edited_text: 'a'.repeat(2001) }), { code: 'CHAT_TEXT_TOO_LONG' });
});
