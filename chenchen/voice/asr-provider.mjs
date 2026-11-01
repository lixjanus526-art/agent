import { Buffer } from 'node:buffer';
import { requireValue, readBounded, transcript, VoiceError } from './voice-contract.mjs';
const endpoints = { 'cn-beijing': 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'ap-southeast-1': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions' };
export function providerConfig(env) {
  requireValue(env.VOICE_ASR_ENABLED === 'true' && typeof env.DASHSCOPE_API_KEY === 'string' && env.DASHSCOPE_API_KEY.trim().length > 0 && env.VOICE_ASR_MODEL === 'qwen3-asr-flash' && endpoints[env.VOICE_ASR_REGION], 'ASR_NOT_CONFIGURED', 503);
  return { endpoint: endpoints[env.VOICE_ASR_REGION], model: env.VOICE_ASR_MODEL };
}
export async function transcribe(bytes, language, env, signal, fetcher = fetch, timeoutMs = 25000) {
  const config = providerConfig(env), controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetcher(config.endpoint, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Authorization': 'Bearer ' + env.DASHSCOPE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,' + Buffer.from(bytes).toString('base64') } }] }], stream: false, asr_options: { language: language === 'zh-CN' ? 'zh' : 'en', enable_itn: false } }) });
    requireValue(response.ok, response.status === 429 ? 'ASR_RATE_LIMITED' : 'ASR_UPSTREAM_FAILED', response.status === 429 ? 429 : 502);
    let result;
    try { result = JSON.parse(new TextDecoder().decode(await readBounded(response.body, 65536, controller.signal, timeoutMs))); }
    catch (error) { if (error instanceof VoiceError) throw error; throw new VoiceError('ASR_INVALID_RESPONSE', 502); }
    requireValue(result?.choices?.[0]?.finish_reason === 'stop', 'ASR_INCOMPLETE_RESPONSE', 502);
    return transcript(result.choices[0].message?.content);
  } catch (error) {
    if (timedOut) throw new VoiceError('ASR_TIMEOUT', 504);
    if (signal?.aborted) throw new VoiceError('CLIENT_DISCONNECTED', 499);
    if (error instanceof VoiceError) throw error;
    throw new VoiceError('ASR_DISCONNECTED', 502);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
