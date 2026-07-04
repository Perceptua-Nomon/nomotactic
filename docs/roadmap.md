# nomotactic — Development Roadmap

## Status Summary

| Phase | Name | Status |
|-------|------|--------|
| 1.1 | Project Foundation | ✅ Complete |
| 1.2 | Auth Flow | ✅ Complete |
| 1.3 | Device Control Dashboard | ✅ Complete |
| 1.4 | Web Experience | ✅ Complete |
| 1.5 | BLE Abstraction Stubs | ⊘ Superseded by Phase 15 |
| 1.6 | AI-Ready Command Input | ✅ Complete |
| 2 | BLE Integration | ⊘ Superseded by Phase 15 |
| 2.1 | BLE Simplification | ⊘ Superseded by Phase 15 |
| 2.2 | BLE Pairing Architecture Corrections | ⊘ Superseded by Phase 15 |
| 8 | Device Fleet Registration | ✅ Complete |
| 15 | Soft AP / WiFi Provisioning | ✅ Complete (cross-repo; see nomopractic ADR-005) |
| 4 | Fleet Management Dashboard | ✅ Complete (cross-repo; see nomothetic Phase 25) |
| 3 | AI Integration | 🔶 Chat + actions complete (cross-repo; see nomothetic Phase 26); suggestions & voice deferred |

---

## Current State

Phases 1, 2, 2.1, and 2.2 are complete (BLE phases superseded by Phase 15 — Wi-Fi Soft AP). The app has:
- Expo SDK 54 with expo-router navigation
- Dark theme, typed API client with auth injection and 401 retry guard
- JWT auth flow with expo-secure-store (mobile) / sessionStorage refresh + memory-only access tokens (web)
- Device control dashboard with 5 expandable card components
- Web landing page for unauthenticated visitors
- Wi-Fi Soft AP pairing: HTTP pairing flow (`POST /api/device/auth/pair/ap`) accessible at `http://192.168.4.1:8080` (plain HTTP, nomothetic ADR-015)
- Connection state indicator with auto-reconnect
- AI command bar wired to the device's Claude relay (chat with conversation
  context, robot action chips, inline on-robot API-key setup)
- Guest mode: unauthenticated users can pair via Soft AP without an account
- Local device registry: Soft-AP-paired devices appear on the dashboard with a "Local" badge
- `npx expo lint` clean

### Hotfixes

- 2026-04-14: iOS logout redirect loop (`Maximum update depth exceeded`) fixed
  by keeping `/login` as the unauthenticated redirect target for `(app)` and
  centralizing post-login route transition in `login.tsx` auth-state redirect.

---

## Phase 1 — App Foundation & Auth

**Goal:** Deliver a functional cross-platform app with authentication,
device control, and a web landing page. Establish the patterns for all
future development.

**Cross-repo dependency:** Requires nomothetic Phase 13 (central mode +
JWT auth) for auth flow and fleet endpoints.

### 1.1 — Project Foundation

**Goal:** Establish theming, API client, configuration, and project structure.

- [x] `constants/config.ts` — API base URL (device and central), configurable
      per environment
- [x] `lib/theme.ts` — colour palette, spacing, typography constants (dark
      theme primary, light secondary)
- [x] `lib/api.ts` — typed API client wrapping `fetch`:
  - Base URL from config
  - Auth header injection (reads token from context)
  - Response parsing matched to nomothetic Pydantic error shapes
  - Timeout handling (10 s default)
  - 401 interception for auto-refresh
- [x] Modify `app/_layout.tsx` — set `StatusBar`, wrap in providers
- [x] Add `expo-secure-store` dependency
- [x] Remove or archive `app-example/` directory

**Exit criteria:**
- ✅ `npx expo lint` clean
- ✅ API client can be imported and instantiated in a test component
- ✅ Theme constants applied to root layout

### 1.2 — Auth Flow

**Goal:** Login and registration with secure token persistence.

**Dependency:** nomothetic Phase 13.2–13.3 (JWT auth module + user endpoints).

- [x] `lib/auth.ts` — `AuthContext` and `AuthProvider`:
  - `login(email, password)` → calls `POST /api/auth/login`, stores tokens
  - `register(email, password, displayName)` → calls `POST /api/auth/register`
  - `logout()` → clears tokens
  - `refreshToken()` → calls `POST /api/auth/refresh`, rotates tokens
  - `isAuthenticated: boolean` derived from token presence
  - Token storage: `expo-secure-store` on mobile, `sessionStorage` (refresh) /
    memory-only (access) on web (see ADR-018)
