/**
 * WeCom ChannelPlugin — the core integration with OpenClaw's channel system.
 *
 * Follows the exact same interface as feishu/src/channel.ts:
 * - meta, capabilities, pairing, config, actions, security, setup,
 *   onboarding, messaging, directory, outbound, status, gateway.
 */

import {
  resolveWeComAccount,
  listWeComAccountIds,
  listEnabledWeComAccounts,
  resolveDefaultWeComAccountId,
  resolveWeComCredentials,
  DEFAULT_ACCOUNT_ID,
} from "./accounts.js";
import { startWeComGateway } from "./gateway.js";
import { sendTextReply, sendProactiveMessage, getWeComClient } from "./send.js";
import { WeComStreamingSession } from "./streaming.js";
import type { WeComConfig, ResolvedWeComAccount } from "./types.js";

// ---------------------------------------------------------------------------
// Channel metadata
// ---------------------------------------------------------------------------

const meta = {
  id: "wecom" as const,
  label: "WeCom",
  selectionLabel: "WeCom / 企业微信",
  docsPath: "/channels/wecom",
  docsLabel: "wecom",
  blurb: "企业微信 AI Bot (WebSocket 长连接) + 微信客服，无需公网 IP。",
  aliases: ["wxwork", "wechat-work"],
  order: 36,
};

// ---------------------------------------------------------------------------
// Channel plugin definition
// ---------------------------------------------------------------------------

