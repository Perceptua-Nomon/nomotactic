/**
 * CommandInput — persistent AI command bar.
 *
 * Sends the operator's chat to the device's Claude relay (POST /api/ai/command)
 * with the visible conversation as context, renders the reply plus the robot
 * actions the model took (drive, steer, sensor reads, routines, ...), and
 * offers inline Anthropic-key setup when the device reports it has no usable
 * key. The key is stored on the robot, never in the app. See ADR-002.
 *
 * Voice commands (ADR-004): the mic button records a clip with expo-audio,
 * the robot transcribes it (POST /api/ai/transcribe, nomothetic ADR-020), and
 * the transcript auto-sends through the same submit path. Replies to voice
 * commands are spoken aloud unless muted.
 */

import { Ionicons } from "@expo/vector-icons";
import { useAudioRecorder } from "expo-audio";
import React, { useState } from "react";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import {
    AiActionRecord,
    AiChatMessage,
    describeCommandError,
    isKeyProblem,
    sendAiCommand,
    setAiKey,
    trimHistory,
} from "@/lib/ai";
import { useAuth } from "@/lib/auth";
import { borderRadius, colors, spacing } from "@/lib/theme";
import {
    describeVoiceError,
    ensureMicPermission,
    enterRecordingMode,
    exitRecordingMode,
    isVoiceInputAvailable,
    speak,
    stopSpeaking,
    transcribeAudio,
    VOICE_RECORDING_OPTIONS,
} from "@/lib/voice";

/** The latest reply shown in the response bubble, with its robot actions. */
interface Exchange {
  reply: string;
  actions: AiActionRecord[];
  /** True when the command arrived by voice — replies are spoken unless muted. */
  viaVoice: boolean;
}