- [x] `app/login.tsx` — single-screen login / register:
  - Email + password fields
  - Toggle between login and register mode (progressive disclosure)
  - Social login placeholder buttons (disabled, "Coming Soon" label)
  - Error display (inline, below form)
  - Loading state on submit
- [x] `app/_layout.tsx` — wrap children in `AuthProvider`
- [x] Tests: manual verification (login → token stored → authenticated state)

**Exit criteria:**
- ✅ Login screen renders on all platforms
- ✅ Successful login stores token and updates `isAuthenticated`
- ✅ 401 from API triggers automatic token refresh attempt
- ✅ `npx expo lint` clean

### 1.3 — Device Control Dashboard

**Goal:** Fleet-first dashboard with per-device control detail.

- [x] `app/(app)/_layout.tsx` — authenticated route group:
  - Auth guard: redirect to `/login` if not authenticated
  - Layout wrapper (safe area, content slot, command bar)
- [x] `app/(app)/index.tsx` — dashboard with fleet list + pairing form
- [x] `app/(app)/device/[id].tsx` — per-device control page
- [x] `lib/devices.ts` — fleet hook for list/refresh + last-seen formatter
- [x] `components/StatusCard.tsx` — battery voltage, uptime, firmware version,
      connection indicator. Auto-refreshes every 5 s.
- [x] `components/MotorCard.tsx` — directional pad (forward / backward / left /
      right / stop), speed slider (0–100%). Sends `POST /api/drive` and
      `POST /api/steer`. Hidden on web (HTTPS-only; no mobile-only transport).
- [x] `components/CameraCard.tsx` — capture still button, link to MJPEG stream
      URL. Shows last-captured image inline.
- [x] `components/SensorCard.tsx` — ultrasonic distance, grayscale readings
      (raw + normalized). Manual refresh button.
- [x] `components/RoutineCard.tsx` — start/stop explore routine, live status
      (elapsed time, obstacle/cliff counts). Polls `/api/routine/status`.

**Exit criteria:**
- ✅ Devices dashboard renders fleet list and pairing controls
- ✅ Device detail route renders all control cards
- ✅ Status card fetches and displays battery voltage from device API
- ✅ Motor controls send API requests and display feedback
- ✅ Platform-conditional rendering verified (web hides motor card)
- ✅ `npx expo lint` clean

### 1.4 — Web Experience

**Goal:** Landing page for unauthenticated web visitors.

- [x] Modify `app/index.tsx` — platform + auth-aware routing:
  - `Platform.OS === 'web'` + not authenticated → render landing content
  - Mobile + not authenticated → redirect to `/login`
  - Authenticated (any platform) → redirect to `/(app)/`
- [x] Landing page content:
  - Hero section with product tagline
  - Feature highlights (3–4 bullet points)
  - "Get Started" CTA button → navigates to `/login`
  - Minimal styling with theme constants, no external CSS framework

**Exit criteria:**
- ✅ Web browser shows landing page when not logged in
- ✅ CTA navigates to login
- ✅ Mobile skips landing page (goes directly to login or dashboard)
- ✅ `npx expo lint` clean

### 1.5 — BLE Abstraction Stubs ⊘ Superseded by Phase 15

**Goal:** Define the Bluetooth Low Energy service interface for future
implementation.

- [x] `lib/ble.ts`:
  - `BleService` interface: `scan()`, `connect(deviceId)`, `disconnect()`,
    `sendCommand(method, params)`, `onStatusChange(callback)`
  - `ConnectionStatus` type: `disconnected | scanning | connecting | connected`
  - `MockBleService` class: all methods return stub/simulated data
  - `createBleService()` factory: returns `MockBleService`
- [x] No BLE library added to `package.json` — purely TypeScript interfaces

**Exit criteria:**
- ✅ `BleService` interface importable from `lib/ble`
- ✅ `MockBleService` instantiable and callable without errors
- ✅ `npx expo lint` clean

### 1.6 — AI-Ready Command Input

**Goal:** Persistent command bar for future AI interaction
(see [ADR-002](docs/adr/002-ai-ready-ux.md)).

**Dependency:** Phase 1.3 (dashboard layout exists).

