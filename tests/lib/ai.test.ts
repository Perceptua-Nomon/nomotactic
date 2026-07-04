/**
 * Tests for the AI chat-command client (device Claude relay).
 */

import {
  AiChatMessage,
  clearAiKey,
  getAiKeyStatus,
  isKeyProblem,
  MAX_HISTORY_MESSAGES,
  sendAiCommand,
  setAiKey,
  trimHistory,
} from "@/lib/ai";
import { ApiRequestError, setDeviceBaseUrl } from "@/lib/api";

const DEVICE_URL = "https://device.test:8443";

const mockFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
global.fetch = mockFetch as unknown as typeof fetch;

function makeOkResponse(body: unknown, status = 200): Partial<Response> {
  return { ok: true, status, json: async () => body };
}

function makeErrorResponse(status: number, errorMsg: string): Partial<Response> {
  return {
    ok: false,
    status,
    json: async () => ({ error: errorMsg, timestamp: new Date().toISOString() }),
  };
}

function lastBody(): unknown {
  const init = mockFetch.mock.calls[0][1];
  return init?.body !== undefined ? JSON.parse(init.body as string) : undefined;
}

beforeEach(() => {
  mockFetch.mockReset();
  setDeviceBaseUrl(DEVICE_URL);
});

// ---------------------------------------------------------------------------
// sendAiCommand
// ---------------------------------------------------------------------------

describe("sendAiCommand", () => {
  it("POSTs the conversation and returns the reply with actions", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({
        reply: "Driving forward.",
        actions: [{ tool: "drive", input: { speed_pct: 50 }, ok: true, result: 4 }],
        model: "claude-opus-4-8",
        stop_reason: "end_turn",
        timestamp: "t",
      }) as Response,
    );

    const messages: AiChatMessage[] = [{ role: "user", content: "drive forward" }];
    const resp = await sendAiCommand(messages);

    expect(resp.reply).toBe("Driving forward.");
    expect(resp.actions[0].tool).toBe("drive");
    expect(resp.actions[0].ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${DEVICE_URL}/api/ai/command`);
    expect(init?.method).toBe("POST");
    expect(lastBody()).toEqual({ messages: [{ role: "user", content: "drive forward" }] });
  });

  it("rejects with ApiRequestError carrying the device's error text", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(503, "No AI API key configured. Store one via PUT /api/ai/key.") as Response,
    );
    await expect(sendAiCommand([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });
});

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

describe("AI key management", () => {
  it("getAiKeyStatus GETs the key endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ configured: false, source: null, timestamp: "t" }) as Response,
    );
    const status = await getAiKeyStatus();
    expect(status.configured).toBe(false);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${DEVICE_URL}/api/ai/key`);
    expect(init?.method).toBe("GET");
  });

  it("setAiKey PUTs the key in the body", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ configured: true, source: "stored", timestamp: "t" }) as Response,
    );
    const status = await setAiKey("sk-ant-test-0123456789");
    expect(status.source).toBe("stored");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${DEVICE_URL}/api/ai/key`);
    expect(init?.method).toBe("PUT");
    expect(lastBody()).toEqual({ api_key: "sk-ant-test-0123456789" });
  });

  it("clearAiKey DELETEs the key with no body", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ configured: false, source: null, timestamp: "t" }) as Response,
    );
    await clearAiKey();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${DEVICE_URL}/api/ai/key`);
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// trimHistory
// ---------------------------------------------------------------------------

function turns(count: number): AiChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `turn ${i}`,
  }));
}

describe("trimHistory", () => {
  it("returns short histories unchanged", () => {
    const history = turns(5);
    expect(trimHistory(history)).toBe(history);
  });

  it("keeps only the newest messages up to the cap", () => {
    const trimmed = trimHistory(turns(30));
    expect(trimmed).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(trimmed[trimmed.length - 1].content).toBe("turn 29");
  });

  it("drops a leading assistant turn so the history starts with the user", () => {
    // 31 alternating turns: slicing the last 20 would start on an assistant turn.
    const trimmed = trimHistory(turns(31));
    expect(trimmed[0].role).toBe("user");
    expect(trimmed[trimmed.length - 1].content).toBe("turn 30");
    expect(trimmed).toHaveLength(MAX_HISTORY_MESSAGES - 1);
  });

  it("honours a custom cap", () => {
    const trimmed = trimHistory(turns(10), 4);
    expect(trimmed).toHaveLength(4);
    expect(trimmed[0].role).toBe("user");
  });
});

// ---------------------------------------------------------------------------
// isKeyProblem
// ---------------------------------------------------------------------------

describe("isKeyProblem", () => {
  it("matches the device's no-key 503", () => {
    const err = new ApiRequestError(
      "No AI API key configured. Store one via PUT /api/ai/key.",
      503,
    );
    expect(isKeyProblem(err)).toBe(true);
  });

  it("matches the provider-rejected-key 502", () => {
    const err = new ApiRequestError("the AI provider rejected the configured API key", 502);
    expect(isKeyProblem(err)).toBe(true);
  });

  it("does not match other 502s (provider outage is not a key problem)", () => {
    expect(isKeyProblem(new ApiRequestError("AI provider request failed: overloaded", 502))).toBe(
      false,
    );
  });

  it("does not match unrelated errors", () => {
    expect(isKeyProblem(new ApiRequestError("daemon down", 503))).toBe(false);
    expect(isKeyProblem(new ApiRequestError("Request timed out", 0))).toBe(false);
    expect(isKeyProblem(new Error("boom"))).toBe(false);
    expect(isKeyProblem(undefined)).toBe(false);
  });
});
