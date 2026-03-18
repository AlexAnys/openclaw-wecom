/**
 * WeChat KF (微信客服) integration — Plan B.
 *
 * Allows personal WeChat users to chat with OpenClaw AI without
 * installing WeCom, by binding through a customer-service link.
 *
 * Architecture:
 *   个人微信用户 → 扫码/链接绑定 → 微信客服会话 → 企业微信 API → OpenClaw
 *
 * API reference: https://developer.work.weixin.qq.com/document/path/94677
 */

import https from "node:https";
import crypto from "node:crypto";
import type { WeComKfConfig, WeComKfLink } from "./types.js";

// ---------------------------------------------------------------------------
// Access token management
// ---------------------------------------------------------------------------

interface TokenCache {
  token: string;
  expiresAt: number;
}

// Cache key uses a hash of corpId, NOT the raw secret
const _tokenCache = new Map<string, TokenCache>();

function tokenCacheKey(corpId: string): string {
  return `kf:${corpId}`;
}

/**
 * Get an access_token for the WeChat KF API.
 *
 * Uses Corp ID + Corp Secret to obtain a token with 客服 scope.
 * Caches the token until 5 minutes before expiry.
 */
export async function getKfAccessToken(config: WeComKfConfig): Promise<string> {
  const corpId = config.corpId;
  if (!corpId) throw new Error("WeChat KF requires corpId");

  const cacheKey = tokenCacheKey(corpId);
  const cached = _tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 300_000) {
    return cached.token;
  }

  const corpSecret = resolveSecretValue(config.corpSecret);
  if (!corpSecret) throw new Error("WeChat KF requires corpSecret");

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`;
  const data = await fetchJson<{
    errcode: number;
    errmsg: string;
    access_token: string;
    expires_in: number;
  }>(url);

  if (data.errcode !== 0) {
    throw new Error(`WeChat KF gettoken failed: ${data.errmsg} (code: ${data.errcode})`);
  }

  _tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

/** Invalidate cached token (e.g. on auth error). */
export function invalidateKfToken(corpId: string): void {
  _tokenCache.delete(tokenCacheKey(corpId));
}

// ---------------------------------------------------------------------------
// KF contact link (for QR code / URL sharing)
// ---------------------------------------------------------------------------

/**
 * Get a customer-service contact link.
 *
 * API: POST /cgi-bin/kf/add_contact_way
 * Response: { errcode, errmsg, url }
 *
 * The returned URL can be shared directly or encoded as a QR code.
 * Contact ways persist until explicitly deleted — they do not expire.
 */
export async function getKfContactLink(
  config: WeComKfConfig,
): Promise<WeComKfLink> {
  const token = await getKfAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/kf/add_contact_way?access_token=${token}`;

  const data = await fetchJson<{
    errcode: number;
    errmsg: string;
    url?: string;
  }>(url, {
    method: "POST",
    body: JSON.stringify({
      open_kfid: config.kfAccountId,
      scene: "openclaw",
    }),
  });

  if (data.errcode !== 0) {
    throw new Error(
      `WeChat KF add_contact_way failed: ${data.errmsg} (code: ${data.errcode})`,
    );
  }

  return {
    url: data.url ?? "",
    // Contact ways don't expire; set a far-future timestamp
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  };
}

// ---------------------------------------------------------------------------
// Message sync (pull new messages from KF)
// ---------------------------------------------------------------------------

export interface KfMessage {
  msgid: string;
  open_kfid: string;
  external_userid: string;
  send_time: number;
  origin: number; // 3 = WeChat user, 4 = system, 5 = agent
  msgtype: string;
  text?: { content: string };
  image?: { media_id: string };
  voice?: { media_id: string };
  file?: { media_id: string };
}

export interface KfSyncResult {
  messages: KfMessage[];
  hasMore: boolean;
  nextCursor: string;
}

/**
 * Pull new messages from the KF channel.
 *
 * API: POST /cgi-bin/kf/sync_msg
 *
 * Note: sync_msg returns messages for ALL KF accounts in the corp.
 * Filtering by kfAccountId happens client-side.
 */