- [x] `components/CommandInput.tsx`:
  - `TextInput` with submit button
  - Inline response bubble (appears below input after submission)
  - Stub handler: `async (input: string) => "Command processing coming soon"`
  - `KeyboardAvoidingView` on mobile; fixed-position on web
  - Self-contained state (no external state management)
- [x] Modify `app/(app)/_layout.tsx` — render `CommandInput` below page content

**Exit criteria:**
- ✅ Command bar visible at bottom of dashboard on all platforms
- ✅ Typing and submitting shows stub response
- ✅ Keyboard avoidance works on mobile
- ✅ `npx expo lint` clean

---

## Phase 1 Exit Criteria (aggregate)

- [x] Authenticated user can log in, see device status, control motors, and view sensors
- [x] Web visitors see a landing page; authenticated web users see the dashboard
- [x] BLE interface defined (stubs only)
- [x] Command input bar present and functional (stub response)
- [x] `npx expo lint` clean across all files
- [x] No third-party UI component libraries added

---

## Future

### Phase 2 — BLE Integration ⊘ Superseded by Phase 15

**Goal:** Implement real BLE connectivity for device discovery, pairing,
and basic control commands. BLE is the primary transport on mobile when WiFi
is unavailable. When WiFi is available, all control goes over HTTPS. Web
users are HTTPS-only (no BLE).

**Architecture decisions:**
- nomopractic ADR-001: BLE GATT server in nomopractic
- nomopractic ADR-002: Binary protocol for BLE GATT ⚠️ Superseded by ADR-004
- nomopractic ADR-003: BLE security model ⚠️ Superseded by ADR-004
- nomopractic ADR-004: BLE Simplification — Native OS Pairing + NDJSON Relay ✅ (implemented in Phase 2.1)

**Cross-repo dependencies:**
- nomopractic Phase 13: BLE GATT server (must be deployed first)
- nomothetic Phase 18: shared pairing secret, BlueZ setup

**Platform note:** BLE is mobile-only (Android / iOS via `react-native-ble-plx`).
Web users control devices over HTTPS after manual WiFi setup. This is a known
limitation documented in architecture.md.

#### 2.1 — BLE Library & Dev Build

- [x] Add `react-native-ble-plx` dependency to `package.json`
- [x] Configure Expo development build (BLE requires native modules — not
      available in Expo Go)
- [x] Android: add `ACCESS_FINE_LOCATION`, `BLUETOOTH_SCAN`,
      `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE` permissions to
      `app.json` / `AndroidManifest.xml`
- [x] iOS: add `NSBluetoothAlwaysUsageDescription` to `Info.plist` via
      `app.json` `ios.infoPlist`
- [x] Verify: `react-native-ble-plx` initializes without crash on both
      platforms

#### 2.2 — BLE Discovery & Connection (`lib/ble.ts`)

- [x] `RealBleService` class implementing `BleService` interface:
  - `scan(timeoutMs)`: scan for nomon devices by Pairing Service UUID
    (`e3a10001-7b2a-4b9c-8f5a-2b7d6e4f1a3c`)
  - `connect(deviceId)`: connect, negotiate MTU (request 247)
  - `disconnect()`: clean disconnect, clear session state
  - `onStatusChange(listener)`: emit status on connection lifecycle events
- [x] Update `createBleService()` factory: return `RealBleService` on mobile,
      `MockBleService` on web
- [x] Platform guard: `Platform.OS === 'web'` returns mock; native returns real
- [x] BLE permission request flow (Android 12+ runtime permissions)

> ⚠️ **Phases 2.2–2.8 describe work superseded by Phase 2.1.** The binary codec, AES-128-CCM encryption, and custom pairing ceremony described below were fully removed and replaced by OS-level passkey pairing and NDJSON relay. These sections are retained for historical reference only.

#### 2.3 — Binary Protocol Codec (`lib/ble-protocol.ts`)

- [x] `BleOpcode` enum matching nomopractic ADR-002 opcode table
- [x] `encodeCommand(opcode, payload) -> Uint8Array`: 3-byte header + payload
- [x] `decodeResponse(bytes) -> { opcode, seqNr, payload }`: parse response frame
- [x] Fixed-point helpers: `speedToX100(pct)`, `angleToX10(deg)`,
      `mvToVolts(mv)`, `x10ToCm(val)`
- [x] Little-endian read/write helpers using `DataView`
- [x] Unit tests: encode/decode round-trip for every opcode

