/**
 * VideoFeed — toggleable MJPEG stream with platform-aware display.
 *
 * Web: renders a native <img> tag for true MJPEG streaming.
 * Mobile: renders an inline WebView embedding the MJPEG stream directly.
 *
 * The window IS the control: tapping the (off) feed starts the stream; a small
 * floating Stop control overlays the live stream. There is no separate button,
 * so the feed fills the whole area it's given. State is managed internally.
 */

import React, { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { getDeviceBaseUrl } from "@/lib/api";
import { ENDPOINTS } from "@/lib/endpoints";
import { borderRadius, colors, spacing, typography } from "@/lib/theme";
import { useDeviceCommand } from "@/lib/useDeviceCommand";

// ── Response shapes ──────────────────────────────────────────────────────────

interface StreamStartResponse {
  url: string;
  host: string;
  port: string;
  /** Access token the stream server requires as ?token= on every request. */
  token?: string | null;
  timestamp: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function VideoFeed() {
  const [active, setActive] = useState(false);
  /** Base URL returned by stream/start (without /stream suffix). */
  const [streamBaseUrl, setStreamBaseUrl] = useState<string | null>(null);
  /** Access token the stream server requires on every request. */
  const [streamToken, setStreamToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sendCommand = useDeviceCommand();

  const tokenQuery = streamToken !== null ? `?token=${encodeURIComponent(streamToken)}` : "";
  /** Full MJPEG URL consumed by the <img> tag or shown to the user. */
  const mjpegUrl = streamBaseUrl !== null ? `${streamBaseUrl}/stream${tokenQuery}` : null;

  async function toggleStream() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (active) {
        await sendCommand(ENDPOINTS.STREAM_STOP, {});
        setActive(false);
        setStreamBaseUrl(null);
        setStreamToken(null);
      } else {
        const resp = await sendCommand<StreamStartResponse>(ENDPOINTS.STREAM_START, {});
        // resp.url may contain the Pi's bind-all address (0.0.0.0). Reconstruct
        // the URL using the device's reachable hostname and the stream port.
        let baseUrl = resp.url;
        try {
          const deviceHostname = new URL(getDeviceBaseUrl()).hostname;
          baseUrl = `http://${deviceHostname}:${resp.port}`;
        } catch {
          // Malformed device URL — fall back to what the server returned
        }
        setStreamBaseUrl(baseUrl);
        setStreamToken(resp.token ?? null);
        setActive(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function renderStream() {
    if (Platform.OS === "web") {
      return (
        <img
          src={mjpegUrl ?? undefined}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          alt="Live stream"
        />
      );
    }

    // Mobile: render the MJPEG stream inside a WebView using a minimal inline
    // HTML page. The img src="/stream?token=…" is resolved against streamBaseUrl
    // as baseUrl, so the native HTTP request goes directly to the stream server.
    const streamHtml = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"></head><body style="margin:0;padding:0;background:#000;overflow:hidden"><img src="/stream${tokenQuery}" style="width:100%;height:100%;object-fit:cover;display:block" /></body></html>`;
    return (
      <WebView
        source={{ html: streamHtml, baseUrl: streamBaseUrl ?? "" }}
        style={styles.streamWrapper}
        scrollEnabled={false}
        originWhitelist={["*"]}
        mediaPlaybackRequiresUserAction={false}
      />
    );
  }

  return (
    <View style={styles.container}>
      {active && mjpegUrl !== null ? (
        <View style={styles.streamWrapper}>
          {renderStream()}
          {/* Floating stop control, overlaid on the live stream */}
          <Pressable
            style={({ pressed }) => [styles.stopOverlay, pressed && styles.pressed]}
            onPress={toggleStream}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Stop stream"
          >
            <Text style={styles.stopText}>{busy ? "…" : "■ Stop"}</Text>
          </Pressable>
        </View>
      ) : (
        // The window itself starts the stream — tap anywhere on the feed.
        <Pressable
          style={({ pressed }) => [styles.offOverlay, pressed && styles.pressed]}
          onPress={toggleStream}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Start stream"
        >
          {busy ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Text style={styles.offIcon}>▶</Text>
              <Text style={styles.offText}>Tap to start stream</Text>
            </>
          )}
        </Pressable>
      )}

      {error !== null && (
        <View style={styles.errorBanner} pointerEvents="none">
          <Text style={styles.error}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  streamWrapper: {
    flex: 1,
    backgroundColor: "#000",
  },
  offOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  offIcon: {
    fontSize: 44,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  offText: {
    ...typography.caption,
    opacity: 0.7,
  },
  // Floating Stop control over the live stream (top-right corner).
  stopOverlay: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.error,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
  },
  stopText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.background,
  },
  pressed: {
    opacity: 0.6,
  },
  errorBanner: {
    position: "absolute",
    bottom: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    alignItems: "center",
  },
  error: {
    color: colors.error,
    fontSize: 12,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    overflow: "hidden",
  },
});
