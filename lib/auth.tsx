/**
 * Authentication context and provider.
 *
 * Manages login, registration, logout, and automatic token refresh.
 * Handles both central-mode auth and device-mode pairing.
 *
 * Token storage: expo-secure-store (OS keychain) on mobile. On web, access
 * tokens live in React state only (never in browser storage) and refresh
 * tokens use tab-scoped sessionStorage; only non-sensitive data (device URL)
 * uses localStorage. See security checklist X6–X8.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import { DEVICE_API_URL, SOFT_AP_URL } from "@/constants/config";
import { centralApi, deleteDeviceSession, deviceApi, getDeviceBaseUrl, setDeviceAccessToken, setDeviceBaseUrl, setDeviceTokenAccessors, setTokenAccessors } from "@/lib/api";
import { changePassword as apiChangePassword, updateProfile as apiUpdateProfile } from "@/lib/profile";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  device_hostname?: string;
}

interface UserProfile {
  email: string;
  display_name: string;
  created_at: string;
  last_login_at: string | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  isLoading: boolean;
  deviceAccessToken: string | null;
  deviceRefreshToken: string | null;
  isDevicePaired: boolean;
  isGuest: boolean;
  deviceUrl: string;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<boolean>;
  connectToAp: () => Promise<void>;
  pairWithDevice: (secret: string, displayName: string) => Promise<void>;
  pairViaAp: (displayName: string) => Promise<void>;
  unpairDevice: () => Promise<void>;
  refreshDeviceToken: () => Promise<boolean>;
  continueAsGuest: () => void;
  /** Persist and activate a home-network device URL after the user confirms
   * the device is reachable there (called by WifiProvisionForm on reconnect). */
  confirmDeviceUrl: (url: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Secure storage abstraction
// ---------------------------------------------------------------------------

const STORAGE_KEY_ACCESS = "nomon_access_token";
const STORAGE_KEY_REFRESH = "nomon_refresh_token";
const STORAGE_KEY_DEVICE_ACCESS = "nomon_device_access_token";
const STORAGE_KEY_DEVICE_REFRESH = "nomon_device_refresh_token";
// Only written after the user explicitly confirms the device is reachable
// at a home-network URL via WifiProvisionForm. Never auto-derived.
const STORAGE_KEY_DEVICE_URL = "nomon_device_url";

// On web, access tokens are never written to any browser storage.
// They live in React state only and are re-obtained via the refresh token on
// page reload. This prevents XSS-based token extraction from browser storage.
const WEB_MEMORY_ONLY_KEYS: ReadonlySet<string> = new Set([
  STORAGE_KEY_ACCESS,
  STORAGE_KEY_DEVICE_ACCESS,
]);
// Refresh tokens use sessionStorage on web: tab-scoped and cleared when the
// browser tab or window is closed, preventing indefinite credential exposure.
// Non-sensitive data (device URL) continues to use localStorage.
const WEB_SESSION_KEYS: ReadonlySet<string> = new Set([
  STORAGE_KEY_REFRESH,
  STORAGE_KEY_DEVICE_REFRESH,
]);

const storage = {
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      if (WEB_MEMORY_ONLY_KEYS.has(key)) return; // never written to browser storage
      try {
        const store = WEB_SESSION_KEYS.has(key) ? sessionStorage : localStorage;
        store.setItem(key, value);
      } catch {
        // Storage unavailable (e.g. private browsing quota exceeded)
      }
    } else {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.setItemAsync(key, value);
    }
  },
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      if (WEB_MEMORY_ONLY_KEYS.has(key)) return null; // never stored
      try {
        const store = WEB_SESSION_KEYS.has(key) ? sessionStorage : localStorage;
        return store.getItem(key);
      } catch {
        return null;
      }
    }
    const SecureStore = await import("expo-secure-store");
    return SecureStore.getItemAsync(key);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") {
      if (WEB_MEMORY_ONLY_KEYS.has(key)) return; // not stored, nothing to remove
      try {
        const store = WEB_SESSION_KEYS.has(key) ? sessionStorage : localStorage;
        store.removeItem(key);
      } catch {
        // noop
      }
    } else {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.deleteItemAsync(key);
    }
  },
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Hook to access the auth context. Must be used within an AuthProvider.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    accessToken: null,
    refreshToken: null,
    user: null,
    isLoading: true,
    deviceAccessToken: null,
    deviceRefreshToken: null,
    isDevicePaired: false,
    isGuest: false,
    deviceUrl: getDeviceBaseUrl(),
  });

  // Restore tokens from storage on mount
  useEffect(() => {
    (async () => {
      const access = await storage.get(STORAGE_KEY_ACCESS);      // null on web (memory-only)
      const refresh = await storage.get(STORAGE_KEY_REFRESH);
      const deviceAccess = await storage.get(STORAGE_KEY_DEVICE_ACCESS); // null on web
      const deviceRefresh = await storage.get(STORAGE_KEY_DEVICE_REFRESH);
      // Restore a user-confirmed device URL if present (written by
      // WifiProvisionForm after successful reconnect). Reject any stored URL
      // that is an mDNS address (.local) — these were written by an older
      // version of the app and are not resolvable in a browser context.
      const storedDeviceUrl = await storage.get(STORAGE_KEY_DEVICE_URL);
      const isMdns = storedDeviceUrl !== null && storedDeviceUrl.includes(".local");
      if (isMdns) {
        await storage.remove(STORAGE_KEY_DEVICE_URL);
      }
      const activeDeviceUrl = (storedDeviceUrl !== null && !isMdns) ? storedDeviceUrl : DEVICE_API_URL;
      setDeviceBaseUrl(activeDeviceUrl);

      // On web, access tokens are memory-only and not persisted to any browser
      // storage. When the page is reloaded we auto-refresh using the refresh
      // token (stored in sessionStorage) to restore the authenticated session.
      let resolvedAccess = access;
      let resolvedRefresh = refresh;
      if (Platform.OS === "web" && access === null && refresh !== null) {
        try {
          const tokens = await centralApi<TokenResponse>("/api/auth/refresh", {
            method: "POST",
            body: { refresh_token: refresh },
          });
          resolvedAccess = tokens.access_token;
          resolvedRefresh = tokens.refresh_token;
          // Store rotated refresh token; access token stays memory-only
          await storage.set(STORAGE_KEY_REFRESH, resolvedRefresh);
        } catch {
          // Refresh token expired or revoked — treat as logged out
          await storage.remove(STORAGE_KEY_REFRESH);
          resolvedRefresh = null;
        }
      }

      let resolvedDeviceAccess = deviceAccess;
      let resolvedDeviceRefresh = deviceRefresh;
      if (Platform.OS === "web" && deviceAccess === null && deviceRefresh !== null) {
        try {
          const tokens = await deviceApi<TokenResponse>("/api/device/auth/refresh", {
            method: "POST",
            body: { refresh_token: deviceRefresh },
          });
          resolvedDeviceAccess = tokens.access_token;
          resolvedDeviceRefresh = tokens.refresh_token;
          await storage.set(STORAGE_KEY_DEVICE_REFRESH, resolvedDeviceRefresh);
        } catch {
          await storage.remove(STORAGE_KEY_DEVICE_REFRESH);
          resolvedDeviceRefresh = null;
        }
      }

      // Eagerly populate so rawFetch() sees the token even before the
      // setDeviceTokenAccessors effect fires (children's effects run before
      // parents', so the first poll can fire before the accessor is updated).
      setDeviceAccessToken(resolvedDeviceAccess);
      setState((prev) => ({
        ...prev,
        accessToken: resolvedAccess,
        refreshToken: resolvedRefresh,
        deviceAccessToken: resolvedDeviceAccess,
        deviceRefreshToken: resolvedDeviceRefresh,
        isDevicePaired: resolvedDeviceAccess !== null,
        isLoading: false,
        deviceUrl: activeDeviceUrl,
      }));
    })();
  }, []);

  async function persistTokens(tokens: TokenResponse): Promise<void> {
    await storage.set(STORAGE_KEY_ACCESS, tokens.access_token);
    await storage.set(STORAGE_KEY_REFRESH, tokens.refresh_token);
    setState((prev) => ({
      ...prev,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      isGuest: false,
    }));
  }

  async function persistDeviceTokens(tokens: TokenResponse): Promise<void> {
    await storage.set(STORAGE_KEY_DEVICE_ACCESS, tokens.access_token);
    await storage.set(STORAGE_KEY_DEVICE_REFRESH, tokens.refresh_token);
    // Update the eager token immediately so rawFetch() calls in the same
    // async turn (e.g. getDeviceIdentity right after pairWithDevice) see
    // the new token without waiting for the React render/useEffect cycle.
    setDeviceAccessToken(tokens.access_token);
    setState((prev) => ({
      ...prev,
      deviceAccessToken: tokens.access_token,
      deviceRefreshToken: tokens.refresh_token,
      isDevicePaired: true,
    }));
  }

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const tokens = await centralApi<TokenResponse>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    await persistTokens(tokens);
  }, []);

  const register = useCallback(async (
    email: string,
    password: string,
    displayName: string,
  ): Promise<void> => {
    const resp = await centralApi<TokenResponse & { user: UserProfile }>(
      "/api/auth/register",
      {
        method: "POST",
        body: { email, password, display_name: displayName },
      },
    );
    await persistTokens(resp);
    setState((prev) => ({ ...prev, user: resp.user }));
  }, []);

  const updateDisplayName = useCallback(async (displayName: string): Promise<void> => {
    const profile = await apiUpdateProfile(displayName);
    setState((prev) => ({
      ...prev,
      user: {
        email: profile.email,
        display_name: profile.display_name,
        created_at: profile.created_at,
        last_login_at: profile.last_login_at,
      },
    }));
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      await apiChangePassword(currentPassword, newPassword);
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    // Best-effort server-side token revocation
    if (state.refreshToken) {
      try {
        await centralApi("/api/auth/logout", {
          method: "POST",
          body: { refresh_token: state.refreshToken },
        });
      } catch {
        // Server unreachable — continue with local cleanup
      }
    }
    await storage.remove(STORAGE_KEY_ACCESS);
    await storage.remove(STORAGE_KEY_REFRESH);
    setState((prev) => ({
      ...prev,
      accessToken: null,
      refreshToken: null,
      user: null,
      isGuest: false,
      isLoading: false,
    }));
  }, [state.refreshToken]);

  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    if (!state.refreshToken) return false;
    try {
      const tokens = await centralApi<TokenResponse>("/api/auth/refresh", {
        method: "POST",
        body: { refresh_token: state.refreshToken },
      });
      await persistTokens(tokens);
      return true;
    } catch {
      await logout();
      return false;
    }
  }, [state.refreshToken, logout]);

  const clearLocalDeviceSession = useCallback(async (): Promise<void> => {
    setDeviceAccessToken(null);
    await storage.remove(STORAGE_KEY_DEVICE_ACCESS);
    await storage.remove(STORAGE_KEY_DEVICE_REFRESH);
    setState((prev) => ({
      ...prev,
      deviceAccessToken: null,
      deviceRefreshToken: null,
      isDevicePaired: false,
    }));
  }, []);

  const unpairDevice = useCallback(async (): Promise<void> => {
    if (state.deviceAccessToken !== null || state.deviceRefreshToken !== null) {
      try {
        await deleteDeviceSession();
      } catch {
        // The device may already be offline or the session may already be dead.
        // Local cleanup still proceeds so the user can pair again.
      }
    }
    await clearLocalDeviceSession();
  }, [state.deviceAccessToken, state.deviceRefreshToken, clearLocalDeviceSession]);

  const refreshDeviceToken = useCallback(async (): Promise<boolean> => {
    if (!state.deviceRefreshToken) return false;
    try {
      const tokens = await deviceApi<TokenResponse>("/api/device/auth/refresh", {
        method: "POST",
        body: { refresh_token: state.deviceRefreshToken },
      });
      await persistDeviceTokens(tokens);
      return true;
    } catch {
      await clearLocalDeviceSession();
      return false;
    }
  }, [state.deviceRefreshToken, clearLocalDeviceSession]);

  const pairWithDevice = useCallback(
    async (secret: string, displayName: string): Promise<void> => {
      if (state.deviceAccessToken !== null || state.deviceRefreshToken !== null) {
        await unpairDevice();
      }
      const tokens = await deviceApi<TokenResponse>("/api/device/auth/pair", {
        method: "POST",
        body: { secret, display_name: displayName },
      });
      await persistDeviceTokens(tokens);
      // Pairing happens over the home network; the build-time device URL
      // (Tailscale FQDN) is always correct — no need to persist anything.
      setDeviceBaseUrl(DEVICE_API_URL);
      setState((prev) => ({ ...prev, deviceUrl: DEVICE_API_URL }));
    },
    [state.deviceAccessToken, state.deviceRefreshToken, unpairDevice],
  );

  const connectToAp = useCallback(
    /**
     * Switch the active device URL to the Soft AP endpoint.
     *
     * Called when the user confirms they are on the AP network.
     * All subsequent device API calls will target SOFT_AP_URL until
     * the device URL is updated again (e.g. after Wi-Fi provisioning).
     */
    async (): Promise<void> => {
      setDeviceBaseUrl(SOFT_AP_URL);
      setState((prev) => ({ ...prev, deviceUrl: SOFT_AP_URL }));
    },
    [],
  );

  const pairViaAp = useCallback(
    async (displayName: string): Promise<void> => {
      if (state.deviceAccessToken !== null || state.deviceRefreshToken !== null) {
        await unpairDevice();
      }
      const tokens = await fetch(`${SOFT_AP_URL}/api/device/auth/pair/ap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      }).then(async (r) => {
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`Pairing failed: ${r.status} ${text}`);
        }
        return r.json() as Promise<TokenResponse>;
      });
      await persistDeviceTokens(tokens);
      // The Soft AP URL remains active until WifiProvisionForm reconnects
      // at which point setDeviceBaseUrl(DEVICE_API_URL) will be called.
      setState((prev) => ({ ...prev, deviceUrl: DEVICE_API_URL }));
    },
    [state.deviceAccessToken, state.deviceRefreshToken, unpairDevice],
  );

  /** Called by WifiProvisionForm once the device responds at its home-network
   * URL. Persists the URL so it survives app restarts. */
  const confirmDeviceUrl = useCallback(async (url: string): Promise<void> => {
    const trimmed = url.trim();
    await storage.set(STORAGE_KEY_DEVICE_URL, trimmed);
    setDeviceBaseUrl(trimmed);
    setState((prev) => ({ ...prev, deviceUrl: trimmed }));
  }, []);

  const continueAsGuest = useCallback((): void => {
    setState((prev) => ({ ...prev, isGuest: true }));
  }, []);

  // Wire central API client token access
  useEffect(() => {
    setTokenAccessors(
      () => state.accessToken,
      async () => {
        try {
          return await refreshAccessToken();
        } catch {
          return false;
        }
      },
    );
  }, [state.accessToken, state.refreshToken, refreshAccessToken]);

  // Wire device API client token access
  useEffect(() => {
    setDeviceTokenAccessors(
      () => state.deviceAccessToken,
      async () => {
        try {
          return await refreshDeviceToken();
        } catch {
          return false;
        }
      },
    );
  }, [state.deviceAccessToken, state.deviceRefreshToken, refreshDeviceToken]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isAuthenticated: state.accessToken !== null,
      login,
      register,
      updateDisplayName,
      changePassword,
      logout,
      refreshAccessToken,
      connectToAp,
      pairWithDevice,
      pairViaAp,
      unpairDevice,
      refreshDeviceToken,
      continueAsGuest,
      confirmDeviceUrl,
    }),
    [state, login, register, updateDisplayName, changePassword, logout, refreshAccessToken, connectToAp, pairWithDevice, pairViaAp, unpairDevice, refreshDeviceToken, continueAsGuest, confirmDeviceUrl],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
