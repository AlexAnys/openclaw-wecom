/**
 * WeCom AI Bot — wraps @wecom/aibot-node-sdk WSClient
 * and translates WeCom WebSocket events into OpenClaw message contexts.
 */

import type { WSClient } from "@wecom/aibot-node-sdk";
import type {
  WeComFrame,
  WeComMessageContext,
  WeComMixedItem,
} from "./types.js";

// ---------------------------------------------------------------------------
// Frame → MessageContext conversion
// ---------------------------------------------------------------------------

/**
 * Convert a raw WeCom WebSocket frame into a WeComMessageContext.
 *
 * Frame shape (aibot_msg_callback):
 * {
 *   cmd: "aibot_msg_callback",
 *   headers: { req_id: "xxx" },
 *   body: {
 *     msgid, msgtype, from_userid, chatid, create_time,
 *     text?: { content },
 *     image?: { url, aeskey },
 *     file?: { url, aeskey, filename },
 *     voice?: { url, aeskey },
 *     mixed?: { msg_item: [...] },
 *   }
 * }
 */
export function parseMessageFrame(frame: WeComFrame): WeComMessageContext | null {
  const body = frame.body;
  if (!body || !body.msgtype) return null;

  const msgType = body.msgtype as string;
  const ctx: WeComMessageContext = {
    msgId: (body.msgid as string) ?? "",
    msgType: msgType as WeComMessageContext["msgType"],
    fromUserId: (body.from_userid as string) ?? "",
    chatType: body.chatid ? "group" : "p2p",
    chatId: (body.chatid as string) ?? undefined,
    createTime: (body.create_time as number) ?? Math.floor(Date.now() / 1000),
    rawFrame: frame,
  };

  switch (msgType) {
    case "text": {
      const text = body.text as { content?: string } | undefined;
      ctx.text = text?.content ?? "";
      break;
    }
    case "image": {
      const image = body.image as {
        url?: string;
        aeskey?: string;
      } | undefined;
      ctx.imageUrl = image?.url;
      ctx.imageAesKey = image?.aeskey;
      break;
    }
    case "voice": {
      const voice = body.voice as {
        url?: string;
        aeskey?: string;
      } | undefined;
      ctx.voiceUrl = voice?.url;
      ctx.voiceAesKey = voice?.aeskey;
      break;
    }
    case "file": {
      const file = body.file as {
        url?: string;
        aeskey?: string;
        filename?: string;
      } | undefined;
      ctx.fileUrl = file?.url;
      ctx.fileAesKey = file?.aeskey;
      ctx.fileName = file?.filename;
      break;
    }
    case "mixed": {
      const mixed = body.mixed as {
        msg_item?: Array<{ type: string; content?: string; url?: string; aeskey?: string }>;
      } | undefined;
      ctx.mixedItems = (mixed?.msg_item ?? []).map(
        (item): WeComMixedItem => ({
          type: item.type as "text" | "image",
          content: item.content,
          imageUrl: item.url,
          imageAesKey: item.aeskey,
        }),
      );
      // Extract text from mixed items for convenience
      ctx.text = (mixed?.msg_item ?? [])
        .filter((i) => i.type === "text")
        .map((i) => i.content ?? "")
        .join("\n");
      break;
    }
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

export interface WeComEventContext {
  eventType: string;
  fromUserId?: string;
  chatId?: string;
  rawFrame: WeComFrame;
}

/**
 * Parse an event callback frame.
 *
 * Frame shape (aibot_event_callback):
 * {
 *   cmd: "aibot_event_callback",
 *   headers: { req_id: "xxx" },
 *   body: {
 *     msgid, msgtype: "event",
 *     event: { eventtype: "enter_chat" | "template_card_event" | "feedback_event", ... }
 *   }
 * }
 */
export function parseEventFrame(frame: WeComFrame): WeComEventContext | null {
  const body = frame.body;
  if (!body) return null;
  const event = body.event as {
    eventtype?: string;
    from_userid?: string;
    chatid?: string;
  } | undefined;
  if (!event?.eventtype) return null;

  return {
    eventType: event.eventtype,
    fromUserId: event.from_userid,
    chatId: event.chatid,
    rawFrame: frame,
  };
}

// ---------------------------------------------------------------------------
// Bot mention detection (group messages)
// ---------------------------------------------------------------------------

/**
 * Check if the message text starts with a @bot mention.
 * WeCom AI Bot messages in groups always start with the bot name.
 */
export function extractBotMentionText(
  text: string | undefined,
  _botName?: string,
): { mentionedBot: boolean; cleanText: string } {
  if (!text) return { mentionedBot: false, cleanText: "" };
  // WeCom AI Bot group messages always mention the bot — the bot only
  // receives messages where it is mentioned or in DM. So we treat all
  // inbound messages as "mentionedBot: true".
  return { mentionedBot: true, cleanText: text.trim() };
}

// ---------------------------------------------------------------------------
// Session ID generation
// ---------------------------------------------------------------------------

/**
 * Build a deterministic session key for OpenClaw conversation routing.
 *
 * - DM: `wecom:<accountId>:dm:<userId>`
 * - Group: `wecom:<accountId>:group:<chatId>`
 */
export function buildSessionKey(params: {
  accountId: string;
  chatType: "p2p" | "group";
  fromUserId: string;
  chatId?: string;
}): string {
  const { accountId, chatType, fromUserId, chatId } = params;
  if (chatType === "group" && chatId) {
    return `wecom:${accountId}:group:${chatId}`;
  }
  return `wecom:${accountId}:dm:${fromUserId}`;
}