#### 2.4 — BLE Pairing Flow

- [x] `lib/ble.ts`: `pair(secret: string) -> Promise<PairingResult>`:
  - Write secret to Pairing Secret characteristic
  - Subscribe to Auth Token notifications
  - Receive `salt (16B) || jwt_bytes`
  - Derive `session_key` via HKDF-SHA256
    (`ikm=secret, salt=received_salt, info="nomon-ble-session", len=16`)
  - Store JWT in `expo-secure-store` (same storage as HTTP tokens)
  - Return `{ jwt, sessionKey }`
- [x] Crypto: use `@noble/hashes` for HKDF-SHA256, `@noble/ciphers` for
      AES-128-CCM (pure JS, no native module needed)
- [x] `BleSession` class: holds `sessionKey`, `clientCounter`, `serverCounter`
  - `encrypt(frame) -> Uint8Array`: AES-128-CCM encrypt, increment counter
  - `decrypt(frame) -> Uint8Array`: AES-128-CCM decrypt, verify counter
- [x] Pairing UI: reuse existing pairing prompt in `app/index.tsx` — add
      BLE pairing mode when device discovered via scan

#### 2.5 — BLE Command Interface

- [x] `lib/ble.ts`: add typed command methods:
  - `getBattery(): Promise<{ voltageMv: number }>`
  - `drive(speedPct: number, ttlMs?: number): Promise<void>`
  - `steer(angleDeg: number, ttlMs?: number): Promise<void>`
  - `setMotorSpeed(channel: number, speedPct: number, ttlMs?: number): Promise<void>`
  - `stopAllMotors(): Promise<void>`
  - `setServoAngle(channel: number, angleDeg: number, ttlMs?: number): Promise<void>`
  - `readUltrasonic(): Promise<{ distanceCm: number }>`
  - `readGrayscale(): Promise<{ values: number[] }>`
  - `getHealth(): Promise<{ status: number, uptimeS: number }>`
- [x] Each method: encode binary frame → encrypt → write to Command
      characteristic → await notification → decrypt → decode response
- [x] Sequence number management (increment per request, match on response)
- [x] Timeout handling (5 s default, configurable)
- [x] Update `MotorCard.tsx` and `SensorCard.tsx` to call BLE methods when
      BLE is the active transport (no API change to components)

#### 2.6 — WiFi Provisioning UI

- [x] `lib/ble.ts`: WiFi provisioning methods:
  - `scanWifi(): Promise<WifiNetwork[]>` — write WiFi Command `0x01`,
    read WiFi Status for results
  - `connectWifi(ssid: string, password: string): Promise<void>` — write
    SSID + Password + Command `0x02`, poll Status until connected/failed
  - `getWifiStatus(): Promise<WifiState>` — read WiFi Status characteristic
- [x] Post-pairing flow: if BLE-only, prompt user for WiFi credentials
  - Show scanned SSIDs in picker
  - Password input
  - Connection progress indicator
  - On success: switch transport to HTTPS (JWT already stored)
  - On failure: remain on BLE, show error, allow retry

#### 2.7 — Hybrid Transport Layer (`lib/transport.ts`)

- [x] New `TransportProvider` context:
  - `transport: 'https' | 'ble'` — current active transport
  - `bleService: BleService` — BLE service instance
  - `switchToHttps(deviceUrl: string)` — called after WiFi provisioning
  - Auto-detect: if HTTPS is reachable, prefer HTTPS; fall back to BLE
- [x] Component integration: `StatusCard`, `MotorCard`, `SensorCard` read
      from transport context to decide API client vs BLE service
- [x] Transparent to components — same method signatures, different underlying
      transport
- [x] Battery level: subscribe to BLE Battery Level notifications when on BLE

#### 2.8 — Connection State & Reconnection

- [x] `components/ConnectionIndicator.tsx`:
  - Shows transport mode icon (WiFi / Bluetooth / Disconnected)
  - Colour-coded: green (connected), yellow (reconnecting), red (disconnected)
  - Positioned in device detail header
- [x] BLE disconnect detection:
  - `react-native-ble-plx` emits disconnect events
  - Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
  - During reconnect: show indicator, queue commands (or reject with error)
- [x] On reconnect: if session key is still valid (same power cycle),
      resume; otherwise, re-pair
