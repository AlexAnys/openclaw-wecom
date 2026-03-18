/**
 * WeChat KF (微信客服) integration — Plan B.
 *
 * Allows personal WeChat users to chat with OpenClaw AI without
 * installing WeCom, by binding through a customer-service QR code.
 *
 * Architecture:
 *   个人微信用户 → 扫码绑定 → 微信客服会话 → 企业微信 API → OpenClaw
 *
 * This module handles:
 * 1. Obtaining a customer-service binding link (QR code URL)
 * 2. Polling bind status
 * 3. Receiving messages from bound WeChat users via the KF API
 * 4. Sending replies back through the KF channel
 * 5. Unbinding
 *
 * Prerequisites:
 * - Enterprise WeChat account with "微信客服" enabled
 * - Corp ID + Corp Secret (with 客服 scope)
 * - KF account ID (created in WeCom admin console)
 *
 * API reference: https://developer.work.weixin.qq.com/document/path/94677
 */

import https from "node:https";
import type { WeComKfConfig, WeComKfBindStatus, WeComKfLink } from "./types.js";

// ---------------------------------------------------------------------------
// Access token management
// ---------------------------------------------------------------------------

interface TokenCache {
  token: string;
  expiresAt: number;
}

const _tokenCache = new Map<string, TokenCache>();

/**
 * Get an access_token for the WeChat KF API.
 *
 * Uses Corp ID + Corp Secret to obtain a token with 客服 scope.
 * Caches the token until 5 minutes before expiry.
 */
export async function getKfAccessToken(config: WeComKfConfig): Promise<string> {
  const cacheKey = `${config.corpId}:${config.corpSecret}`;
  const cached = _tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 300_000) {
    return cached.token;
  }

  const corpId = config.corpId;
  const corpSecret =
    typeof config.corpSecret === "string"
      ? config.corpSecret
      : config.corpSecret
        ? process.env[(config.corpSecret as { env: string }).env] ?? ""
        : "";

  if (!corpId || !corpSecret) {
    throw new Error("WeChat KF requires corpId and corpSecret");
  }

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

// ---------------------------------------------------------------------------
// KF account management
// ---------------------------------------------------------------------------

/**
 * Get the customer-service contact link (for QR code generation).
 *
 * API: POST /cgi-bin/kf/add_contact_way
 * Returns a URL that can be encoded as a QR code for WeChat scanning.
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
    qr_code?: string;
    expire_time?: number;
  }>(url, {
    method: "POST",
    body: JSON.stringify({
      open_kfid: config.kfAccountId,
      scene: "openclaw_bind",
    }),
  });

  if (data.errcode !== 0) {
    throw new Error(
      `WeChat KF add_contact_way failed: ${data.errmsg} (code: ${data.errcode})`,
    );
  }

  return {
    url: data.url ?? "",
    qrCodeUrl: data.qr_code,
    // Default 30-day expiry if not specified
    expiresAt: data.expire_time
      ? data.expire_time * 1000
      : Date.now() + 30 * 24 * 60 * 60 * 1000,
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
  origin: number; // 3 = user, 4 = system, 5 = agent
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
 */
export async function syncKfMessages(
  config: WeComKfConfig,
  cursor?: string,
  limit = 100,
): Promise<KfSyncResult> {
  const token = await getKfAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${token}`;

  const body: Record<string, unknown> = {
    open_kfid: config.kfAccountId,
    limit,
  };
  if (cursor) body.cursor = cursor;

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
    throw new Error(
      `WeChat KF sync_msg failed: ${data.errmsg} (code: ${data.errcode})`,
    );
  }

  return {
    messages: data.msg_list ?? [],
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
// KF event callback handling
// ---------------------------------------------------------------------------

export interface KfEventCallback {
  event_type: string;
  open_kfid: string;
  external_userid?: string;
  scene?: string;
  scene_param?: string;
  welcome_code?: string;
  fail_msgid?: string;
  fail_type?: number;
}

/**
 * Start polling KF messages at a given interval.
 *
 * Returns a cleanup function to stop polling.
 */
export function startKfMessagePolling(params: {
  config: WeComKfConfig;
  intervalMs?: number;
  onMessage: (msg: KfMessage) => void | Promise<void>;
  onError?: (err: Error) => void;
  abortSignal?: AbortSignal;
}): () => void {
  const { config, intervalMs = 5000, onMessage, onError, abortSignal } = params;
  let cursor = "";
  let running = true;

  const poll = async () => {
    if (!running) return;
    try {
      const result = await syncKfMessages(config, cursor || undefined);
      cursor = result.nextCursor;

      for (const msg of result.messages) {
        // Only process user-originated messages (origin=3)
        if (msg.origin === 3) {
          try {
            await onMessage(msg);
          } catch (err) {
            onError?.(
              err instanceof Error ? err : new Error(String(err)),
            );
          }
        }
      }

      // If there are more messages, poll again immediately
      if (result.hasMore) {
        if (running) void poll();
        return;
      }
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }

    // Schedule next poll
    if (running) {
      setTimeout(() => void poll(), intervalMs);
    }
  };

  void poll();

  const stop = () => {
    running = false;
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
// HTTP helper
// ---------------------------------------------------------------------------

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
      headers: options?.body
        ? { "Content-Type": "application/json" }
        : undefined,
    };

    const req = https.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(data as T);
        } catch (err) {
          reject(new Error(`Failed to parse response from ${url}: ${String(err)}`));
        }
      });
    });

    req.on("error", reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}
