/**
 * Voice command service: record on the phone, transcribe on the robot,
 * speak the reply.
 *
 * The Anthropic API accepts no audio, so speech-to-text happens on the device
 * (nomothetic Phase 28, ADR-020 there): the app records a short clip with
 * expo-audio, uploads it to `POST /api/ai/transcribe` (device JWT, multipart),
 * and feeds the returned text to the same `/api/ai/command` path the keyboard
 * uses. Replies to voice commands are spoken with expo-speech. Both modules
 * are official Expo SDK packages, so the whole flow works in Expo Go and on
 * web — no dev build needed.
 */

import { AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import type { RecordingOptions } from "expo-audio";
import * as Speech from "expo-speech";
import { Platform } from "react-native";

import { ApiRequestError, deviceApi } from "@/lib/api";
import { ENDPOINTS } from "@/lib/endpoints";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

/** Response shape of the device transcription endpoint. */
export interface TranscribeResponse {
  /** Recognised text; empty when the clip contained no recognisable speech. */
  text: string;
  engine: string;
  timestamp: string;
}

/**
 * Transcription timeout. The robot lazy-loads its speech model on the first
 * request (several seconds on a Pi Zero 2W) on top of upload + recognition.
 */
export const TRANSCRIBE_TIMEOUT_MS = 60_000;

/** Recorder configuration for voice clips (speech, not music — low is plenty). */
export const VOICE_RECORDING_OPTIONS: RecordingOptions = RecordingPresets.LOW_QUALITY;

// ---------------------------------------------------------------------------
// Availability & permissions
// ---------------------------------------------------------------------------

/**
 * Whether this platform can record voice input. Native platforms always can
 * (expo-audio ships in Expo Go); web needs MediaRecorder + getUserMedia.
 */
export function isVoiceInputAvailable(): boolean {
  if (Platform.OS !== "web") return true;
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

/** Ask for microphone permission; false when the user declines. */
export async function ensureMicPermission(): Promise<boolean> {
  const response = await AudioModule.requestRecordingPermissionsAsync();
  return response.granted;
}

/** Put the audio session into recording mode (required on iOS). */
export async function enterRecordingMode(): Promise<void> {
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
}

/** Leave recording mode so playback (spoken replies) uses the speaker. */
export async function exitRecordingMode(): Promise<void> {
  await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
}

// ---------------------------------------------------------------------------
// Transcription upload
// ---------------------------------------------------------------------------

/**
 * Upload a finished recording to the robot and return its transcript.
 *
 * @param uri Recording location from the expo-audio recorder — a file:// URI
 *   on native, a blob: URL on web.
 * @returns The recognised text; an empty string means the robot heard nothing.
 */
export async function transcribeAudio(uri: string): Promise<string> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("audio", blob, "clip.webm");
  } else {
    // React Native FormData takes a file descriptor object, not a Blob.
    form.append("audio", {
      uri,
      name: "clip.m4a",
      type: "audio/m4a",
    } as unknown as Blob);
  }
  const resp = await deviceApi<TranscribeResponse>(ENDPOINTS.AI_TRANSCRIBE, {
    method: "POST",
    formData: form,
    timeoutMs: TRANSCRIBE_TIMEOUT_MS,
  });
  return resp.text;
}

// ---------------------------------------------------------------------------
// Spoken replies
// ---------------------------------------------------------------------------

/** Speak a reply aloud, cutting off anything already being spoken. */
export function speak(text: string): void {
  if (text.length === 0) return;
  Speech.stop();
  Speech.speak(text);
}

/** Stop any in-progress speech. */
export function stopSpeaking(): void {
  Speech.stop();
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * Turn a failed voice interaction into a clear, actionable message.
 *
 * Mirrors `describeCommandError` in lib/ai.ts: an unreachable device must not
 * read as "nothing happened", and a robot without the speech model installed
 * should say exactly that instead of a bare 503.
 */
export function describeVoiceError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 0) {
      if (/tim(e|ed) out/i.test(err.message)) {
        return "The robot took too long to transcribe. Check it's online and try again.";
      }
      return "Couldn't reach the robot. Check it's powered on and you're connected to it.";
    }
    if (err.status === 401) {
      return "Your device session expired. Reconnect to the device and try again.";
    }
    if (err.status === 503) {
      return `Voice isn't set up on the robot yet: ${err.message}`;
    }
    if (err.status === 413) {
      return "That recording was too long. Keep voice commands under about 15 seconds.";
    }
    if (err.status === 422) {
      return "The robot couldn't make sense of that recording. Try again.";
    }
    return err.message;
  }
  const message = (err as Error | undefined)?.message;
  return message && message.length > 0 ? message : "Something went wrong. Try again.";
}
