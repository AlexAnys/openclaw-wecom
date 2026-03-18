/**
 * Gateway — starts the WeCom AI Bot WebSocket connection and
 * dispatches inbound messages/events to OpenClaw's runtime.
 *
 * This is the equivalent of feishu/src/monitor.ts.
 */

import { WSClient } from "@wecom/aibot-node-sdk";
import { resolveWeComAccount, resolveWeComCredentials } from "./accounts.js";
import { parseMessageFrame, parseEventFrame, buildSessionKey } from "./bot.js";
import { MessageDedup } from "./dedup.js";
import { registerWeComClient, unregisterWeComClient, sendWelcomeMessage } from "./send.js";
import type { WeComConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Types for gateway context (provided by OpenClaw runtime)
// ---------------------------------------------------------------------------

export interface WeComGatewayContext {
  cfg: { channels?: { wecom?: WeComConfig } };
  accountId: string;
  abortSignal: AbortSignal;
  runtime: {
    /** Dispatch an inbound message to OpenClaw. */
    dispatchMessage: (params: {
      channel: string;
      sessionKey: string;
      senderId: string;
      senderName?: string;
      text: string;
      accountId: string;
      /** OpenClaw standard: "direct" or "channel". */
      chatType: "direct" | "channel";
      metadata?: Record<string, unknown>;
    }) => Promise<void>;
    /** Update channel runtime status. */
    setStatus?: (params: { accountId: string; status: string }) => void;
  };
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
}

// ---------------------------------------------------------------------------
// Start account gateway
// ---------------------------------------------------------------------------

/**
 * Start the WeCom WebSocket gateway for a single account.
 *
 * Returns a cleanup function that disconnects the client.
 */
export async function startWeComGateway(
  ctx: WeComGatewayContext,
): Promise<() => void> {
  const { cfg, accountId, abortSignal, runtime, log } = ctx;
  const account = resolveWeComAccount({ cfg, accountId });

  if (!account.configured) {
    throw new Error(
      `WeCom account "${accountId}" not configured — missing botId or botSecret.`,
    );
  }

  const creds = resolveWeComCredentials(account.config);
  if (!creds) {
    throw new Error(`Cannot resolve credentials for WeCom account "${accountId}".`);
  }

  log?.info(
    `[wecom:${accountId}] Starting WebSocket gateway (botId: ${creds.botId.slice(0, 8)}...)`,
  );

  // Message deduplication — prevents double-processing on reconnect
  const dedup = new MessageDedup();

  const client = new WSClient({
    botId: creds.botId,
    secret: creds.botSecret,
    wsUrl: account.config.wsUrl || undefined,
    maxReconnectAttempts: -1, // Reconnect indefinitely
    heartbeatInterval: 30_000,
    reconnectInterval: 1_000,
  });

  // Register client for outbound message sending
  registerWeComClient(accountId, client);

  // --- Event handlers ---

  client.on("connected", () => {
    log?.info(`[wecom:${accountId}] WebSocket connected`);
    runtime.setStatus?.({ accountId, status: "connected" });
  });

  client.on("authenticated", () => {
    log?.info(`[wecom:${accountId}] Authenticated successfully`);
    runtime.setStatus?.({ accountId, status: "authenticated" });
  });

  client.on("disconnected", (reason: string) => {
    log?.warn(`[wecom:${accountId}] Disconnected: ${reason}`);
    runtime.setStatus?.({ accountId, status: "disconnected" });
  });

  client.on("reconnecting", (attempt: number) => {
    log?.info(`[wecom:${accountId}] Reconnecting (attempt ${attempt})...`);
    runtime.setStatus?.({ accountId, status: "reconnecting" });
  });

  client.on("error", (error: Error) => {
    log?.error(`[wecom:${accountId}] Error: ${error.message}`);
  });

  // --- Message handling ---

  client.on("message", (frame: Record<string, unknown>) => {
    void handleInboundMessage(ctx, accountId, frame, dedup);
  });

  // --- Event handling ---

  client.on("event.enter_chat", (frame: Record<string, unknown>) => {
    void handleEnterChat(ctx, accountId, frame);
  });

  client.on("event.feedback_event", (frame: Record<string, unknown>) => {
    log?.debug(
      `[wecom:${accountId}] User feedback event: ${JSON.stringify(frame).slice(0, 200)}`,
    );
  });

  // --- Connect ---

  client.connect();

  // --- Abort signal cleanup ---

  const cleanup = () => {
    log?.info(`[wecom:${accountId}] Shutting down gateway`);
    dedup.dispose();
    client.disconnect();
    unregisterWeComClient(accountId);
    runtime.setStatus?.({ accountId, status: "stopped" });
  };

  if (abortSignal.aborted) {
    cleanup();
  } else {
    abortSignal.addEventListener("abort", cleanup, { once: true });
  }

  return cleanup;
}

// ---------------------------------------------------------------------------
// Inbound message dispatcher
// ---------------------------------------------------------------------------

async function handleInboundMessage(
  ctx: WeComGatewayContext,
  accountId: string,
  frame: Record<string, unknown>,
  dedup: MessageDedup,
): Promise<void> {
  const { cfg, runtime, log } = ctx;

  const msgCtx = parseMessageFrame(frame);
  if (!msgCtx) {
    log?.debug(`[wecom:${accountId}] Skipping unparseable message frame`);
    return;
  }

  // --- Deduplication ---
  if (dedup.isDuplicate(msgCtx.msgId)) {
    log?.debug(`[wecom:${accountId}] Skipping duplicate msgId: ${msgCtx.msgId}`);
    return;
  }

  // --- Policy enforcement ---
  const wecomCfg = cfg.channels?.wecom;
  if (msgCtx.chatType === "group") {
    const groupPolicy = wecomCfg?.groupPolicy ?? "allowlist";
    if (groupPolicy === "disabled") {
      log?.debug(`[wecom:${accountId}] Group messages disabled by policy`);
      return;
    }
  }

  // Map WeCom chat type → OpenClaw standard
  const chatType = msgCtx.chatType === "group" ? "channel" : "direct";

  const sessionKey = buildSessionKey({
    accountId,
    chatType: msgCtx.chatType,
    fromUserId: msgCtx.fromUserId,
    chatId: msgCtx.chatId,
  });

  // Extract text content — for non-text messages, describe the attachment
  let text = msgCtx.text ?? "";
  if (!text) {
    switch (msgCtx.msgType) {
      case "image":
        text = "[图片消息]";
        break;
      case "voice":
        text = "[语音消息]";
        break;
      case "file":
        text = `[文件: ${msgCtx.fileName ?? "unknown"}]`;
        break;
    }
  }

  log?.info(
    `[wecom:${accountId}] Message from ${msgCtx.fromUserId} (${msgCtx.chatType}): ${text.slice(0, 80)}`,
  );

  try {
    await runtime.dispatchMessage({
      channel: "wecom",
      sessionKey,
      senderId: msgCtx.fromUserId,
      text,
      accountId,
      chatType,
      metadata: {
        msgId: msgCtx.msgId,
        msgType: msgCtx.msgType,
        chatId: msgCtx.chatId,
        // Sanitize: pass only the req_id, not the full frame
        reqId: (frame as Record<string, Record<string, unknown>>).headers?.req_id,
        imageUrl: msgCtx.imageUrl,
        fileUrl: msgCtx.fileUrl,
        fileName: msgCtx.fileName,
        voiceUrl: msgCtx.voiceUrl,
      },
    });
  } catch (err) {
    log?.error(
      `[wecom:${accountId}] Failed to dispatch message: ${String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Enter-chat welcome message
// ---------------------------------------------------------------------------

async function handleEnterChat(
  ctx: WeComGatewayContext,
  accountId: string,
  frame: Record<string, unknown>,
): Promise<void> {
  const { log } = ctx;
  const eventCtx = parseEventFrame(frame);
  if (!eventCtx) return;

  log?.info(
    `[wecom:${accountId}] User ${eventCtx.fromUserId ?? "unknown"} entered chat`,
  );

  try {
    await sendWelcomeMessage({
      accountId,
      frame,
      text: "Hi! I'm your AI assistant powered by OpenClaw. Send me a message to get started.",
    });
  } catch (err) {
    log?.debug(
      `[wecom:${accountId}] Welcome message failed (expected if >5s): ${String(err)}`,
    );
  }
}