export async function syncKfMessages(
  config: WeComKfConfig,
  cursor?: string,
  limit = 100,
): Promise<KfSyncResult> {
  const token = await getKfAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${token}`;

  const body: Record<string, unknown> = { limit };
  if (cursor) body.cursor = cursor;
  // Note: sync_msg does NOT accept open_kfid; all KF messages are returned.

  const data = await fetchJson<{
    errcode: number;
    errmsg: string;
    msg_list?: KfMessage[];
    has_more?: number;
    next_cursor?: string;
  }>(url, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (data.errcode !== 0) {
    // Token expired — invalidate and let caller retry
    if (data.errcode === 40014 || data.errcode === 42001) {
      invalidateKfToken(config.corpId ?? "");
    }
    throw new Error(
      `WeChat KF sync_msg failed: ${data.errmsg} (code: ${data.errcode})`,
    );
  }

  // Filter to only our KF account
  const messages = (data.msg_list ?? []).filter(
    (msg) => !config.kfAccountId || msg.open_kfid === config.kfAccountId,
  );

  return {
    messages,
    hasMore: data.has_more === 1,
    nextCursor: data.next_cursor ?? "",
  };
}

// ---------------------------------------------------------------------------
// Send message to KF user
// ---------------------------------------------------------------------------

/**
 * Send a text message to a WeChat KF user.
 *
 * API: POST /cgi-bin/kf/send_msg
 */
export async function sendKfMessage(params: {
  config: WeComKfConfig;
  toUser: string;
  text: string;
}): Promise<void> {
  const { config, toUser, text } = params;
  const token = await getKfAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${token}`;

  const data = await fetchJson<{
    errcode: number;
    errmsg: string;
    msgid?: string;
  }>(url, {
    method: "POST",
    body: JSON.stringify({
      touser: toUser,
      open_kfid: config.kfAccountId,
      msgtype: "text",
      text: { content: text },
    }),
  });

  if (data.errcode !== 0) {
    throw new Error(
      `WeChat KF send_msg failed: ${data.errmsg} (code: ${data.errcode})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Polling loop with cursor persistence
// ---------------------------------------------------------------------------

/**
 * Start polling KF messages at a given interval.
 *
 * The `cursorStore` callbacks allow the caller to persist the cursor
 * across process restarts (e.g. write to a file or KV store).
 *
 * Returns a cleanup function to stop polling.
 */
export function startKfMessagePolling(params: {
  config: WeComKfConfig;
  intervalMs?: number;
  onMessage: (msg: KfMessage) => void | Promise<void>;
  onError?: (err: Error) => void;
  abortSignal?: AbortSignal;
  cursorStore?: {
    load: () => Promise<string> | string;
    save: (cursor: string) => Promise<void> | void;
  };
}): () => void {
  const {
    config,
    intervalMs = 5000,
    onMessage,
    onError,
    abortSignal,
    cursorStore,
  } = params;
  let cursor = "";
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Load persisted cursor on start
  const init = async () => {
    if (cursorStore) {
      try {
        cursor = await cursorStore.load();
      } catch {
        cursor = "";
      }
    }
    void poll();
  };

  const poll = async () => {
    if (!running) return;

    try {
      const result = await syncKfMessages(config, cursor || undefined);

      if (result.nextCursor) {
        cursor = result.nextCursor;
        // Persist cursor
        if (cursorStore) {
          try {
            await cursorStore.save(cursor);
          } catch {
            // Non-fatal; cursor will be lost on restart
          }
        }
      }

      for (const msg of result.messages) {
        // Only process user-originated messages (origin=3)
        if (msg.origin === 3) {
          try {
            await onMessage(msg);
          } catch (err) {
            onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }

      // If there are more messages, poll again soon — but use setTimeout
      // (not recursion) to avoid stack overflow, with a cap of 10 rapid polls
      if (result.hasMore && running) {
        timer = setTimeout(() => void poll(), 200);
        return;
      }
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }

    // Schedule next poll at normal interval
    if (running) {
      timer = setTimeout(() => void poll(), intervalMs);
    }
  };

  void init();

  const stop = () => {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  if (abortSignal) {
    if (abortSignal.aborted) {
      stop();
    } else {
      abortSignal.addEventListener("abort", stop, { once: true });
    }
  }

  return stop;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveSecretValue(
  value: string | { env: string } | undefined,
): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "env" in value) {
    return process.env[value.env] ?? undefined;
  }
  return undefined;
}

const HTTP_TIMEOUT_MS = 15_000;

async function fetchJson<T>(
  url: string,
  options?: { method?: string; body?: string },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions: https.RequestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options?.method ?? "GET",
      timeout: HTTP_TIMEOUT_MS,
      headers: options?.body
        ? { "Content-Type": "application/json" }
        : undefined,
    };

    const req = https.request(reqOptions, (res) => {
      // Check HTTP status
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        // Drain the response
        res.resume();
        reject(
          new Error(
            `HTTP ${res.statusCode} from ${urlObj.hostname}${urlObj.pathname}`,
          ),
        );
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(data as T);
        } catch {
          reject(
            new Error(
              `Invalid JSON from ${urlObj.hostname}${urlObj.pathname}`,
            ),
          );
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout (${HTTP_TIMEOUT_MS}ms) for ${urlObj.hostname}${urlObj.pathname}`));
    });

    req.on("error", (err) => {
      reject(new Error(`HTTP request failed: ${err.message}`));
    });

    if (options?.body) req.write(options.body);
    req.end();
  });
}
