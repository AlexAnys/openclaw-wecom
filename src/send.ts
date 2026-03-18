/**
 * Outbound message sending — reply to inbound messages or proactively
 * push via the WeCom AI Bot WebSocket channel.
 *
 * Supports: plain text, stream (Markdown), template cards, stream+card combos.
 */

import type { WSClient } from "@wecom/aibot-node-sdk";
import crypto from "node:crypto";
import type {
  WeComFrame,
  WeComSendResult,
  WeComTemplateCardType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Client registry — gateway sets the active WSClient per account
// ---------------------------------------------------------------------------

const _clients = new Map<string, WSClient>();

export function registerWeComClient(accountId: string, client: WSClient): void {
  _clients.set(accountId, client);
}

export function unregisterWeComClient(accountId: string): void {
  _clients.delete(accountId);
}

export function getWeComClient(accountId: string): WSClient | undefined {
  return _clients.get(accountId);
}

function requireClient(accountId: string): WSClient {
  const client = _clients.get(accountId);
  if (!client) {
    throw new Error(
      `WeCom client for account "${accountId}" not available. Is the gateway running?`,
    );
  }
  return client;
}

// ---------------------------------------------------------------------------
// Generate unique stream ID
// ---------------------------------------------------------------------------

export function generateStreamId(): string {
  return `stream_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Reply: plain text
// ---------------------------------------------------------------------------

export interface SendTextReplyParams {
  accountId: string;
  frame: WeComFrame;
  text: string;
}

export async function sendTextReply(
  params: SendTextReplyParams,
): Promise<WeComSendResult> {
  const { accountId, frame, text } = params;
  const client = requireClient(accountId);
  await client.reply(frame, {
    msgtype: "markdown",
    markdown: { content: text },
  });
  return { channel: "wecom", reqId: frame.headers?.req_id as string ?? "" };
}

// ---------------------------------------------------------------------------
// Reply: stream (Markdown, chunked)
// ---------------------------------------------------------------------------

export interface StreamReplySession {
  accountId: string;
  frame: WeComFrame;
  streamId: string;
  finished: boolean;
}

export function createStreamSession(
  accountId: string,
  frame: WeComFrame,
): StreamReplySession {
  return {
    accountId,
    frame,
    streamId: generateStreamId(),
    finished: false,
  };
}

/**
 * Send a streaming text chunk. Call with `finish: true` for the last chunk.
 */
export async function sendStreamChunk(
  session: StreamReplySession,
  content: string,
  finish = false,
): Promise<void> {
  if (session.finished) return;
  const client = requireClient(session.accountId);
  await client.replyStream(session.frame, session.streamId, content, finish);
  if (finish) session.finished = true;
}

// ---------------------------------------------------------------------------
// Reply: template card
// ---------------------------------------------------------------------------

export interface TemplateCardParams {
  cardType: WeComTemplateCardType;
  /** Card-type-specific payload. */
  [key: string]: unknown;
}

export async function sendTemplateCardReply(params: {
  accountId: string;
  frame: WeComFrame;
  templateCard: TemplateCardParams;
}): Promise<WeComSendResult> {
  const { accountId, frame, templateCard } = params;
  const client = requireClient(accountId);
  await client.replyTemplateCard(frame, templateCard as Record<string, unknown>);
  return { channel: "wecom", reqId: frame.headers?.req_id as string ?? "" };
}

// ---------------------------------------------------------------------------
// Reply: stream + template card combo
// ---------------------------------------------------------------------------

export async function sendStreamWithCard(params: {
  session: StreamReplySession;
  content: string;
  finish?: boolean;
  templateCard?: TemplateCardParams;
}): Promise<void> {
  const { session, content, finish = false, templateCard } = params;
  if (session.finished) return;
  const client = requireClient(session.accountId);
  await client.replyStreamWithCard(
    session.frame,
    session.streamId,
    content,
    finish,
    templateCard ? { templateCard: templateCard as Record<string, unknown> } : undefined,
  );
  if (finish) session.finished = true;
}

// ---------------------------------------------------------------------------
// Proactive send (no inbound frame required)
// ---------------------------------------------------------------------------

export async function sendProactiveMessage(params: {
  accountId: string;
  chatId: string;
  text: string;
}): Promise<WeComSendResult> {
  const { accountId, chatId, text } = params;
  const client = requireClient(accountId);
  await client.sendMessage(chatId, {
    msgtype: "markdown",
    markdown: { content: text },
  });
  return { channel: "wecom", reqId: `proactive_${Date.now()}` };
}

export async function sendProactiveCard(params: {
  accountId: string;
  chatId: string;
  templateCard: TemplateCardParams;
}): Promise<WeComSendResult> {
  const { accountId, chatId, templateCard } = params;
  const client = requireClient(accountId);
  await client.sendMessage(chatId, {
    msgtype: "template_card",
    template_card: templateCard as Record<string, unknown>,
  });
  return { channel: "wecom", reqId: `proactive_${Date.now()}` };
}

// ---------------------------------------------------------------------------
// Welcome message (on enter_chat event)
// ---------------------------------------------------------------------------

export async function sendWelcomeMessage(params: {
  accountId: string;
  frame: WeComFrame;
  text: string;
}): Promise<void> {
  const { accountId, frame, text } = params;
  const client = requireClient(accountId);
  await client.replyWelcome(frame, {
    msgtype: "markdown",
    markdown: { content: text },
  });
}
