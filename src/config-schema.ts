/**
 * WeCom channel configuration schema.
 *
 * Mirrors the Feishu plugin's Zod-based config-schema pattern.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Reusable primitives
// ---------------------------------------------------------------------------

/** Secret input — plain string or { env: "VAR_NAME" } reference. */
const SecretInputSchema = z.union([
  z.string(),
  z.object({ env: z.string() }),
]);

const DmPolicySchema = z.enum(["open", "pairing", "allowlist"]);
const GroupPolicySchema = z.enum(["open", "allowlist", "disabled"]);
const ConnectionModeSchema = z.enum(["websocket", "webhook"]);

// ---------------------------------------------------------------------------
// WeChat KF sub-config
// ---------------------------------------------------------------------------

export const WeComKfConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    corpId: z.string().optional(),
    corpSecret: SecretInputSchema.optional(),
    kfAccountId: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Per-account config
// ---------------------------------------------------------------------------

export const WeComAccountConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    botId: z.string().optional(),
    botSecret: SecretInputSchema.optional(),
    aesKey: SecretInputSchema.optional(),
    token: SecretInputSchema.optional(),
    connectionMode: ConnectionModeSchema.optional(),
    webhookPath: z.string().optional(),
    wsUrl: z.string().url().optional(),
    wechatKf: WeComKfConfigSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Top-level config (backward-compat single-account + named accounts)
// ---------------------------------------------------------------------------

export const WeComConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(true),
    defaultAccount: z.string().optional(),
    // Single-account top-level credentials
    botId: z.string().optional(),
    botSecret: SecretInputSchema.optional(),
    aesKey: SecretInputSchema.optional(),
    token: SecretInputSchema.optional(),
    connectionMode: ConnectionModeSchema.optional().default("websocket"),
    webhookPath: z.string().optional().default("/wecom/events"),
    wsUrl: z.string().url().optional(),
    // Policies
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    requireMention: z.boolean().optional().default(true),
    typingIndicator: z.boolean().optional().default(true),
    // WeChat KF
    wechatKf: WeComKfConfigSchema.optional(),
    // Named accounts
    accounts: z
      .record(z.string(), WeComAccountConfigSchema.optional())
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Validate that at least botId + botSecret exist at top-level or in an account.
    const hasTopLevel = !!value.botId && !!value.botSecret;
    const hasAccounts =
      value.accounts &&
      Object.values(value.accounts).some(
        (a) => a && !!a.botId && !!a.botSecret,
      );
    if (!hasTopLevel && !hasAccounts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "At least one set of bot credentials (botId + botSecret) is required, " +
          "either at the top level or in a named account.",
        path: ["botId"],
      });
    }
  });

export type WeComConfigInput = z.input<typeof WeComConfigSchema>;
export type WeComConfigOutput = z.output<typeof WeComConfigSchema>;
