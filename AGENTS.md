# Agent Implementation Guide

> This document is written for AI coding agents (Claude, Codex, etc.) that need
> to integrate WeCom / WeChat KF into an OpenClaw installation. Read this file
> FIRST before touching any code.

## What This Plugin Does

This plugin adds two channels to OpenClaw:

1. **WeCom AI Bot** — enterprise users chat with AI via 企业微信 (WebSocket, zero public IP)
2. **WeChat KF** — personal WeChat users chat with AI via 微信客服 (HTTP polling, QR code bind)

## Minimum Viable Setup (for the agent to automate)

### WeCom AI Bot (3 values needed from the user)

```
Bot ID      → created in WeCom admin → 应用管理 → 智能机器人
Bot Secret  → same page, "Secret" field
AES Key     → same page, optional, for file decryption
```

**Agent task: given these 3 values, produce a working `openclaw.json` config:**

```jsonc
{
  "channels": {
    "wecom": {
      "enabled": true,
      "botId": "<BOT_ID>",
      "botSecret": { "env": "WECOM_BOT_SECRET" },
      // aesKey is only needed if you want to receive image/file/voice
      "aesKey": { "env": "WECOM_AES_KEY" }
    }
  }
}
```

**Agent task: store secrets safely:**
```bash
# Write to .env (gitignored)
echo "WECOM_BOT_SECRET=<value>" >> .env
echo "WECOM_AES_KEY=<value>" >> .env
```

**That's it.** No public IP, no webhook URL, no DNS, no nginx. The plugin
connects outbound via WebSocket.

### WeChat KF (3 additional values)

```
Corp ID         → WeCom admin 首页 → 我的企业 → 企业 ID
Corp Secret     → WeCom admin → 应用管理 → 创建/选择应用 → Secret (需要「微信客服」权限)
KF Account ID   → WeCom admin → 微信客服 → 客服账号 → open_kfid
```

```jsonc
{
  "channels": {
    "wecom": {
      "enabled": true,
      "botId": "<BOT_ID>",
      "botSecret": { "env": "WECOM_BOT_SECRET" },
      "wechatKf": {
        "enabled": true,
        "corpId": "<CORP_ID>",
        "corpSecret": { "env": "WECOM_KF_SECRET" },
        "kfAccountId": "<KF_ACCOUNT_ID>"
      }
    }
  }
}
```

## Architecture for Agents

```
src/
├── gateway.ts        ← START HERE: WebSocket lifecycle, message dispatch
├── wechat-kf.ts      ← KF API: token, sync_msg, send_msg, polling
├── kf-gateway.ts     ← KF polling loop → dispatchMessage
├── bot.ts            ← Frame parsing: WeCom JSON → WeComMessageContext
├── send.ts           ← Outbound: reply, stream, template card, proactive
├── streaming.ts      ← Streaming session: throttle, merge, finish
├── media.ts          ← File download + AES-256-CBC decrypt
├── dedup.ts          ← Message deduplication (TTL cache)
├── channel.ts        ← ChannelPlugin interface (capabilities, config, gateway)
├── accounts.ts       ← Multi-account resolution
├── config-schema.ts  ← Zod validation
├── runtime.ts        ← Plugin runtime store
├── types.ts          ← All type definitions
└── wecom-sdk.d.ts    ← Ambient types for @wecom/aibot-node-sdk
```

### Data Flow

```
[Inbound]
WeCom Cloud → WSClient (gateway.ts)
  → parseMessageFrame (bot.ts)
  → dedup check (dedup.ts)
  → policy check (gateway.ts)
  → runtime.dispatchMessage → OpenClaw AI

[Outbound]
OpenClaw AI → outbound adapter (channel.ts)
  → sendProactiveMessage / sendTextReply (send.ts)
  → WSClient → WeCom Cloud → User

[Streaming]
OpenClaw AI → WeComStreamingSession (streaming.ts)
  → sendStreamChunk (send.ts, throttled 100ms)
  → WSClient → WeCom Cloud → User sees Markdown streaming

[WeChat KF]
Personal WeChat → KF Cloud → syncKfMessages (wechat-kf.ts, 5s poll)
  → kf-gateway.ts → runtime.dispatchMessage → OpenClaw AI
  → sendKfMessage (wechat-kf.ts) → KF Cloud → Personal WeChat
```

### Key SDK Facts

- Package: `@wecom/aibot-node-sdk` v1.0.2 (MIT, npm)
- WebSocket endpoint: `wss://openws.work.weixin.qq.com`
- Auth: `aibot_subscribe` frame with `{ bot_id, secret }`
- Heartbeat: ping every 30s, 2 missed pongs = reconnect
- Reconnect: exponential backoff 1s→2s→4s→...→30s cap
- Reply queue: per-req_id serial, 5s ACK timeout
- Stream: `replyStream(frame, streamId, markdownContent, finish)`
- Files: AES-256-CBC, 32-byte PKCS#7 padding, IV = first 16 bytes of key

### OpenClaw Integration Points

This plugin implements the **ChannelPlugin** interface. The key integration
points that OpenClaw core calls are:

| Method | Purpose |
|--------|---------|
| `gateway.startAccount(ctx)` | Called by gateway to start WebSocket |
| `outbound.sendText(params)` | Called to deliver AI response to user |
| `outbound.sendMedia(params)` | Called to send media to user |
| `config.resolveAccount(cfg, id)` | Resolve account credentials |
| `status.probeAccount(params)` | Health check |
| `pairing.notifyApproval(params)` | Notify user of access approval |

## Community Reference Implementations

Before modifying this plugin, check these existing implementations:

| Project | Stars | Approach | Key Differentiator |
|---------|-------|----------|--------------------|
| [BytePioneer-AI/openclaw-china](https://github.com/BytePioneer-AI/openclaw-china) | 3,259 | HTTP callback | Multi-platform (DingTalk, QQ, WeCom), 3 WeCom modes |
| [sunnoy/openclaw-plugin-wecom](https://github.com/sunnoy/openclaw-plugin-wecom) | 580 | HTTP callback | Dynamic agent mgmt, group chat, command whitelists |
| [StyXxxxxxx/openclaw-wecom-aibot](https://github.com/StyXxxxxxx/openclaw-wecom-aibot) | 3 | WebSocket | Closest to this plugin, uses same SDK |
| [WecomTeam/aibot-node-sdk](https://github.com/WecomTeam/aibot-node-sdk) | 30 | — | Official SDK (MIT), this plugin's foundation |

## Known Limitations (for agents to track)

1. **No document/wiki tools** — unlike feishu plugin, no WeCom doc integration yet
2. **No directory listing** — cannot list WeCom users/groups
3. **No @-mention parsing** — WeCom AI Bot only receives messages where bot is mentioned; all inbound messages are treated as addressed to the bot
4. **KF polling latency** — up to 5s delay for KF messages (vs. instant for AI Bot WebSocket)
5. **Template card interaction** — sending cards works, but receiving button click events is not yet routed to OpenClaw sessions

## Testing Checklist (for agents)

```
[ ] Bot connects and authenticates (check logs for "Authenticated successfully")
[ ] DM message received and dispatched to OpenClaw
[ ] AI response sent back via stream (check for Markdown rendering)
[ ] Duplicate message rejected after reconnect
[ ] Group message respects groupPolicy: "disabled"
[ ] KF contact link generated (if wechatKf.enabled)
[ ] KF message from personal WeChat dispatched
[ ] KF reply sent back to personal WeChat user
[ ] Process restart resumes KF cursor (no duplicate messages)
[ ] Gateway shuts down cleanly on abort signal
```