export const wecomPlugin = {
  id: "wecom" as const,
  meta: { ...meta },

  // --- Capabilities ---
  capabilities: {
    chatTypes: ["direct", "channel"] as const,
    polls: false,
    threads: false, // WeCom AI Bot doesn't have thread/topic model
    media: true,
    reactions: false, // WeCom AI Bot doesn't support reactions
    edit: false, // Cannot edit sent messages
    reply: true,
    streaming: true, // Native stream support
  },

  // --- Pairing (user approval flow) ---
  pairing: {
    idLabel: "wecomUserId",
    normalizeAllowEntry: (entry: string) =>
      entry.replace(/^(wecom|user):/i, ""),
    notifyApproval: async (params: {
      cfg: { channels?: { wecom?: WeComConfig } };
      id: string;
    }) => {
      const accounts = listEnabledWeComAccounts(params.cfg);
      if (accounts.length === 0) return;
      // Try proactive send — will fail if user hasn't chatted yet
      try {
        await sendProactiveMessage({
          accountId: accounts[0].accountId,
          chatId: params.id,
          text: "✅ Your access has been approved. You can now chat with the AI assistant.",
        });
      } catch {
        // Proactive send may fail if user hasn't initiated a conversation
      }
    },
  },

  // --- Account management ---
  config: {
    listAccountIds: (cfg: { channels?: { wecom?: WeComConfig } }) =>
      listWeComAccountIds(cfg),
    resolveAccount: (
      cfg: { channels?: { wecom?: WeComConfig } },
      accountId: string,
    ) => resolveWeComAccount({ cfg, accountId }),
    defaultAccountId: (cfg: { channels?: { wecom?: WeComConfig } }) =>
      resolveDefaultWeComAccountId(cfg),
    setAccountEnabled: (params: {
      cfg: { channels?: { wecom?: WeComConfig } };
      accountId: string;
      enabled: boolean;
    }) => {
      const wecomCfg = params.cfg.channels?.wecom;
      if (params.accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...params.cfg,
          channels: {
            ...params.cfg.channels,
            wecom: { ...wecomCfg, enabled: params.enabled },
          },
        };
      }
      return {
        ...params.cfg,
        channels: {
          ...params.cfg.channels,
          wecom: {
            ...wecomCfg,
            accounts: {
              ...wecomCfg?.accounts,
              [params.accountId]: {
                ...wecomCfg?.accounts?.[params.accountId],
                enabled: params.enabled,
              },
            },
          },
        },
      };
    },
    isConfigured: (account: ResolvedWeComAccount) => account.configured,
    describeAccount: (account: ResolvedWeComAccount) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      botId: account.botId,
      connectionMode: account.config.connectionMode ?? "websocket",
    }),
  },

  // --- Actions ---
  actions: {
    listActions: (params: {
      cfg: { channels?: { wecom?: WeComConfig } };
    }) => {
      if (listEnabledWeComAccounts(params.cfg).length === 0) return [];
      return ["send"] as const;
    },
    supportsCards: (params: {
      cfg: { channels?: { wecom?: WeComConfig } };
    }) => {
      const wecomCfg = params.cfg.channels?.wecom;
      return (
        wecomCfg?.enabled !== false &&
        !!resolveWeComCredentials(wecomCfg)
      );
    },
  },

  // --- Security warnings ---
  security: {
    collectWarnings: (params: {
      cfg: { channels?: { wecom?: WeComConfig } };
      accountId: string;
    }) => {
      const warnings: string[] = [];
      const account = resolveWeComAccount({
        cfg: params.cfg,
        accountId: params.accountId,
      });
      if (
        account.config.dmPolicy === "open" &&
        account.config.groupPolicy === "open"
      ) {
        warnings.push(
          "Both dmPolicy and groupPolicy are set to 'open'. " +
          "Any WeCom user can interact with the bot without approval.",
        );
      }
      return warnings;
    },
  },

  // --- Setup ---
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: (params: {
      cfg: { channels?: { wecom?: WeComConfig } };
      accountId: string;
    }) => ({
      ...params.cfg,
      channels: {
        ...params.cfg.channels,
        wecom: {
          ...params.cfg.channels?.wecom,
          enabled: true,
        },
      },
    }),
  },

  // --- Messaging ---
  messaging: {
    normalizeTarget: (raw: string) => {
      // Accept: userid, user:userid, chat:chatid
      if (raw.startsWith("user:")) return raw.slice(5);
      if (raw.startsWith("chat:")) return raw;
      return raw;
    },
    targetResolver: {
      looksLikeId: (raw: string) => /^[a-zA-Z0-9_-]+$/.test(raw),
      hint: "<userid|chat:chatid>",
    },
  },

  // --- Outbound ---
  outbound: {
    deliveryMode: "direct" as const,
    textChunkLimit: 4000,
    sendText: async (params: {
      cfg: { channels?: { wecom?: WeComConfig } };
      to: string;
      text: string;
      accountId?: string | null;
    }) => {
      const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;

      // Determine if this is a reply to an inbound message or a proactive send
      // For proactive sends, use sendProactiveMessage
      const result = await sendProactiveMessage({
        accountId,
        chatId: params.to,
        text: params.text,
      });
      return { channel: "wecom" as const, ...result };
    },
    sendMedia: async (params: {
      cfg: { channels?: { wecom?: WeComConfig } };
      to: string;
      text?: string;
      mediaUrl?: string;
      accountId?: string | null;
    }) => {
      // WeCom AI Bot doesn't support proactive media upload.
      // Send the media URL as a text link instead.
      const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
      const text = [params.text, params.mediaUrl ? `📎 ${params.mediaUrl}` : ""]
        .filter(Boolean)
        .join("\n\n");
      const result = await sendProactiveMessage({
        accountId,
        chatId: params.to,
        text,
      });
      return { channel: "wecom" as const, ...result };
    },
  },

  // --- Status ---
  status: {
    buildChannelSummary: (params: {
      snapshot: Record<string, unknown>;
    }) => {
      const status = params.snapshot.status as string | undefined;
      return status === "authenticated"
        ? "connected"
        : status ?? "unknown";
    },
    probeAccount: async (params: {
      account: ResolvedWeComAccount;
    }) => {
      // Quick probe: check if credentials are present
      const creds = resolveWeComCredentials(params.account.config);
      return {
        ok: !!creds,
        error: creds ? undefined : "Missing botId or botSecret",
        botId: creds?.botId,
      };
    },
  },

  // --- Gateway (event listening) ---
  gateway: {
    startAccount: async (ctx: {
      cfg: { channels?: { wecom?: WeComConfig } };
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
        setStatus?: (params: {
          accountId: string;
          status: string;
        }) => void;
      };
      log?: {
        info: (msg: string) => void;
        warn: (msg: string) => void;
        error: (msg: string) => void;
        debug: (msg: string) => void;
      };
      setStatus?: (params: Record<string, unknown>) => void;
    }) => {
      return startWeComGateway({
        cfg: ctx.cfg,
        accountId: ctx.accountId,
        abortSignal: ctx.abortSignal,
        runtime: ctx.runtime,
        log: ctx.log,
      });
    },
  },
};
