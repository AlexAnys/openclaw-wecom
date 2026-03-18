/**
 * WeCom channel type definitions.
 *
 * Mirrors the pattern established by @openclaw/feishu, adapted
 * for 企业微信 AI Bot WebSocket protocol and WeChat KF binding.
 */

// ---------------------------------------------------------------------------
// Connection & Account
// ---------------------------------------------------------------------------

export type WeComConnectionMode = "websocket" | "webhook";

export type WeComAccountSelectionSource =
  | "explicit"
  | "explicit-default"
  | "mapped-default"
  | "fallback";

export interface ResolvedWeComAccount {
  accountId: string;
  selectionSource: WeComAccountSelectionSource;
  enabled: boolean;
  configured: boolean;
  name?: string;
  botId?: string;
  /** Merged config (top-level defaults + account-specific overrides). */
  config: WeComConfig;
}

// ---------------------------------------------------------------------------
// Message context (inbound)
// ---------------------------------------------------------------------------

/** Unified inbound message context — one per received WeCom message. */
export interface WeComMessageContext {
  /** Unique message id assigned by WeCom. */
  msgId: string;
  /** Message type: text | image | mixed | voice | file */
  msgType: WeComMessageType;
  /** Sender's enterprise userid. */
  fromUserId: string;
  /** Chat type (p2p or group). */
  chatType: "p2p" | "group";
  /** Group chatid when chatType === "group". */
  chatId?: string;
  /** Unix timestamp (seconds). */
  createTime: number;
  /** Text content (for text messages). */
  text?: string;
  /** Image URL (for image messages, needs AES decryption). */
  imageUrl?: string;
  /** Image AES key (Base64). */
  imageAesKey?: string;
  /** File URL (for file messages, needs AES decryption). */
  fileUrl?: string;
  /** File AES key (Base64). */
  fileAesKey?: string;
  /** File name. */
  fileName?: string;
  /** Voice URL. */
  voiceUrl?: string;
  /** Voice AES key. */
  voiceAesKey?: string;
  /** Mixed content items (for mixed messages). */
  mixedItems?: WeComMixedItem[];
  /** Raw WeCom WebSocket frame for pass-through replies. */
  rawFrame: WeComFrame;
}

export interface WeComMixedItem {
  type: "text" | "image";
  content?: string;
  imageUrl?: string;
  imageAesKey?: string;
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export type WeComMessageType = "text" | "image" | "mixed" | "voice" | "file";

export type WeComEventType =
  | "enter_chat"
  | "template_card_event"
  | "feedback_event";

export type WeComTemplateCardType =
  | "text_notice"
  | "news_notice"
  | "button_interaction"
  | "vote_interaction"
  | "multiple_interaction";

// ---------------------------------------------------------------------------
// WebSocket frame
// ---------------------------------------------------------------------------

export interface WeComFrame {
  cmd?: string;
  headers?: { req_id?: string; [key: string]: unknown };
  body?: Record<string, unknown>;
  errcode?: number;
  errmsg?: string;
}

// ---------------------------------------------------------------------------
// Send result
// ---------------------------------------------------------------------------

export interface WeComSendResult {
  /** Echo-back: the channel name. */
  channel: "wecom";
  /** The req_id used for the reply. */
  reqId: string;
}

// ---------------------------------------------------------------------------
// WeChat KF (微信客服)
// ---------------------------------------------------------------------------

export interface WeComKfBindStatus {
  bound: boolean;
  nickname?: string;
  avatar?: string;
  expiresAt?: number;
}

export interface WeComKfLink {
  url: string;
  qrCodeUrl?: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Configuration (inferred from Zod — see config-schema.ts)
// ---------------------------------------------------------------------------

export interface WeComConfig {
  enabled?: boolean;
  defaultAccount?: string;
  /** Bot credentials — top-level for single-account backward compat. */
  botId?: string;
  botSecret?: string;
  /** AES key for file decryption (Base64). */
  aesKey?: string;
  /** Token for webhook verification. */
  token?: string;
  /** Connection mode: websocket (default, zero public IP) or webhook. */
  connectionMode?: WeComConnectionMode;
  /** Webhook path when using webhook mode. */
  webhookPath?: string;
  /** Custom WebSocket URL override (for testing / staging). */
  wsUrl?: string;
  // --- policies ---
  dmPolicy?: "open" | "pairing" | "allowlist";
  groupPolicy?: "open" | "allowlist" | "disabled";
  requireMention?: boolean;
  typingIndicator?: boolean;
  /** WeChat KF sub-config. */
  wechatKf?: WeComKfConfig;
  /** Named accounts. */
  accounts?: Record<string, WeComAccountConfig | undefined>;
}

export interface WeComAccountConfig {
  enabled?: boolean;
  name?: string;
  botId?: string;
  botSecret?: string;
  aesKey?: string;
  token?: string;
  connectionMode?: WeComConnectionMode;
  webhookPath?: string;
  wsUrl?: string;
  wechatKf?: WeComKfConfig;
}

export interface WeComKfConfig {
  enabled?: boolean;
  /** Corp ID for WeChat KF API calls. */
  corpId?: string;
  /** Corp secret with 客服 scope. */
  corpSecret?: string;
  /** KF account id. */
  kfAccountId?: string;
}
