import { requireValue, identifier, transcript } from './voice-contract.mjs';
// Build a candidate request only. This module has no network or execution capability.
export function confirmedChatRequest({ result, edited_text, confirmed, chat_id, request_id }) {
  requireValue(result?.contract_version === 'voice-transcription.v1' && result.is_final === true && result.error === null && result.capability === 'REVIEW_ONLY' && result.execution_allowed === false, 'FINAL_TRANSCRIPT_REQUIRED', 409);
  requireValue(confirmed === true, 'USER_CONFIRMATION_REQUIRED', 409);
  requireValue(typeof edited_text === 'string' && edited_text.length <= 2000, 'CHAT_TEXT_TOO_LONG', 422);
  return { path: '/api/local/chats/' + identifier(chat_id) + '/turns', method: 'POST',
    body: { request_id: identifier(request_id), text: transcript(edited_text) } };
}
