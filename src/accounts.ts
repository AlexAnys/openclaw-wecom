/**
 * Account resolution — resolve credentials from config,
 * supporting both top-level single-account and named accounts.
 */

import type {
  ResolvedWeComAccount,
  WeComConfig,
  WeComAccountConfig,
} from "./types.js";

export const DEFAULT_ACCOUNT_ID = "default";

/** Resolve a secret value — plain string or { env: "VAR" }. */
function resolveSecret(
  value: string | { env: string } | undefined,
): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "env" in value) {
    return process.env[value.env] ?? undefined;
  }
  return undefined;
}

/** List all known account IDs from the config. */
export function listWeComAccountIds(cfg: { channels?: { wecom?: WeComConfig } }): string[] {
  const wecomCfg = cfg.channels?.wecom;
  if (!wecomCfg) return [];
  const ids = new Set<string>();
  // Top-level credentials → default account
  if (wecomCfg.botId) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }
  // Named accounts
  if (wecomCfg.accounts) {
    for (const id of Object.keys(wecomCfg.accounts)) {
      ids.add(id);
    }
  }
  if (ids.size === 0) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }
  return Array.from(ids);
}

/** Resolve the default account ID. */
export function resolveDefaultWeComAccountId(cfg: {
  channels?: { wecom?: WeComConfig };
}): string {
  return cfg.channels?.wecom?.defaultAccount ?? DEFAULT_ACCOUNT_ID;
}

/** List enabled accounts with resolved credentials. */
export function listEnabledWeComAccounts(cfg: {
  channels?: { wecom?: WeComConfig };
}): ResolvedWeComAccount[] {
  return listWeComAccountIds(cfg)
    .map((id) => resolveWeComAccount({ cfg, accountId: id }))
    .filter((a) => a.enabled);
}

/**
 * Resolve a single account by ID.
 *
 * Merges top-level defaults with account-specific overrides.
 */
export function resolveWeComAccount(params: {
  cfg: { channels?: { wecom?: WeComConfig } };
  accountId?: string;
}): ResolvedWeComAccount {
  const { cfg, accountId } = params;
  const wecomCfg = cfg.channels?.wecom;
  const id = accountId ?? resolveDefaultWeComAccountId(cfg);
  const isDefault = id === DEFAULT_ACCOUNT_ID;

  const accountOverride: WeComAccountConfig | undefined =
    wecomCfg?.accounts?.[id];

  // Merge: account-specific > top-level > defaults
  const botId =
    resolveSecret(accountOverride?.botId) ??
    (isDefault ? resolveSecret(wecomCfg?.botId) : undefined);
  const botSecret =
    resolveSecret(accountOverride?.botSecret) ??
    (isDefault ? resolveSecret(wecomCfg?.botSecret) : undefined);
  const aesKey =
    resolveSecret(accountOverride?.aesKey) ??
    (isDefault ? resolveSecret(wecomCfg?.aesKey) : undefined);

  const enabled =
    accountOverride?.enabled ?? (isDefault ? wecomCfg?.enabled !== false : false);
  const configured = !!botId && !!botSecret;

  const mergedConfig: WeComConfig = {
    ...wecomCfg,
    ...accountOverride,
    botId,
    botSecret,
    aesKey,
    connectionMode:
      accountOverride?.connectionMode ??
      wecomCfg?.connectionMode ??
      "websocket",
    wsUrl: accountOverride?.wsUrl ?? wecomCfg?.wsUrl,
    wechatKf: accountOverride?.wechatKf ?? wecomCfg?.wechatKf,
  };

  return {
    accountId: id,
    selectionSource: isDefault ? "fallback" : "explicit",
    enabled,
    configured,
    name: accountOverride?.name,
    botId,
    config: mergedConfig,
  };
}

/** Resolve credentials for connection. Returns null if not configured. */
export function resolveWeComCredentials(
  wecomCfg: WeComConfig | undefined,
): { botId: string; botSecret: string; aesKey?: string } | null {
  if (!wecomCfg) return null;
  const botId = resolveSecret(wecomCfg.botId);
  const botSecret = resolveSecret(wecomCfg.botSecret);
  if (!botId || !botSecret) return null;
  return {
    botId,
    botSecret,
    aesKey: resolveSecret(wecomCfg.aesKey),
  };
}
