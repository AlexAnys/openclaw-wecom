/**
 * WeChat KF gateway — bridges KF messages into OpenClaw sessions.
 *
 * Runs alongside the main WeCom AI Bot gateway. When enabled,
 * it polls KF messages and dispatches them to OpenClaw, then
 * routes AI responses back through the KF send_msg API.
 */

import {
  startKfMessagePolling,
  sendKfMessage,
  getKfContactLink,
  type KfMessage,
} from "./wechat-kf.js";
import type { WeComKfConfig, WeComKfLink } from "./types.js";

export interface KfGatewayContext {
  kfConfig: WeComKfConfig;
  accountId: string;
  abortSignal: AbortSignal;
  runtime: {
    dispatchMessage: (params: {
      channel: string;
      sessionKey: string;
      senderId: string;
      text: string;
      accountId: string;
      chatType: "p2p" | "group";
      metadata?: Record<string, unknown>;
    }) => Promise<void>;
  };
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
}

/**
 * Start the WeChat KF polling gateway.
 *
 * Returns the contact link (for QR code) and a cleanup function.
 */
export async function startKfGateway(ctx: KfGatewayContext): Promise<{
  contactLink: WeComKfLink;
  stop: () => void;
}> {
  const { kfConfig, accountId, abortSignal, runtime, log } = ctx;

  log?.info(`[wecom-kf:${accountId}] Starting WeChat KF gateway`);

  // Get the contact link for QR code display
  let contactLink: WeComKfLink;
  try {
    contactLink = await getKfContactLink(kfConfig);
    log?.info(
      `[wecom-kf:${accountId}] Contact link generated: ${contactLink.url.slice(0, 50)}...`,
    );
  } catch (err) {
    log?.error(
      `[wecom-kf:${accountId}] Failed to get contact link: ${String(err)}`,
    );
    throw err;
  }

  // Start polling for new messages
  const stop = startKfMessagePolling({
    config: kfConfig,
    intervalMs: 5000,
    abortSignal,
    onMessage: async (msg: KfMessage) => {
      const text = extractKfMessageText(msg);
      if (!text) {
        log?.debug(
          `[wecom-kf:${accountId}] Skipping non-text KF message: ${msg.msgtype}`,
        );
        return;
      }

      const sessionKey = `wecom-kf:${accountId}:${msg.external_userid}`;
      log?.info(
        `[wecom-kf:${accountId}] KF message from ${msg.external_userid}: ${text.slice(0, 80)}`,
      );

      await runtime.dispatchMessage({
        channel: "wecom",
        sessionKey,
        senderId: msg.external_userid,
        text,
        accountId,
        chatType: "p2p",
        metadata: {
          source: "wechat-kf",
          kfId: msg.open_kfid,
          msgId: msg.msgid,
          msgType: msg.msgtype,
        },
      });
    },
    onError: (err: Error) => {
      log?.error(`[wecom-kf:${accountId}] Polling error: ${err.message}`);
    },
  });

  return { contactLink, stop };
}

/**
 * Send a reply to a WeChat KF user (called by outbound adapter).
 */
export async function replyToKfUser(params: {
  kfConfig: WeComKfConfig;
  toUser: string;
  text: string;
}): Promise<void> {
  await sendKfMessage({
    config: params.kfConfig,
    toUser: params.toUser,
    text: params.text,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractKfMessageText(msg: KfMessage): string | null {
  switch (msg.msgtype) {
    case "text":
      return msg.text?.content ?? null;
    case "image":
      return "[图片消息]";
    case "voice":
      return "[语音消息]";
    case "file":
      return "[文件消息]";
    default:
      return null;
  }
}