- [x] Motor auto-stop: if connection lost for > `ttl_ms`, nomopractic's
      watchdog idles motors (existing safety mechanism)

#### Phase 2 Exit Criteria
- [x] BLE device discovery finds nomon devices on mobile
- [x] OS passkey pairing replaces custom pairing ceremony (no app-layer secret exchange)
- [x] Motor, servo, and sensor commands work over BLE
- [x] WiFi credentials exchangeable over BLE; Pi joins WiFi
- [x] Auto-switch from BLE to HTTPS when WiFi becomes available
- [x] Connection indicator shows transport state
- [x] Auto-reconnect on BLE disconnect
- [x] Web users unaffected (HTTPS only, motor controls hidden)
- [x] `npx expo lint` clean
- [x] No third-party UI component libraries added

---

### Phase 2.1 — BLE Simplification ⊘ Superseded by Phase 15

**Goal:** Replace the custom BLE binary protocol, AES-128-CCM encryption,
and application-layer pairing ceremony with OS-level Bluetooth passkey
pairing and plain NDJSON commands. Reduces ~1,400 lines of BLE client code
to ~400 lines. The simplified BLE layer sends the same JSON format used by
the HTTPS API client, making every IPC method automatically available.

**Architecture decisions:**
- nomopractic ADR-004: BLE Simplification — Native OS Pairing + JSON Relay
- Supersedes: nomopractic ADR-002 (Binary Protocol), ADR-003 (BLE Security Model)

**Cross-repo dependencies:**
- nomopractic Phase 13.1: simplified GATT server (must be deployed first)
- nomothetic Phase 18.1: pairing secret format change (6-digit numeric passkey)

#### 2.1.1 — Delete Superseded Modules
- [x] Delete `lib/ble-protocol.ts` — binary protocol codec (324 lines)
- [x] Delete `lib/ble-session.ts` — AES-128-CCM + HKDF key derivation (172 lines)
- [x] Delete `lib/ble-registration.ts` — pending registration state (38 lines)
- [x] Remove `@noble/ciphers` and `@noble/hashes` from `package.json`
      (no longer needed without app-layer crypto)
- [x] Verify: `npx expo lint` clean after import cleanup

#### 2.1.2 — Simplified BLE Service (`lib/ble.ts`)
- [x] Remove imports of `ble-protocol`, `ble-session`
- [x] Remove `ConnectionStatus` value `"paired"` — bonding is OS-managed;
      status goes from `"connecting"` directly to `"connected"` after bonding
- [x] Remove `PairingResult` type and `pair(secret)` method
- [x] Remove `session` property and `BleSession` field from `BaseBleService`
- [x] Remove `sendCommand(opcode, payload)` method (binary)
- [x] Add `sendJsonCommand(method: string, params: object): Promise<object>`:
  - Build NDJSON request: `{ id, method, params }`
  - Chunk at (MTU − 3) boundary, write chunks to Command Write characteristic
  - Subscribe to Response Notify; accumulate chunks until `\n`
  - Parse JSON response; return `result` or throw on error
  - Sequence ID management: monotonic string counter
  - Timeout: 10 s default (configurable)
- [x] Rewrite typed command helpers (`getBattery`, `drive`, `steer`, etc.)
      to call `sendJsonCommand()` instead of binary encode → encrypt → write
- [x] Add `authenticate(): Promise<string>`:
  - Calls `sendJsonCommand("authenticate", {})`
  - Returns JWT string
  - Stores JWT in `expo-secure-store`
- [x] Rewrite WiFi methods (`scanWifi`, `connectWifi`, `getWifiStatus`)
      to call `sendJsonCommand("wifi_scan", ...)` etc. instead of custom
      WiFi characteristic writes
- [x] `GATT UUIDs`: remove pairing, WiFi, and status service/characteristic
      UUIDs. Keep: service `e3a10001-...`, Command Write `e3a12001-...`,
      Response Notify `e3a12002-...`
- [x] Update `RealBleService.connect()`:
  - Connect to device (OS triggers passkey pairing dialog automatically)
  - Negotiate MTU (request 247)
  - Discover the single nomon service + 2 characteristics
  - Subscribe to Response Notify
  - Set status to `"connected"`
  - No custom pairing ceremony — bonding is OS-managed
- [x] Update `MockBleService` for web/testing (same interface changes)

