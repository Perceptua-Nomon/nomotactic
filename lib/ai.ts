/**
 * AI chat-command client: talk to the device's Claude relay.
 *
 * The device endpoint (`POST /api/ai/command`) runs the agentic loop
 * server-side: the app sends the visible conversation (plain text turns,
 * oldest first, ending with the new user message) and renders the reply plus
 * the robot actions the model took. Tool-use blocks never reach the app.
 *
 * The Anthropic API key lives on the device (stored in a 0600 file via
 * `/api/ai/key`, or `ANTHROPIC_API_KEY` in the service environment) — it is
 * never held in the app or its storage, so web builds cannot leak it.
 */

import { ApiRequestError, deviceApi } from "@/lib/api";
import { ENDPOINTS } from "@/lib/endpoints";

// ---------------------------------------------------------------------------
// Types (mirror nomothetic ai_routes request/response models)
// ---------------------------------------------------------------------------

/** One conversation turn. Turns must alternate and start/end with the user. */
export interface AiChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** One robot tool call the model made while handling a command. */
export interface AiActionRecord {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  error?: string | null;
}

/** The model's reply plus the record of every action it took. */
export interface AiCommandResponse {
  reply: string;
  actions: AiActionRecord[];
  model: string;
  stop_reason: string;
  timestamp: string;
}

/** Whether the device has an AI key configured — never the key itself. */
export interface AiKeyStatus {
  configured: boolean;
  source: "stored" | "env" | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Max conversation messages sent per command. The device caps requests at 40
 * messages; the client trims well below that so old context ages out.
 */
export const MAX_HISTORY_MESSAGES = 20;

/** AI commands run a model loop with tool round trips — allow minutes, not
 * the default 10 s API timeout. */
export const AI_COMMAND_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Trim `messages` to at most `max` turns, keeping the newest and preserving
 * the required shape (the first remaining turn must be the user's).
 */
export function trimHistory(
  messages: AiChatMessage[],
  max: number = MAX_HISTORY_MESSAGES,
): AiChatMessage[] {
  if (messages.length <= max) return messages;
  const trimmed = messages.slice(messages.length - max);
  while (trimmed.length > 0 && trimmed[0].role !== "user") {
    trimmed.shift();
  }
  return trimmed;
}

/**
 * True when a command failure means "the device needs a (working) Anthropic
 * API key" — the UI should offer the key-entry affordance. Covers both "no
 * key configured" (503) and "the provider rejected the stored key" (502).
 * Other 502s (provider outage, rate limit) are not key problems.
 */
export function isKeyProblem(err: unknown): boolean {
  if (!(err instanceof ApiRequestError)) return false;
  if (err.status === 503 && /api key/i.test(err.message)) return true;
  if (err.status === 502 && /rejected the configured api key/i.test(err.message)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Device API calls
// ---------------------------------------------------------------------------

/** Run one chat command through the device's Claude tool loop. */
export async function sendAiCommand(messages: AiChatMessage[]): Promise<AiCommandResponse> {
  return deviceApi<AiCommandResponse>(ENDPOINTS.AI_COMMAND, {
    method: "POST",
    body: { messages },
    timeoutMs: AI_COMMAND_TIMEOUT_MS,
  });
}

/** Report whether the device has an AI key configured (and its source). */
export async function getAiKeyStatus(): Promise<AiKeyStatus> {
  return deviceApi<AiKeyStatus>(ENDPOINTS.AI_KEY);
}

/** Store a user-supplied Anthropic API key on the device (0600 file). */
export async function setAiKey(apiKey: string): Promise<AiKeyStatus> {
  return deviceApi<AiKeyStatus>(ENDPOINTS.AI_KEY, {
    method: "PUT",
    body: { api_key: apiKey },
  });
}

/** Remove the stored key from the device (any env fallback remains). */
export async function clearAiKey(): Promise<AiKeyStatus> {
  return deviceApi<AiKeyStatus>(ENDPOINTS.AI_KEY, { method: "DELETE" });
}
