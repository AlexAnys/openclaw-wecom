/**
 * @openclaw/wecom — OpenClaw WeCom (企业微信) Channel Plugin
 *
 * Two integration modes:
 *
 *   Plan A: WeCom AI Bot (WebSocket 长连接)
 *     - Zero public IP required
 *     - Supports text, image, voice, file, mixed messages
 *     - Native stream replies (Markdown)
 *     - Template card interactions
 *     - Auto-reconnect with exponential backoff
 *
 *   Plan B: WeChat KF (微信客服)
 *     - Personal WeChat users scan QR code to bind
 *     - No WeCom installation required for end users
 *     - Messages routed through KF API → OpenClaw → KF reply
 *
 * Usage:
 *   openclaw plugins install @openclaw/wecom
 *
 * Configuration (openclaw.json):
 *   {
 *     "channels": {
 *       "wecom": {
 *         "enabled": true,
 *         "botId": "<Bot ID from WeCom admin>",
 *         "botSecret": { "env": "WECOM_BOT_SECRET" },
 *         "aesKey": { "env": "WECOM_AES_KEY" },
 *         "wechatKf": {
 *           "enabled": true,
 *           "corpId": "<Corp ID>",
 *           "corpSecret": { "env": "WECOM_KF_SECRET" },
 *           "kfAccountId": "<KF Account ID>"
 *         }
 *       }
 *     }
 *   }
 */

import { wecomPlugin } from "./src/channel.js";
import { setWeComRuntime, type WeComPluginRuntime } from "./src/runtime.js";

// --- Public API exports ---

export { wecomPlugin } from "./src/channel.js";

// Send
export {
  sendTextReply,
  sendStreamChunk,
  sendTemplateCardReply,
  sendStreamWithCard,
  sendProactiveMessage,
  sendProactiveCard,
  sendWelcomeMessage,
  createStreamSession,
  generateStreamId,
  registerWeComClient,
  unregisterWeComClient,
  getWeComClient,
} from "./src/send.js";

// Streaming
export { WeComStreamingSession, mergeStreamingText } from "./src/streaming.js";

// Media
export {
  downloadWeComMedia,
  downloadWeComImage,
  downloadWeComFile,
  downloadWeComVoice,
} from "./src/media.js";

// Bot parsing
export {
  parseMessageFrame,
  parseEventFrame,
  extractBotMentionText,
  buildSessionKey,
} from "./src/bot.js";

// Dedup
export { MessageDedup } from "./src/dedup.js";

// Gateway
export { startWeComGateway, type WeComGatewayContext } from "./src/gateway.js";

// WeChat KF (Plan B)
export {
  getKfAccessToken,
  invalidateKfToken,
  getKfContactLink,
  syncKfMessages,
  sendKfMessage,
  startKfMessagePolling,
} from "./src/wechat-kf.js";
export { startKfGateway, replyToKfUser } from "./src/kf-gateway.js";

// Config & accounts
export { WeComConfigSchema, WeComKfConfigSchema } from "./src/config-schema.js";
export {
  resolveWeComAccount,
  resolveWeComCredentials,
  listWeComAccountIds,
  listEnabledWeComAccounts,
  resolveDefaultWeComAccountId,
  DEFAULT_ACCOUNT_ID,
} from "./src/accounts.js";

// Types
export type {
  WeComConfig,
  WeComAccountConfig,
  WeComKfConfig,
  WeComConnectionMode,
  WeComMessageContext,
  WeComEventType,
  WeComMessageType,
  WeComTemplateCardType,
  WeComFrame,
  WeComSendResult,
  WeComKfBindStatus,
  WeComKfLink,
  WeComMixedItem,
  ResolvedWeComAccount,
} from "./src/types.js";

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

const plugin = {
  id: "wecom",
  name: "WeCom",
  description:
    "WeCom (企业微信) AI Bot channel — WebSocket 长连接 + 微信客服 QR 绑定",
  configSchema: { type: "object", additionalProperties: false, properties: {} },
  register(api: {
    runtime: WeComPluginRuntime;
    registerChannel: (params: { plugin: typeof wecomPlugin }) => void;
  }) {
    setWeComRuntime(api.runtime);
    api.registerChannel({ plugin: wecomPlugin });
  },
};

export default plugin;
