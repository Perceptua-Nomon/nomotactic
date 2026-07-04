# ADR-002: AI-Ready UX Pattern

**Status:** Accepted (implemented — Phase 3 wired the bar to the device's
Claude relay, nomothetic Phase 26; see the Future section for what remains)  
**Date:** 2026-04-10  
**Deciders:** Perceptua  

---

## Context

nomon robots are designed to be intelligent, semi-autonomous agents. The user
interface should accommodate two interaction modes:

1. **Traditional GUI** — buttons, sliders, cards for direct device control
2. **Conversational / AI** — natural language commands, chat-style interaction
   with an AI agent that orchestrates robot actions

The question is how to structure the UI so that AI interaction can be added
incrementally without a redesign.

Options evaluated:

1. **Separate chat screen.** A dedicated page/tab for AI conversation,
   separate from the control dashboard. Risk: users must switch contexts;
   AI interaction feels bolted on.
2. **Command bar overlay.** A persistent input bar at the bottom of the
   dashboard (similar to Spotlight, Raycast, or mobile assistant patterns).
   Always visible; results appear inline. Risk: limited real estate on
   mobile.
3. **Voice-first.** Primary interaction via microphone/speaker, with the
   GUI as a secondary display. Risk: requires speech processing
   infrastructure that doesn't exist yet.
4. **No AI affordance yet.** Build a pure GUI now; add AI later. Risk:
   retrofitting a conversational interface requires layout changes.

## Decision

Use a **persistent command input bar** at the bottom of the authenticated
app layout (option 2).

- Always visible in the `(app)` route group layout
- Text input with a submit button
- Results appear as inline response bubbles below the input
- Initially wired to a stub handler that returns a placeholder message
- Designed to be connected to a backend AI/LLM endpoint in a future phase

## Rationale

- **Progressive disclosure.** The command bar is minimal — a single text
  input. It doesn't compete with the GUI controls above it. Users who
  prefer buttons never need to use it.
- **No layout redesign needed later.** The bar is architecturally present
  from day one. Connecting it to a real AI endpoint is a backend change
  and a handler swap — no UI restructuring.
- **Familiar pattern.** Command bars / chat inputs are well-understood
  UX patterns (Slack, iMessage, terminal). No learning curve.
- **Works on all platforms.** Text input works on mobile (keyboard-avoiding
  view) and web (fixed bottom bar) with standard Expo/RN primitives.
- **Lightweight.** No AI/ML dependencies in the client. The input sends
  a string to an API endpoint and renders the response. The intelligence
  lives server-side.

## Trade-offs

- **Screen real estate.** The input bar consumes ~50 dp at the bottom of
  the screen on mobile. Acceptable given the single-screen dashboard
  approach — scrollable content above.
- **Stub feels incomplete.** Until a real AI backend exists, the command
  bar returns a placeholder. Mitigated by clear "Coming soon" messaging
  and disabling the bar if no AI endpoint is configured.
- **Response rendering.** Complex AI responses (tables, images, multi-step
  actions) will need a richer response renderer. Start with plain text;
  extend as needed.

## Implementation Constraints

- `CommandInput` component: self-contained, no external state management
  library. Uses local `useState` for input text and response.
- Keyboard-avoiding behaviour: `KeyboardAvoidingView` on mobile;
  CSS `position: fixed` on web.
- Stub handler is a plain async function `(input: string) => Promise<string>`.
  Swappable for a real API call without component changes.

## Consequences

- New `components/CommandInput.tsx` component
- `app/(app)/_layout.tsx` renders the command bar below the page content
- No AI/ML dependencies added to `package.json`
- Future AI integration requires only: (1) a backend endpoint, (2) replacing
  the stub handler function

## Future

- ~~Connect to a nomothetic AI endpoint (LLM-powered command interpretation)~~
  ✅ Phase 3: `POST /api/ai/command` (nomothetic Phase 26) with conversation
  context, robot action chips, and inline on-robot API-key setup
- Rich response types (action confirmations beyond chips, sensor visualizations)
- Voice input via device microphone (tap-to-speak in the command bar)
- Context-aware suggestions (auto-complete based on device state)