/** Compact ✓/✕ chips for the robot actions taken while handling a command. */
function ActionChips({ actions }: { actions: AiActionRecord[] }) {
  if (actions.length === 0) return null;
  return (
    <View style={styles.actionRow}>
      {actions.map((action, index) => (
        <View
          key={`${action.tool}-${index}`}
          style={[styles.actionChip, !action.ok && styles.actionChipFailed]}
        >
          <Text style={[styles.actionChipText, !action.ok && styles.actionChipTextFailed]}>
            {action.ok ? "✓" : "✕"} {action.tool}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function CommandInput() {
  // AI commands run through the device's Claude relay (device JWT auth), so the
  // bar is only usable once a device session exists — the same connection the
  // cockpit controls require. Without it, a send would fire a doomed request at
  // the (possibly offline/unreachable) device URL and look like it did nothing.
  const { isDevicePaired } = useAuth();
  const [text, setText] = useState("");
  const [history, setHistory] = useState<AiChatMessage[]>([]);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Inline Anthropic-key setup, shown when the device reports a key problem.
  const [needsKey, setNeedsKey] = useState(false);
  const [keyText, setKeyText] = useState("");
  const [isSavingKey, setIsSavingKey] = useState(false);
  // Voice: record on the phone, transcribe on the robot, speak the reply.
  const voiceAvailable = isVoiceInputAvailable();
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [repliesMuted, setRepliesMuted] = useState(false);

  async function submit(overrideText?: string, viaVoice = false) {
    const trimmed = (overrideText ?? text).trim();
    // No device session → the relay is unreachable; don't fire a doomed
    // request (the button is also disabled, but guard the keyboard-send path).
    if (trimmed.length === 0 || isLoading || !isDevicePaired) return;
    stopSpeaking();
    setIsLoading(true);
    setError(null);
    setNotice(null);
    const messages = trimHistory([...history, { role: "user", content: trimmed }]);
    try {
      const resp = await sendAiCommand(messages);
      setExchange({ reply: resp.reply, actions: resp.actions, viaVoice });
      setHistory([...messages, { role: "assistant", content: resp.reply }]);
      setText("");
      if (viaVoice && !repliesMuted) speak(resp.reply);
    } catch (err) {
      if (isKeyProblem(err)) setNeedsKey(true);
      // Keep the typed command so the user can retry after fixing the cause,
      // and show a message that explains an unreachable device rather than a
      // bare "Network error" (which reads as "nothing happened").
      setError(describeCommandError(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function startVoice() {
    stopSpeaking();
    setError(null);
    setNotice(null);
    const granted = await ensureMicPermission();
    if (!granted) {
      setError("Microphone permission is needed for voice commands.");
      return;
    }
    try {
      await enterRecordingMode();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
    } catch (err) {
      setError(describeVoiceError(err));
    }
  }

  async function finishVoice() {
    setIsRecording(false);
    setIsTranscribing(true);
    try {
      await recorder.stop();
      await exitRecordingMode();
      const uri = recorder.uri;
      if (!uri) {
        setError("Recording failed. Try again.");
        return;
      }
      const transcript = (await transcribeAudio(uri)).trim();
      if (transcript.length === 0) {
        setNotice("Didn't catch that — tap the mic and try again.");
        return;
      }
      // Show what the robot heard, then send it through the normal path.
      setText(transcript);
      await submit(transcript, true);
    } catch (err) {
      setError(describeVoiceError(err));
    } finally {
      setIsTranscribing(false);
    }
  }

  function toggleVoice() {
    if (isLoading || isTranscribing) return;
    if (isRecording) {
      void finishVoice();
    } else {
      void startVoice();
    }
  }

  function toggleMuted() {
    if (!repliesMuted) stopSpeaking();
    setRepliesMuted(!repliesMuted);
  }

  async function saveKey() {
    const trimmed = keyText.trim();
    if (trimmed.length === 0 || isSavingKey) return;
    setIsSavingKey(true);
    setError(null);
    try {
      await setAiKey(trimmed);
      setKeyText("");
      setNeedsKey(false);
      setNotice("API key saved on the robot — send your command again.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSavingKey(false);
    }
  }

  function clearConversation() {
    stopSpeaking();
    setHistory([]);
    setExchange(null);
    setError(null);
    setNotice(null);
  }

  const Wrapper = Platform.OS === "web" ? View : KeyboardAvoidingView;
  const wrapperProps =
    Platform.OS === "ios"
      ? { behavior: "padding" as const, keyboardVerticalOffset: 90 }
      : {};

  const showBubble =
    isLoading ||
    isRecording ||
    isTranscribing ||
    error !== null ||
    notice !== null ||
    exchange !== null;
  const canSend = isDevicePaired && !isLoading && !isTranscribing && text.trim().length > 0;
  const showMic = voiceAvailable && isDevicePaired && !needsKey;

  return (
    <Wrapper style={styles.container} {...wrapperProps}>
      {!isDevicePaired && (
        <View style={styles.responseBubble}>
          <Text style={styles.responseText}>
            Connect to a device to use AI commands.
          </Text>
        </View>
      )}

      {isDevicePaired && needsKey && (
        <View style={styles.responseBubble}>
          <Text style={styles.responseText}>
            AI commands need an Anthropic API key. It is stored on the robot itself, never in
            the app.
          </Text>
          <View style={styles.keyRow}>
            <TextInput
              style={styles.input}
              placeholder="sk-ant-..."
              placeholderTextColor={colors.textMuted}
              value={keyText}
              onChangeText={setKeyText}
              onSubmitEditing={saveKey}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSavingKey}
            />
            <Pressable
              style={[
                styles.sendButton,
                (isSavingKey || keyText.trim().length === 0) && styles.sendButtonDisabled,
              ]}
              onPress={saveKey}
              disabled={isSavingKey || keyText.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel="Save API key"
            >
              {isSavingKey ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text style={styles.sendText}>✓</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {isDevicePaired && !needsKey && showBubble && (
        <View style={styles.responseBubble}>
          {isRecording ? (
            <View style={styles.thinkingRow}>
              <Ionicons name="mic" size={16} color={colors.error} />
              <Text style={styles.thinkingText}>Listening… tap the mic to finish.</Text>
            </View>
          ) : isTranscribing ? (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.thinkingText}>Transcribing…</Text>
            </View>
          ) : isLoading ? (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.thinkingText}>nomon is thinking…</Text>
            </View>
          ) : error !== null ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : notice !== null ? (
            <Text style={styles.responseText}>{notice}</Text>
          ) : exchange !== null ? (
            <>
              <Text style={styles.responseText}>{exchange.reply}</Text>
              <ActionChips actions={exchange.actions} />
              {exchange.viaVoice && (
                <Pressable
                  onPress={toggleMuted}
                  style={styles.muteRow}
                  accessibilityRole="button"
                  accessibilityLabel={
                    repliesMuted ? "Unmute spoken replies" : "Mute spoken replies"
                  }
                >
                  <Ionicons
                    name={repliesMuted ? "volume-mute" : "volume-high"}
                    size={14}
                    color={colors.textMuted}
                  />
                  <Text style={styles.muteText}>
                    {repliesMuted ? "Replies muted" : "Speaking replies"}
                  </Text>
                </Pressable>
              )}
            </>
          ) : null}
        </View>
      )}

      {history.length > 0 && !isLoading && (
        <Pressable
          onPress={clearConversation}
          style={styles.clearRow}
          accessibilityRole="button"
          accessibilityLabel="Clear conversation"
        >
          <Text style={styles.clearText}>
            Conversation: {Math.ceil(history.length / 2)} exchange
            {history.length > 2 ? "s" : ""} · Clear
          </Text>
        </Pressable>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={
            isDevicePaired ? "Ask nomon something..." : "Connect a device to chat"
          }
          placeholderTextColor={colors.textMuted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => submit()}
          returnKeyType="send"
          editable={isDevicePaired && !isLoading && !isTranscribing}
        />
        {showMic && (
          <Pressable
            style={[
              styles.micButton,
              isRecording && styles.micButtonActive,
              (isLoading || isTranscribing) && styles.sendButtonDisabled,
            ]}
            onPress={toggleVoice}
            disabled={isLoading || isTranscribing}
            accessibilityRole="button"
            accessibilityLabel={isRecording ? "Stop recording" : "Start voice command"}
          >
            {isTranscribing ? (
              <ActivityIndicator size="small" color={colors.background} />
            ) : (
              <Ionicons
                name={isRecording ? "stop" : "mic"}
                size={18}
                color={colors.background}
              />
            )}
          </Pressable>
        )}
        <Pressable
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          onPress={() => submit()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send command"
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Text style={styles.sendText}>↑</Text>
          )}
        </Pressable>
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  responseBubble: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  responseText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
  },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  thinkingText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  actionChip: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  actionChipFailed: {
    borderColor: colors.error,
  },
  actionChipText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  actionChipTextFailed: {
    color: colors.error,
  },
  muteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
    alignSelf: "flex-start",
  },
  muteText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  clearRow: {
    marginBottom: spacing.sm,
    alignSelf: "flex-start",
  },
  clearText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
    marginRight: spacing.sm,
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.sm,
  },
  micButtonActive: {
    backgroundColor: colors.error,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendText: {
    color: colors.background,
    fontSize: 18,
    fontWeight: "700",
  },
});