#### 2.1.3 — Simplified Pairing Flow (`components/BlePairingFlow.tsx`)
- [x] Remove secret input field (`TextInput` for pairing secret)
- [x] Remove `blePairingSecret` and `setBlePairingSecret` state
- [x] Simplified flow:
  1. Scan for devices (existing)
  2. User selects a device from the list (existing)
  3. Call `ble.connect(deviceId)` — OS shows native passkey dialog
  4. User enters 6-digit passkey on phone (OS handles UI)
  5. Once connected + bonded, call `ble.authenticate()` to get JWT
  6. Store JWT and navigate to device control
- [x] Update `handleBlePair()` to:
  - Connect (triggers OS pairing)
  - Authenticate (get JWT via BLE)
  - Store JWT via auth context
  - Navigate to device control
- [x] Remove `setPendingBleRegistration` import (module deleted)

#### 2.1.4 — Transport Layer Update
- [x] Update `lib/transport.ts` (if applicable):
  - Remove references to `BleSession`
  - Remove encryption/decryption from transport path
  - BLE transport now sends/receives plain JSON (same format as HTTPS)

#### 2.1.5 — Architecture Documentation
- [x] Update `docs/architecture.md`:
  - Platform Modes table: update "Mobile, BLE only" row — remove "binary
    protocol" reference, note NDJSON commands
  - BLE data flow: scan → connect → OS passkey → authenticate → JSON commands
  - Remove references to `ble-protocol.ts`, `ble-session.ts`

#### Phase 2.1 Exit Criteria
- [x] BLE device discovery works (unchanged)
- [x] OS passkey pairing replaces custom pairing ceremony
- [x] NDJSON commands work over BLE (same format as HTTPS/IPC)
- [x] `authenticate` returns JWT after bonding
- [x] WiFi provisioning uses standard JSON methods
- [x] NDJSON chunking handles responses exceeding BLE MTU
- [x] Auto-reconnect preserves bonding (no re-pairing needed)
- [x] Web users unaffected (HTTPS only)
- [x] Crypto dependencies removed (`@noble/ciphers`, `@noble/hashes`)
- [x] `npx expo lint` clean
- [x] No third-party UI component libraries added

### Phase 2.2 — BLE Pairing Architecture Corrections ⊘ Superseded by Phase 15

**Goal:** Fix three bugs in the BLE pairing flow that prevent the intended
unauthenticated pairing path from working end-to-end.

**Issues addressed:**
- F-01: Auth guard blocks BLE pairing for unauthenticated users
- F-04: BLE session is discarded when navigating to the device page
- F-05: Newly paired device doesn't appear on the dashboard

See [ADR-003](adr/003-ble-pairing-arch-corrections.md) for design rationale.

#### 2.2.1 — Guest Mode (F-01)

- [x] `lib/auth.tsx` — add `isGuest: boolean` to `AuthState`; add
      `continueAsGuest(): void` action (in-memory flag, cleared on restart and logout)
- [x] `app/login.tsx` — add "Continue without account" `Pressable` below the form
      card; calls `continueAsGuest()` + `router.replace('/(app)')`
- [x] `app/index.tsx` — update redirect check: `if (isAuthenticated || isGuest)`
- [x] `app/(app)/_layout.tsx`:
  - Change auth guard: `if (!isAuthenticated && !isGuest)` → redirect to `/login`
  - Top bar: render "Sign In" link for guests (navigates to `/login`) in place
    of the "Logout" button

**Exit criteria:**
- Guest user reaches `/(app)` dashboard without logging in
- Authenticated users unaffected
- `npx expo lint` clean

#### 2.2.2 — BLE Session Registry (F-04)

- [x] `lib/ble.ts` — add module-level `Map<string, BleService>` registry; export
      `registerBleSession(deviceId, ble)`, `getBleSession(deviceId)`,
      `clearBleSession(deviceId)`
- [x] `lib/transport.tsx`:
  - Add `activateSession(deviceId: string): Promise<void>` to context value —
    looks up registry, wires `bleServiceRef.current`, checks WiFi, sets mode
  - Add `AppState` change listener in provider: call `disconnectDevice()` when
    app moves to background
  - `disconnectDevice()` calls `clearBleSession(deviceId)` before resetting state
- [x] `app/_layout.tsx` — add `<TransportProvider>` wrapping inside `<AuthProvider>`
- [x] `app/(app)/device/[id].tsx`:
  - Remove per-page `<TransportProvider>` wrapper
  - Add `useEffect(() => { transport.activateSession(id); }, [id])` via root
    transport context
