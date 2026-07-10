/**
 * Tests for the voice command service (record on the phone, transcribe on the
 * robot, speak the reply). expo-audio / expo-speech are mocked via jest
 * moduleNameMapper; the transcription upload is fetch-mocked like the other
 * lib suites.
 */

import { AudioModule, setAudioModeAsync } from "expo-audio";
import * as Speech from "expo-speech";
import { Platform } from "react-native";

import { ApiRequestError, setDeviceBaseUrl } from "@/lib/api";
import {
  describeVoiceError,
  ensureMicPermission,
  enterRecordingMode,
  exitRecordingMode,
  isVoiceInputAvailable,
  speak,
  stopSpeaking,
  transcribeAudio,
} from "@/lib/voice";

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

const defaultPlatform = Platform.OS;

beforeEach(() => {
  mockFetch.mockReset();
  (Speech.speak as jest.Mock).mockClear();
  (Speech.stop as jest.Mock).mockClear();
  (setAudioModeAsync as jest.Mock).mockClear();
  setDeviceBaseUrl(DEVICE_URL);
});

afterEach(() => {
  (Platform as { OS: string }).OS = defaultPlatform;
});

// ---------------------------------------------------------------------------
// Availability & permissions
// ---------------------------------------------------------------------------

describe("isVoiceInputAvailable", () => {
  it("is true on native platforms (expo-audio ships in Expo Go)", () => {
    expect(isVoiceInputAvailable()).toBe(true);
  });

  it("is false on web without MediaRecorder", () => {
    (Platform as { OS: string }).OS = "web";
    expect(isVoiceInputAvailable()).toBe(false);
  });

  it("is true on web with getUserMedia and MediaRecorder", () => {
    (Platform as { OS: string }).OS = "web";
    const g = globalThis as Record<string, unknown>;
    const savedNavigator = g.navigator;
    const savedRecorder = g.MediaRecorder;
    Object.defineProperty(globalThis, "navigator", {
      value: { mediaDevices: { getUserMedia: () => Promise.resolve() } },
      configurable: true,
    });
    g.MediaRecorder = function MediaRecorder() {};
    try {
      expect(isVoiceInputAvailable()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: savedNavigator,
        configurable: true,
      });
      g.MediaRecorder = savedRecorder;
    }
  });
});

describe("ensureMicPermission", () => {
  it("returns the granted flag from expo-audio", async () => {
    const request = AudioModule.requestRecordingPermissionsAsync as jest.Mock;
    request.mockResolvedValueOnce({ granted: true });
    await expect(ensureMicPermission()).resolves.toBe(true);
    request.mockResolvedValueOnce({ granted: false });
    await expect(ensureMicPermission()).resolves.toBe(false);
  });
});

describe("recording mode", () => {
  it("enters and exits recording mode via the audio session", async () => {
    await enterRecordingMode();
    expect(setAudioModeAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowsRecording: true }),
    );
    await exitRecordingMode();
    expect(setAudioModeAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowsRecording: false }),
    );
  });
});

// ---------------------------------------------------------------------------
// transcribeAudio
// ---------------------------------------------------------------------------

describe("transcribeAudio", () => {
  it("POSTs multipart audio to the transcribe endpoint and returns the text", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ text: "drive forward", engine: "vosk", timestamp: "t" }) as Response,
    );

    const text = await transcribeAudio("file:///tmp/clip.m4a");

    expect(text).toBe("drive forward");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${DEVICE_URL}/api/ai/transcribe`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    // Multipart must not pin Content-Type — fetch supplies the boundary.
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("returns empty text for silence (a success, not an error)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ text: "", engine: "vosk", timestamp: "t" }) as Response,
    );
    await expect(transcribeAudio("file:///tmp/clip.m4a")).resolves.toBe("");
  });

  it("fetches the blob first on web and uploads it", async () => {
    (Platform as { OS: string }).OS = "web";
    const blob = new Blob(["audio-bytes"], { type: "audio/webm" });
    mockFetch.mockResolvedValueOnce({ blob: async () => blob } as unknown as Response);
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ text: "stop", engine: "vosk", timestamp: "t" }) as Response,
    );

    const text = await transcribeAudio("blob:https://app/clip");

    expect(text).toBe("stop");
    expect(mockFetch.mock.calls[0][0]).toBe("blob:https://app/clip");
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe(`${DEVICE_URL}/api/ai/transcribe`);
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("audio")).toBeInstanceOf(Blob);
  });

  it("throws ApiRequestError when the robot rejects the upload", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(503, "STT model not installed at /var/lib/nomon/stt") as Response,
    );
    await expect(transcribeAudio("file:///tmp/clip.m4a")).rejects.toBeInstanceOf(ApiRequestError);
  });
});

// ---------------------------------------------------------------------------
// Spoken replies
// ---------------------------------------------------------------------------

describe("speak", () => {
  it("cuts off in-progress speech before speaking", () => {
    speak("On my way.");
    expect(Speech.stop).toHaveBeenCalled();
    expect(Speech.speak).toHaveBeenCalledWith("On my way.");
  });

  it("ignores empty replies", () => {
    speak("");
    expect(Speech.speak).not.toHaveBeenCalled();
  });

  it("stopSpeaking stops speech", () => {
    stopSpeaking();
    expect(Speech.stop).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe("describeVoiceError", () => {
  it("explains an unreachable device instead of a bare network error", () => {
    expect(describeVoiceError(new ApiRequestError("Network error", 0))).toMatch(
      /couldn't reach the robot/i,
    );
  });

  it("explains a transcription timeout", () => {
    expect(describeVoiceError(new ApiRequestError("Request timed out", 0))).toMatch(
      /too long to transcribe/i,
    );
  });

  it("explains an expired device session", () => {
    expect(describeVoiceError(new ApiRequestError("Unauthorised", 401))).toMatch(/session expired/i);
  });

  it("surfaces the robot's 503 detail for missing STT prerequisites", () => {
    const message = describeVoiceError(
      new ApiRequestError("STT model not installed at /var/lib/nomon/stt", 503),
    );
    expect(message).toMatch(/isn't set up on the robot/i);
    expect(message).toMatch(/model not installed/i);
  });

  it("maps 413 to a too-long recording hint", () => {
    expect(describeVoiceError(new ApiRequestError("Audio upload exceeds the limit", 413))).toMatch(
      /too long/i,
    );
  });

  it("maps 422 to an unintelligible-audio hint", () => {
    expect(describeVoiceError(new ApiRequestError("could not decode audio", 422))).toMatch(
      /couldn't make sense/i,
    );
  });

  it("falls back to the error message for other failures", () => {
    expect(describeVoiceError(new ApiRequestError("Too many requests", 429))).toBe(
      "Too many requests",
    );
    expect(describeVoiceError(new Error("boom"))).toBe("boom");
    expect(describeVoiceError(undefined)).toMatch(/something went wrong/i);
  });
});
