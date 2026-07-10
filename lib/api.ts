/**
 * Typed API client wrapping fetch with auth injection, timeout, and
 * 401 interception for automatic token refresh.
 */

import { CENTRAL_API_URL, DEFAULT_TIMEOUT_MS, DEVICE_API_URL } from "@/constants/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Standard error shape returned by nomothetic. */
export interface ApiError {
  success: false;
  error: string;
  timestamp: string;
}

/** Options for a single API call. */
interface RequestOptions {
  /** HTTP method (default: GET). */
  method?: string;
  /** JSON body (automatically serialised). */
  body?: unknown;
  /**
   * Multipart body (e.g. an audio upload). Takes precedence over `body`;
   * Content-Type is left unset so fetch supplies the multipart boundary.
   */
  formData?: FormData;
  /** Extra headers merged with defaults. */
  headers?: Record<string, string>;
  /** Per-request timeout in ms (overrides default). */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Token access — set by AuthProvider at runtime
// ---------------------------------------------------------------------------

let _getAccessToken: (() => string | null) | null = null;
let _onUnauthorised: (() => Promise<boolean>) | null = null;
let _isRefreshing = false;

let _getDeviceAccessToken: (() => string | null) | null = null;
let _onDeviceUnauthorised: (() => Promise<boolean>) | null = null;
let _isDeviceRefreshing = false;

/**
 * Eagerly-set device access token — updated by AuthProvider immediately when
 * a new token is acquired (bypasses the React render/useEffect cycle so that
 * calls made in the same async turn as pairWithDevice() see the token).
 */
let _deviceAccessTokenEager: string | null = null;

/** Directly set (or clear) the device access token without waiting for a
 * React render cycle. Called by AuthProvider's persistDeviceTokens and
 * unpairDevice. */
export function setDeviceAccessToken(token: string | null): void {
  _deviceAccessTokenEager = token;
}

/** Runtime-overridable device base URL (defaults to build-time DEVICE_API_URL). */
let _deviceBaseUrl: string = DEVICE_API_URL;

/** Update the device API base URL at runtime (e.g. after Soft AP → home network switch). */
export function setDeviceBaseUrl(url: string): void {
  _deviceBaseUrl = url;
}

/** Returns the current device API base URL. */
export function getDeviceBaseUrl(): string {
  return _deviceBaseUrl;
}

/**
 * Called by AuthProvider to wire central token access into the API client.
 */
export function setTokenAccessors(
  getToken: () => string | null,
  onUnauthorised: () => Promise<boolean>,
): void {
  _getAccessToken = getToken;
  _onUnauthorised = onUnauthorised;
}

/**
 * Called by AuthProvider to wire device token access into the API client.
 */
export function setDeviceTokenAccessors(
  getToken: () => string | null,
  onUnauthorised: () => Promise<boolean>,
): void {
  _getDeviceAccessToken = getToken;
  _onDeviceUnauthorised = onUnauthorised;
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

async function rawFetch<T>(
  baseUrl: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, formData, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const reqHeaders: Record<string, string> = {
    // Multipart requests must not pin Content-Type — fetch adds the boundary.
    ...(formData === undefined ? { "Content-Type": "application/json" } : {}),
    ...headers,
  };

  // Inject auth token: device token for device API, central token otherwise
  const isDeviceRequest = baseUrl === _deviceBaseUrl;
  const token = isDeviceRequest
    ? (_deviceAccessTokenEager ?? _getDeviceAccessToken?.())
    : _getAccessToken?.();
  if (token) {
    reqHeaders["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      method,
      headers: reqHeaders,
      body: formData !== undefined ? formData : body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (response.status === 401) {
      const refreshing = isDeviceRequest ? _isDeviceRefreshing : _isRefreshing;
      const onUnauth = isDeviceRequest ? _onDeviceUnauthorised : _onUnauthorised;

      if (onUnauth && !refreshing) {
        if (isDeviceRequest) {
          _isDeviceRefreshing = true;
        } else {
          _isRefreshing = true;
        }
        try {
          const refreshed = await onUnauth();
          if (refreshed) {
            return rawFetch<T>(baseUrl, path, opts);
          }
        } finally {
          if (isDeviceRequest) {
            _isDeviceRefreshing = false;
          } else {
            _isRefreshing = false;
          }
        }
      }
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({
        error: response.statusText,
        timestamp: new Date().toISOString(),
      }));
      throw new ApiRequestError(
        errorBody.error || response.statusText,
        response.status,
        errorBody,
      );
    }

    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof ApiRequestError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new ApiRequestError("Request timed out", 0);
    }
    throw new ApiRequestError(
      (err as Error).message || "Network error",
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Error thrown by the API client. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * Make a request to the device-mode API (Pi).
 * Uses the runtime-configurable device base URL (see setDeviceBaseUrl).
 */
export async function deviceApi<T>(
  path: string,
  opts?: RequestOptions,
): Promise<T> {
  return rawFetch<T>(_deviceBaseUrl, path, opts);
}

/**
 * Make a request to the central-mode API (fleet server).
 */
export async function centralApi<T>(
  path: string,
  opts?: RequestOptions,
): Promise<T> {
  return rawFetch<T>(CENTRAL_API_URL, path, opts);
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** Identity returned by the device /api/device/auth/identity endpoint. */
export interface DeviceIdentity {
  vin: string;
  model: string;
  hostname: string;
  /** Nomothetic package version, reported as device firmware version. */
  firmware_version: string;
  /** Short-lived proof JWT to submit alongside the VIN when registering with
   *  the central fleet API. Valid for 5 minutes. */
  registration_proof: string;
}

export interface DeviceSessionResetResponse {
  success: boolean;
  timestamp: string;
}

/** Invalidate the current device session and reopen pairing on the Pi. */
export async function deleteDeviceSession(): Promise<DeviceSessionResetResponse> {
  return deviceApi<DeviceSessionResetResponse>("/api/device/auth/session", {
    method: "DELETE",
  });
}

/** Fetch the device's VIN and model name (requires a valid device JWT). */
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  return deviceApi<DeviceIdentity>("/api/device/auth/identity");
}

/** Register a device with the central fleet API (requires a valid central JWT). */
export async function registerDeviceWithFleet(
  vin: string,
  model: string,
  registrationProof: string,
): Promise<void> {
  await centralApi("/api/fleet/devices", {
    method: "POST",
    body: { vin, model, registration_proof: registrationProof },
  });
}
