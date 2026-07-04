/**
 * CommandInput — persistent AI command bar.
 *
 * Sends the operator's chat to the device's Claude relay (POST /api/ai/command)
 * with the visible conversation as context, renders the reply plus the robot
 * actions the model took (drive, steer, sensor reads, routines, ...), and
 * offers inline Anthropic-key setup when the device reports it has no usable
 * key. The key is stored on the robot, never in the app. See ADR-002.
 */

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
    isKeyProblem,
    sendAiCommand,
    setAiKey,
    trimHistory,
} from "@/lib/ai";
import { borderRadius, colors, spacing } from "@/lib/theme";

/** The latest reply shown in the response bubble, with its robot actions. */
interface Exchange {
  reply: string;
  actions: AiActionRecord[];
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

  async function submit() {
    const trimmed = text.trim();
    if (trimmed.length === 0 || isLoading) return;
    setIsLoading(true);
    setError(null);
    setNotice(null);
    const messages = trimHistory([...history, { role: "user", content: trimmed }]);
    try {
      const resp = await sendAiCommand(messages);
      setExchange({ reply: resp.reply, actions: resp.actions });
      setHistory([...messages, { role: "assistant", content: resp.reply }]);
      setText("");
    } catch (err) {
      if (isKeyProblem(err)) setNeedsKey(true);
      // Keep the typed command so the user can retry after fixing the cause.
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
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

  const showBubble = isLoading || error !== null || notice !== null || exchange !== null;

  return (
    <Wrapper style={styles.container} {...wrapperProps}>
      {needsKey && (
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

      {!needsKey && showBubble && (
        <View style={styles.responseBubble}>
          {isLoading ? (
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
          placeholder="Ask nomon something..."
          placeholderTextColor={colors.textMuted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          returnKeyType="send"
          editable={!isLoading}
        />
        <Pressable
          style={[styles.sendButton, isLoading && styles.sendButtonDisabled]}
          onPress={submit}
          disabled={isLoading || text.trim().length === 0}
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
