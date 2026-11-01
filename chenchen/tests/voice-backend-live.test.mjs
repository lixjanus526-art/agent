import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transcribe } from '../voice/asr-provider.mjs';
import { inspectWav, MAX_BYTES } from '../voice/voice-contract.mjs';
// Explicit opt-in only: no test double, no customer data and no automatic retries.
test('LIVE ASR: owner-provided synthetic WAV returns actual provider text', { skip: process.env.VOICE_LIVE_TEST !== '1' }, async () => {
  assert.equal(process.env.VOICE_LIVE_BUDGET_APPROVED, 'true');
  assert.ok(process.env.VOICE_LIVE_WAV);
  assert.ok(process.env.VOICE_LIVE_EXPECTED_TEXT);
  const bytes = new Uint8Array(await readFile(process.env.VOICE_LIVE_WAV));
  assert.ok(bytes.length <= MAX_BYTES); inspectWav(bytes);
  const text = await transcribe(bytes, 'zh-CN', { ...process.env, VOICE_ASR_ENABLED: 'true' });
  const normalize = value => value.replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase();
  assert.ok(normalize(text).includes(normalize(process.env.VOICE_LIVE_EXPECTED_TEXT)));
});
