# ADR-004: Voice Input via Robot-Side Transcription

**Status:** Accepted
**Date:** 2026-07-09
**Deciders:** Perceptua

---

## Context

ADR-002 deferred "voice input via device microphone (tap-to-speak in the
command bar)". With the command bar wired to the device's Claude relay
(Phase 3 / nomothetic Phase 26), voice is the remaining interaction gap.

A hard constraint shapes the design: **the Anthropic Messages API accepts no
audio** — speech must become text before it reaches `POST /api/ai/command`.
Where should speech-to-text run?

1. **Phone-native STT** (`expo-speech-recognition` wrapping the iOS/Android
   recognisers + Web Speech API). Streaming partial transcripts, but a native
   module: it requires an Expo dev build (breaking the Expo Go dev loop),
   behaves differently per platform, and hard-wires the platform recognisers
   with no path to a different model or service.
2. **Robot-side STT.** Record a clip with `expo-audio`, upload it to a new
   nomothetic endpoint, transcribe on the Pi behind a pluggable engine
   (nomothetic ADR-020).
3. **Cloud STT.** A second provider account, and operator audio leaves the
   device.

## Decision

**Record on the phone, transcribe on the robot.** The mic button records a
short clip with `expo-audio`, uploads it to `POST /api/ai/transcribe`
(multipart, device JWT — same auth path as every cockpit control), places the
transcript in the input, and **auto-sends** it through the existing submit
path. Replies to voice-initiated commands are **spoken aloud** with
`expo-speech`, with an inline mute toggle.

## Rationale

- **Engine flexibility.** The STT engine lives behind a server-side protocol
  (nomothetic `SttEngine`); swapping models or wiring a cloud service later
  changes nothing in the app.
- **Expo Go and web keep working.** `expo-audio` and `expo-speech` are
  official Expo SDK modules — no dev build, no native module, one recording
  code path for Android, iOS, and web (MediaRecorder).
- **Auto-send is safe here.** The relay's tool surface is destructive-free
  and movement runs under TTL leases (nomothetic Phase 26), so a
  mis-transcription cannot do worse than a typed mistake; the transcript is
  shown in the input as it sends.
- **Consistent security posture.** Audio rides the same device-JWT HTTPS
  channel as every other command; nothing new is stored in the app.

## Trade-offs

- **No streaming partials.** Record-then-transcribe means the transcript
  appears only after upload + recognition (a few seconds; the robot's first
  request also lazy-loads the model). Acceptable for short command phrases.
- **Robot memory.** The Vosk model shares the Pi Zero 2W's 512 MB — accepted
  and mitigated on the nomothetic side (lazy load, serialized recognition,
  optional install; see nomothetic ADR-020).
- **Mic hidden when unavailable.** If the platform cannot record (old web
  browser) the mic button does not render; the text path is always available.

## Consequences

- New `lib/voice.ts` (availability/permission checks, recording mode,
  multipart transcription upload, speak/stop, friendly error mapping).
- `lib/api.ts` gains a `formData` request option (multipart bodies reuse the
  same base-URL/auth/401-refresh path as JSON requests).
- `components/CommandInput.tsx` gains the mic button (tap to record, tap to
  finish), "Listening…"/"Transcribing…" states, auto-send, spoken replies,
  and a mute toggle.
- Dependencies: `expo-audio` (+ config plugin with the mic permission string)
  and `expo-speech` — capability modules, not UI component libraries, so the
  "no third-party UI libraries" rule is untouched.
- Server counterpart: nomothetic Phase 28 / ADR-020.
