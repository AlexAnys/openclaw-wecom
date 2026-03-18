/**
 * Message deduplication — prevents duplicate processing on WeCom
 * reconnects and KF polling restarts.
 *
 * Uses an in-memory TTL cache. IDs are evicted after `ttlMs` (default 5 min).
 * This mirrors the pattern in @openclaw/feishu's dedup.ts.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // Sweep every 60s

interface DedupEntry {
  expiresAt: number;
}

export class MessageDedup {
  private seen = new Map<string, DedupEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.cleanupTimer = setInterval(() => this.sweep(), CLEANUP_INTERVAL_MS);
    // Allow the timer to not prevent process exit
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * Check if a message ID has been seen. If not, mark it as seen.
   *
   * @returns `true` if the message is a **duplicate** and should be skipped.
   */
  isDuplicate(msgId: string): boolean {
    if (!msgId) return false;

    const now = Date.now();
    const entry = this.seen.get(msgId);
    if (entry && entry.expiresAt > now) {
      return true; // duplicate
    }

    this.seen.set(msgId, { expiresAt: now + this.ttlMs });
    return false; // first time
  }

  /** Remove expired entries. */
  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.seen) {
      if (entry.expiresAt <= now) {
        this.seen.delete(id);
      }
    }
  }

  /** Dispose the cleanup timer. */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }
}