- [x] `components/BlePairingFlow.tsx` — call `registerBleSession(deviceId, ble)`
      after `ble.authenticate()` succeeds; navigate to
      `/(app)/register-device?deviceId=${deviceId}`

**Exit criteria:**
- Navigating from pairing flow to device page does not drop the BLE connection
- `transport.mode` is `'ble'` or `'https'` (not `'disconnected'`) on device page mount
- App backgrounding disconnects BLE and clears session
- `npx expo lint` clean

#### 2.2.3 — Local Device Registry (F-05)

- [x] `lib/local-devices.ts` — **new file**: `LocalDevice` type + CRUD over
      cross-platform storage (`nomon_local_devices` key); no new npm dependency
- [x] `lib/devices.ts`:
  - Add `source: 'central' | 'local'` field to `Device` interface
  - `useDevices` loads `getLocalDevices()` in parallel with central API fetch
  - Merges results; deduplicates by VIN (central wins); local devices tagged
    `source: 'local'`
- [x] `components/BlePairingFlow.tsx` — call `saveLocalDevice(...)` after
      `registerBleSession`; navigate to `/(app)/register-device?deviceId=${deviceId}`
- [x] `app/(app)/register-device.tsx`:
  - Read `deviceId` from `useLocalSearchParams()`
  - After successful `pairWithDevice()`: fetch `/api/status` to retrieve VIN,
    then call `updateLocalDevice(deviceId, { vin })`
  - Navigate to `/(app)/device/${deviceId}` (not `/(app)`)
- [x] `app/(app)/index.tsx` — render "Local" pill badge for
      `device.source === 'local'` in `renderDeviceCard()`

**Exit criteria:**
- Freshly paired device appears on dashboard immediately after pairing (before
  any central fleet registration)
- Local device badge is visually distinguishable from fleet-registered devices
- `useDevices` works for guest users (central API unavailable; local list shows)
- `npx expo lint` clean

#### Phase 2.2 Exit Criteria

- [x] User can BLE-pair a device without logging in
- [x] Active BLE session survives navigation to the device page
- [x] Paired device appears on the dashboard for both guest and authenticated users
- [x] `npx expo lint` clean across all modified files

---

### Phase 8 — Device Fleet Registration ✅ Complete

**Goal:** Allow a paired user to register their physical device with the
central fleet API. The device issues a short-lived registration proof JWT;
the client relays it to the central API to create the fleet record.

**Cross-repo dependencies:**
- nomothetic Phase 23 (`GET /api/device/auth/identity`, updated
  `POST /api/fleet/devices`)

#### Deliverables

- [x] `components/DeviceRegistrationForm.tsx` — central fleet registration
      form; discovery-driven flow handles three device states:
      - **direct** — device reachable at the stored URL
      - **ap** — device currently in Soft AP mode
      - **needs-pairing** — no stored device URL yet
- [x] Registration proof flow:
  1. Call `GET /api/device/auth/identity` (device JWT) → receive `vin`,
     `model`, `registration_proof`
  2. Call central `POST /api/fleet/devices` (central JWT) with
     `{ vin, model, registration_proof }` → device registered to account
- [x] Web token storage hardened (ADR-018):
  - Access tokens: memory-only (never written to browser storage)
  - Refresh tokens: `sessionStorage` (tab-scoped)
  - Device URL: `localStorage` (non-sensitive)

#### Phase 8 Exit Criteria

- [x] Authenticated user can register a paired device to their central fleet
      account via `DeviceRegistrationForm`
- [x] Registration proof flow completes end-to-end
- [x] Web: access token is not present in `localStorage` or `sessionStorage`
- [x] `npx expo lint` clean
- [x] `npx tsc --noEmit` — 0 errors

---

### Phase 3 — AI Integration 🔶 Chat + actions complete

Cross-repo phase (paired with nomothetic Phase 26: the device-mode AI
chat-command relay). The command bar now talks to a real Claude endpoint on
the device; the model acts on the robot through a destructive-free tool
surface that reuses the same validation, TTL leases, and device JWT auth as
the manual controls.

**Delivered:**
- [x] `lib/ai.ts` — typed client for the device relay:
      `sendAiCommand(messages)` (long 180 s timeout — the loop can span several
      provider round trips), key management (`getAiKeyStatus` / `setAiKey` /
      `clearAiKey`), `trimHistory` (client-side context cap under the device's
      40-message limit), and `isKeyProblem` (distinguishes "needs a key" /
      "key rejected" failures from provider outages).
