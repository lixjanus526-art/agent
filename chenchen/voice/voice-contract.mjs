export const VERSION = 'voice-transcription.v1';
export const MAX_BYTES = 1920100;
export const SESSION_TTL_MS = 5 * 60 * 1000;
export class VoiceError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function requireValue(condition, code, status = 400) { if (!condition) throw new VoiceError(code, status); }
export function identifier(value) { requireValue(typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value), 'INVALID_IDENTIFIER'); return value; }
export function transcript(value) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= 20000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value), 'INVALID_TRANSCRIPT', 502);
  return value.trim();
}
export function envelope(fields = {}) {
  return { contract_version: VERSION, transcript: null, is_final: false, session_id: null, request_id: null,
    provider: 'aliyun_bailian', language: null, duration_ms: null, error: null, ...fields,
    capability: 'REVIEW_ONLY', execution_allowed: false, requires_user_confirmation: true };
}
export function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function failure(error, fields = {}) {
  const code = error instanceof VoiceError ? error.code : 'VOICE_UNAVAILABLE';
  return json(envelope({ ...fields, error: publicError(code) }), error instanceof VoiceError ? error.status : 503);
}
export function publicError(code) {
  const messages = { AUTHENTICATION_REQUIRED: '请先登录并获取短期语音凭证。', VOICE_AUTH_NOT_CONFIGURED: '语音身份服务尚未配置。',
    INVALID_TOKEN: '语音凭证无效，请重新登录。', TOKEN_EXPIRED_OR_INVALID: '语音凭证已过期或无效。', VOICE_SCOPE_DENIED: '当前身份没有语音转写权限。',
    WAV_REQUIRED: '请上传 WAV 音频；当前不接受 WebM 或 JSON。', INVALID_WAV: '音频文件损坏或不是有效 WAV。',
    UNSUPPORTED_AUDIO_FORMAT: '请使用 16 kHz 单声道 PCM16 WAV。', EMPTY_OR_INVALID_AUDIO: '没有收到有效录音，请检查麦克风后重录。',
    AUDIO_TOO_LARGE: '录音文件过大，请缩短到 60 秒以内。', AUDIO_DURATION_LIMIT: '录音时长须在 0.1 至 60 秒之间。',
    AUDIO_CONSENT_REQUIRED: '请先确认同意本次音频处理。', SESSION_NOT_FOUND: '该会话不存在或不属于当前身份。', SESSION_EXPIRED: '语音会话已过期，请重新开始。',
    SESSION_CANCELLED: '语音会话已取消。', ASR_NOT_CONFIGURED: '云端语音服务尚未配置或未获准启用。', ASR_TIMEOUT: '识别超时，未生成成功转写；请先核对本次状态。',
    ASR_DISCONNECTED: '识别服务连接中断，请核对本次状态后重新录音。', ASR_OUTCOME_UNKNOWN: '上次识别结果未知，不会自动重试。',
    ASR_UPSTREAM_FAILED: '识别服务失败，没有可用转写文本。', INVALID_TRANSCRIPT: '识别服务没有返回有效文本。', IDEMPOTENCY_CONFLICT: '同一会话的录音或请求编号发生冲突。',
    VOICE_RATE_LIMITED: '语音请求过于频繁，请稍后再试。', VOICE_BUDGET_EXHAUSTED: '语音服务预算上限已到，请联系管理员。',
    CLIENT_DISCONNECTED: '本次识别已取消或连接已断开。', BODY_TIMEOUT: '录音上传超时，请检查网络。', ORIGIN_DENIED: '当前网页来源未获授权。' };
  return { code, message: messages[code] || '本次语音请求未完成，请核对配置、输入或权限后重试。' };
}
export async function readBounded(body, limit, signal, timeoutMs = 10000) {
  requireValue(body, 'AUDIO_REQUIRED');
  const reader = body.getReader(), chunks = [];
  let size = 0, timer, abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(new VoiceError('CLIENT_DISCONNECTED', 499));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(new VoiceError('BODY_TIMEOUT', 408)), timeoutMs);
    if (signal?.aborted) abort();
  });
  try {
    while (true) {
      const item = await Promise.race([reader.read(), stopped]);
      if (item.done) break;
      size += item.value.byteLength;
      requireValue(size <= limit, 'AUDIO_TOO_LARGE', 413);
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
  }
}
// Parse actual PCM duration instead of trusting browser metadata or a filename.
export function inspectWav(bytes) {
  const text = (offset, count) => new TextDecoder().decode(bytes.subarray(offset, offset + count));
  requireValue(bytes.length >= 44 && text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE', 'INVALID_WAV', 415);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireValue(view.getUint32(4, true) + 8 === bytes.length, 'INVALID_WAV', 415);
  let format = false, audioBytes = null, offset = 12;
  for (; offset + 8 <= bytes.length;) {
    const kind = text(offset, 4), length = view.getUint32(offset + 4, true), start = offset + 8;
    requireValue(start + length <= bytes.length, 'INVALID_WAV', 415);
    if (kind === 'fmt ') {
      requireValue(!format && length === 16 && view.getUint16(start, true) === 1 && view.getUint16(start + 2, true) === 1 && view.getUint32(start + 4, true) === 16000 && view.getUint32(start + 8, true) === 32000 && view.getUint16(start + 12, true) === 2 && view.getUint16(start + 14, true) === 16, 'UNSUPPORTED_AUDIO_FORMAT', 415);
      format = true;
    } else if (kind === 'data') { requireValue(audioBytes === null, 'INVALID_WAV', 415); audioBytes = length; }
    else requireValue(kind === 'JUNK' || kind === 'LIST', 'UNSUPPORTED_WAV_CHUNK', 415);
    offset = start + length + (length % 2);
    requireValue(offset <= bytes.length, 'INVALID_WAV', 415);
  }
  requireValue(offset === bytes.length, 'INVALID_WAV', 415);
  requireValue(format && audioBytes > 0 && audioBytes % 2 === 0, 'EMPTY_OR_INVALID_AUDIO', 415);
  const duration = audioBytes / 32;
  requireValue(duration >= 100 && duration <= 60000, 'AUDIO_DURATION_LIMIT', 413);
  return duration;
}
