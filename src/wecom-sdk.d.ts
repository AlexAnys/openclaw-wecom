/**
 * Type declarations for @wecom/aibot-node-sdk.
 *
 * The official SDK (v1.0.2) ships JS + a .d.ts entrypoint, but some
 * environments fail to resolve it. This ambient module declaration
 * ensures TypeScript always resolves the types.
 *
 * Source: https://github.com/WecomTeam/aibot-node-sdk
 */

declare module "@wecom/aibot-node-sdk" {
  import { EventEmitter } from "eventemitter3";

  // --- Enums ---
  export enum MessageType {
    Text = "text",
    Image = "image",
    Mixed = "mixed",
    Voice = "voice",
    File = "file",
  }

  export enum EventType {
    EnterChat = "enter_chat",
    TemplateCardEvent = "template_card_event",
    FeedbackEvent = "feedback_event",
  }

  export enum TemplateCardType {
    TextNotice = "text_notice",
    NewsNotice = "news_notice",
    ButtonInteraction = "button_interaction",
    VoteInteraction = "vote_interaction",
    MultipleInteraction = "multiple_interaction",
  }

  // --- Frames ---
  export interface WsFrame {
    cmd?: string;
    headers?: { req_id?: string; [key: string]: unknown };
    body?: Record<string, unknown>;
    errcode?: number;
    errmsg?: string;
  }

  // --- WSClient ---
  export interface WSClientOptions {
    botId: string;
    secret: string;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
    heartbeatInterval?: number;
    requestTimeout?: number;
    wsUrl?: string;
    logger?: {
      debug: (msg: string, ...args: unknown[]) => void;
      info: (msg: string, ...args: unknown[]) => void;
      warn: (msg: string, ...args: unknown[]) => void;
      error: (msg: string, ...args: unknown[]) => void;
    };
  }

  export class WSClient extends EventEmitter {
    constructor(options: WSClientOptions);
    connect(): this;
    disconnect(): void;
    reply(frame: WsFrame, body: Record<string, unknown>, cmd?: string): Promise<WsFrame>;
    replyStream(
      frame: WsFrame,
      streamId: string,
      content: string,
      finish?: boolean,
      msgItem?: unknown[],
      feedback?: Record<string, unknown>,
    ): Promise<WsFrame>;
    replyWelcome(frame: WsFrame, body: Record<string, unknown>): Promise<WsFrame>;
    replyTemplateCard(
      frame: WsFrame,
      templateCard: Record<string, unknown>,
      feedback?: Record<string, unknown>,
    ): Promise<WsFrame>;
    replyStreamWithCard(
      frame: WsFrame,
      streamId: string,
      content: string,
      finish?: boolean,
      options?: {
        msgItem?: unknown[];
        streamFeedback?: Record<string, unknown>;
        templateCard?: Record<string, unknown>;
        cardFeedback?: Record<string, unknown>;
      },
    ): Promise<WsFrame>;
    updateTemplateCard(
      frame: WsFrame,
      templateCard: Record<string, unknown>,
      userids?: string[],
    ): Promise<WsFrame>;
    sendMessage(chatid: string, body: Record<string, unknown>): Promise<WsFrame>;
    downloadFile(
      url: string,
      aesKey?: string,
    ): Promise<{ buffer: Buffer; filename?: string }>;
  }
}
