export type VoiceLanguage = 'zh-CN' | 'en-US';
export interface VoiceTranscript {
  contract_version: 'voice-transcription.v1';
  transcript: string | null;
  is_final: boolean;
  session_id: string | null;
  request_id: string | null;
  provider: 'aliyun_bailian';
  language: VoiceLanguage | null;
  duration_ms: number | null;
  error: { code: string; message: string } | null;
  capability: 'REVIEW_ONLY';
  execution_allowed: false;
  requires_user_confirmation: true;
  status?: 'READY' | 'TRANSCRIBED' | 'FAILED' | 'CANCELLED' | 'OUTCOME_UNKNOWN';
  expires_at?: number;
}
export interface VoiceIdentityClaims {
  iss: string;
  aud: 'voice-gateway';
  sub: string;
  account_id: string;
  jti: string;
  scope: 'voice:transcribe';
  capability: 'REVIEW_ONLY';
  iat: number;
  exp: number;
  nbf?: number;
}