- [x] `components/CommandInput.tsx` — rewired from the Phase 1.6 stub:
  - Sends the visible conversation (plain-text turns) so follow-ups have
    context; successful exchanges extend the history, "Clear" resets it.
  - Response bubble renders the reply plus ✓/✕ **action chips** for every
    robot action the model took (drive, steer, sensor reads, routines, ...).
  - Inline Anthropic-key setup appears when the device reports a key problem;
    the key is submitted to `PUT /api/ai/key` and **stored on the robot**
    (0600 file), never in the app or browser storage (web builds cannot
    leak it).
- [x] `lib/endpoints.ts` — `AI_KEY`, `AI_COMMAND`.
- [x] Tests: `tests/lib/ai.test.ts` (fetch-mocked, mirroring the other lib
      suites) — request shapes, history trimming, key-problem detection.

**Deferred to a follow-up:**
- [ ] Context-aware command suggestions
- [ ] Voice input option (tap-to-speak)
- [ ] Richer response rendering (tables, structured device state)

### Phase 4 — Fleet Management Dashboard ✅ Complete

Cross-repo phase (paired with nomothetic Phase 25: telemetry persistence/history
API + profile-edit endpoints). The fleet list already existed via
`useDevices()`; this phase added the operator views on top of it.

**Delivered:**
- **Fleet overview** — aggregate status header (`N devices · M online`) on the
  dashboard (`app/(app)/index.tsx`).
- **Navigation flow** — tapping a (paired) device opens its **control screen**
  (cockpit, `app/(app)/device/[id].tsx`) directly; a **settings cog** in the
  cockpit header (Ionicons, `@expo/vector-icons`) opens the per-device
  **dashboard**. From there the user returns to controls or opens calibration.
  VIN/FW were removed from the cockpit header (that info lives on the dashboard).
  An unpaired card is a no-op — pairing stays on the dashboard's Connect section.
- **Per-device dashboard** (`app/(app)/fleet/[vin].tsx`) — central-data view:
  device metadata + latest telemetry (`GET /api/fleet/devices/{vin}`), telemetry
  history chart, "Return to controls" and "Calibrate device" actions, and
  "Remove from fleet" (`DELETE`). Reached via the cockpit cog; degrades
  gracefully (actions still available) when the device isn't in the central
  fleet. New `lib/fleet.ts` helpers.
- **Telemetry history charts** — `components/TelemetryChart.tsx`, a line/area
  chart over **`react-native-svg`** (battery / CPU temp / uptime, selectable),
  fed by `GET /api/fleet/devices/{vin}/telemetry`.
- **Device calibration UI** (device-mode) — `components/CalibrationCard.tsx` +
  `app/(app)/calibrate.tsx` + `lib/calibration.ts`: motor speed-scale/deadband/
  reversed, servo trim, grayscale white/black capture with a live normalized
  readout, and Save/Reset. Talks to the device API directly (deviceApi),
  reachable over Tailscale/AP; degrades gracefully when the device is unreachable.
- **Profile management** — `app/(app)/profile.tsx` + `lib/profile.ts`: view
  email/joined/last-login, edit display name (`PATCH /api/auth/me`), change
  password (`POST /api/auth/change-password`), and log out. A "Profile" entry was
  added to the top bar; the auth context gained `updateDisplayName` /
  `changePassword`.
- Tests: `tests/lib/fleet.test.ts`, `tests/lib/calibration.test.ts`,
  `tests/lib/profile.test.ts` (fetch-mocked, mirroring `tests/lib/api.test.ts`).

**Dependency note:** `react-native-svg` is the one new runtime dependency — a
drawing primitive, not a UI component kit, so it is a deliberate, documented
exception to the "no third-party UI libraries" rule (architecture.md). All other
UI stays on core React Native primitives.

**Backend dependency (nomothetic Phase 25):** telemetry was MQTT-only with no
REST history and `latest_telemetry` always `null`, and there were no profile-edit
endpoints. That phase added a central MQTT consumer + telemetry store/history API
(consuming the existing nomographic `TelemetryReading`/`ReadFrom` schema) and the
`PATCH /api/auth/me` + `POST /api/auth/change-password` endpoints.
