/**
 * Streaming session manager for WeCom.
 *
 * WeCom AI Bot natively supports stream replies (Markdown chunks).
 * This module provides a high-level session abstraction with:
 * - Throttled updates (max 10/sec to avoid rate limits)
 * - Incremental text merging
 * - Auto-finish on close
 *
 * Similar in spirit to feishu/src/streaming-card.ts but simpler,
 * because WeCom's stream protocol is built-in (no separate CardKit API).
 */

import {
  createStreamSession,
  sendStreamChunk,
  type StreamReplySession,
} from "./send.js";
import type { WeComFrame } from "./types.js";

export class WeComStreamingSession {
  private session: StreamReplySession;
  private closed = false;
  private currentText = "";
  private pendingText: string | null = null;
  private lastUpdateTime = 0;
  private updateThrottleMs = 100; // max ~10 updates/sec
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private log?: (msg: string) => void;

  constructor(
    accountId: string,
    frame: WeComFrame,
    log?: (msg: string) => void,
  ) {
    this.session = createStreamSession(accountId, frame);
    this.log = log;
  }

  get streamId(): string {
    return this.session.streamId;
  }

  get isActive(): boolean {
    return !this.closed;
  }

  /**
   * Send an incremental text update (Markdown).
   *
   * Text is merged with previous content to avoid duplicates.
   * Updates are throttled to avoid WeCom rate limits.
   */
  async update(text: string): Promise<void> {
    if (this.closed) return;

    const merged = mergeStreamingText(
      this.pendingText ?? this.currentText,
      text,
    );
    if (!merged || merged === this.currentText) return;

    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateThrottleMs) {
      // Throttled — remember pending text, schedule flush
      this.pendingText = merged;
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          void this.flushPending();
        }, this.updateThrottleMs);
      }
      return;
    }

    this.pendingText = null;
    this.lastUpdateTime = now;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      const finalMerged = mergeStreamingText(this.currentText, merged);
      if (!finalMerged || finalMerged === this.currentText) return;
      this.currentText = finalMerged;
      try {
        await sendStreamChunk(this.session, finalMerged, false);
      } catch (e) {
        this.log?.(`Stream update failed: ${String(e)}`);
      }
    });
    await this.queue;
  }

  /**
   * Close the streaming session with optional final text.
   */
  async close(finalText?: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.queue;

    const pendingMerged = mergeStreamingText(
      this.currentText,
      this.pendingText ?? undefined,
    );
    const text = finalText
      ? mergeStreamingText(pendingMerged, finalText)
      : pendingMerged;

    try {
      await sendStreamChunk(this.session, text || this.currentText, true);
    } catch (e) {
      this.log?.(`Stream close failed: ${String(e)}`);
    }

    this.log?.(
      `Stream closed: streamId=${this.session.streamId}, length=${(text || this.currentText).length}`,
    );
  }

  private async flushPending(): Promise<void> {
    if (this.closed || !this.pendingText) return;
    const text = this.pendingText;
    this.pendingText = null;
    this.lastUpdateTime = Date.now();
    await this.update(text);
  }
}

// ---------------------------------------------------------------------------
// Text merging (same algorithm as feishu streaming-card.ts)
// ---------------------------------------------------------------------------

export function mergeStreamingText(
  previousText: string | undefined,
  nextText: string | undefined,
): string {
  const previous = typeof previousText === "string" ? previousText : "";
  const next = typeof nextText === "string" ? nextText : "";
  if (!next) return previous;
  if (!previous || next === previous) return next;
  if (next.startsWith(previous)) return next;
  if (previous.startsWith(next)) return previous;
  if (next.includes(previous)) return next;
  if (previous.includes(next)) return previous;

  // Partial overlap merge
  const maxOverlap = Math.min(previous.length, next.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previous.slice(-overlap) === next.slice(0, overlap)) {
      return `${previous}${next.slice(overlap)}`;
    }
  }
  return `${previous}${next}`;
}
