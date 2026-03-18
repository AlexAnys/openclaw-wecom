# @openclaw/wecom

OpenClaw 企业微信 (WeCom) 渠道插件 — WebSocket AI Bot + 微信客服集成。

**零公网 IP、零运维。** 和飞书插件一样，使用 WebSocket 长连接，在家里的电脑上就能跑。

## 两种集成模式

### Plan A: 企业微信 AI Bot (核心)

通过 `@wecom/aibot-node-sdk` 建立 WebSocket 长连接：

```
你的电脑 (OpenClaw) ──WebSocket出站──▶ wss://openws.work.weixin.qq.com ──▶ 企业微信
```

- 无需公网 IP（WebSocket 出站连接）
- 支持文本、图片、语音、文件、图文混排消息
- 原生流式回复（Markdown 逐字显示）
- 模板卡片交互（按钮、投票、多选）
- 断线自动重连（指数退避）
- 加密文件 AES-256-CBC 自动解密

### Plan B: 微信客服 (WeChat KF)

让个人微信用户无需安装企业微信，扫码即可对话：

```
个人微信用户 ──扫码绑定──▶ 微信客服会话 ──API──▶ OpenClaw AI
```

- QR 码绑定，零门槛
- 普通微信用户直接使用
- 通过企业微信「微信客服」API 桥接

## 快速开始

### 1. 创建企业微信 AI Bot

1. 登录 [企业微信管理后台](https://work.weixin.qq.com)
2. 应用管理 → 创建"智能机器人"（AI Bot 类型）
3. 记录 **Bot ID** 和 **Bot Secret**

### 2. 安装插件

```bash
openclaw plugins install @openclaw/wecom
```

### 3. 配置

在 `openclaw.json` 中添加：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "botId": "<你的 Bot ID>",
      "botSecret": { "env": "WECOM_BOT_SECRET" }
    }
  }
}
```

将 Bot Secret 存入环境变量：

```bash
echo "WECOM_BOT_SECRET=<你的 Secret>" >> ~/.env
```

### 4. 启动

```bash
openclaw gateway restart
```

在企业微信中找到你的机器人，发一条消息测试。

## 微信客服配置（可选）

要让个人微信用户也能使用，在配置中启用 WeChat KF：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "botId": "<Bot ID>",
      "botSecret": { "env": "WECOM_BOT_SECRET" },
      "wechatKf": {
        "enabled": true,
        "corpId": "<Corp ID>",
        "corpSecret": { "env": "WECOM_KF_SECRET" },
        "kfAccountId": "<KF Account ID>"
      }
    }
  }
}
```

启动后会生成绑定二维码，微信扫码即可开始对话。

## 配置参考

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 启用/禁用 |
| `botId` | string | — | Bot ID（必填） |
| `botSecret` | string \| { env } | — | Bot Secret（必填） |
| `aesKey` | string \| { env } | — | AES 密钥（文件解密用） |
| `connectionMode` | `"websocket"` \| `"webhook"` | `"websocket"` | 连接模式 |
| `wsUrl` | string | — | 自定义 WebSocket URL（测试用） |
| `dmPolicy` | `"open"` \| `"pairing"` \| `"allowlist"` | `"pairing"` | 私聊策略 |
| `groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | `"allowlist"` | 群聊策略 |
| `requireMention` | boolean | `true` | 群聊中是否需要 @机器人 |
| `wechatKf.enabled` | boolean | `false` | 启用微信客服 |
| `wechatKf.corpId` | string | — | 企业 Corp ID |
| `wechatKf.corpSecret` | string \| { env } | — | 客服 Scope 的 Secret |
| `wechatKf.kfAccountId` | string | — | 客服账号 ID |

## 多账号支持

```json
{
  "channels": {
    "wecom": {
      "defaultAccount": "production",
      "accounts": {
        "production": {
          "enabled": true,
          "botId": "<Prod Bot ID>",
          "botSecret": { "env": "WECOM_PROD_SECRET" }
        },
        "staging": {
          "enabled": true,
          "botId": "<Staging Bot ID>",
          "botSecret": { "env": "WECOM_STAGING_SECRET" }
        }
      }
    }
  }
}
```

## 支持的消息类型

| 方向 | 类型 | 支持 |
|------|------|------|
| 接收 | 文本 | ✅ |
| 接收 | 图片 | ✅ (AES 解密) |
| 接收 | 语音 | ✅ (AES 解密) |
| 接收 | 文件 | ✅ (AES 解密) |
| 接收 | 图文混排 | ✅ |
| 发送 | Markdown 文本 | ✅ |
| 发送 | 流式 Markdown | ✅ (逐字显示) |
| 发送 | 模板卡片 | ✅ (5 种类型) |
| 发送 | 流式 + 卡片 | ✅ |
| 发送 | 主动推送 | ✅ |
| 发送 | 欢迎语 | ✅ |

## 与飞书插件的对比

| 特性 | @openclaw/feishu | @openclaw/wecom |
|------|-----------------|-----------------|
| 连接方式 | WebSocket 长连接 | WebSocket 长连接 |
| 需要公网 IP | ❌ | ❌ |
| 流式回复 | Card streaming API | 原生 stream 协议 |
| 模板卡片 | ✅ | ✅ (5 种) |
| 文件加密 | ❌ | ✅ AES-256-CBC |
| 微信客服 | ❌ | ✅ QR 码绑定 |
| 个人微信用户 | ❌ | ✅ 通过客服 |
| 文档/Wiki 工具 | ✅ | 🚧 待实现 |
| Emoji 表情 | ✅ | ❌ |

## 架构

```
┌─────────────────────────────────────────────┐
│                  OpenClaw                    │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │        @openclaw/wecom plugin        │   │
│  │                                      │   │
│  │  ┌──────────┐    ┌───────────────┐   │   │
│  │  │ AI Bot   │    │  WeChat KF    │   │   │
│  │  │ Gateway  │    │  Gateway      │   │   │
│  │  │          │    │               │   │   │
│  │  │ WSClient │    │ HTTP Polling  │   │   │
│  │  └────┬─────┘    └───────┬───────┘   │   │
│  └───────┼──────────────────┼───────────┘   │
│          │                  │               │
└──────────┼──────────────────┼───────────────┘
           │                  │
    WebSocket 出站      HTTPS API
           │                  │
           ▼                  ▼
   ┌───────────────┐  ┌──────────────┐
   │ 企业微信       │  │ 微信客服 API  │
   │ AI Bot 云端    │  │              │
   │               │  │ ┌──────────┐ │
   │ ┌───────────┐ │  │ │个人微信   │ │
   │ │企业微信用户│ │  │ │用户      │ │
   │ └───────────┘ │  │ └──────────┘ │
   └───────────────┘  └──────────────┘
```

## License

MIT
