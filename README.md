# @openclaw/wecom

OpenClaw 企业微信渠道插件 — 零公网 IP，两分钟上线。

## 两种模式

| 模式 | 谁能用 | 需要什么 | 连接方式 |
|------|--------|---------|---------|
| **WeCom AI Bot** | 企业微信用户 | Bot ID + Secret | WebSocket 出站 (无需公网 IP) |
| **WeChat KF** | 个人微信用户 | Corp ID + Secret + KF ID | HTTP API 轮询 |

## 快速开始

### 1. 创建机器人 (2 分钟)

1. [企业微信管理后台](https://work.weixin.qq.com) → 应用管理 → 创建 **智能机器人**
2. 复制 **Bot ID** 和 **Secret**

### 2. 安装 & 配置

```bash
openclaw plugins install @openclaw/wecom
```

```bash
# 存储密钥 (自动写入 .env，不会进版本控制)
echo "WECOM_BOT_SECRET=你的Secret" >> .env
```

在 `openclaw.json` 中添加：

```json
{
  "channels": {
    "wecom": {
      "botId": "你的BotID",
      "botSecret": { "env": "WECOM_BOT_SECRET" }
    }
  }
}
```

### 3. 启动

```bash
openclaw gateway restart
```

在企业微信找到你的机器人，发消息测试。

---

### 开启微信客服 (可选，让个人微信用户也能用)

额外需要 3 个值：

| 值 | 在哪找 |
|----|--------|
| Corp ID | 管理后台 → 我的企业 → 企业ID |
| Corp Secret | 创建应用 → Secret (需「微信客服」权限) |
| KF Account ID | 微信客服 → 客服账号 → open_kfid |

```json
{
  "channels": {
    "wecom": {
      "botId": "...",
      "botSecret": { "env": "WECOM_BOT_SECRET" },
      "wechatKf": {
        "enabled": true,
        "corpId": "你的企业ID",
        "corpSecret": { "env": "WECOM_KF_SECRET" },
        "kfAccountId": "你的KF账号ID"
      }
    }
  }
}
```

启动后日志会输出客服链接，分享给微信用户或生成二维码。

## 它做了什么

```
你的电脑 ──WebSocket出站──▶ wss://openws.work.weixin.qq.com ──▶ 企业微信用户
                                                                    ↑ 无需公网IP
个人微信 ──微信客服会话──▶ qyapi.weixin.qq.com ──HTTP轮询──▶ 你的电脑
```

- 基于官方 [`@wecom/aibot-node-sdk`](https://github.com/WecomTeam/aibot-node-sdk) (MIT)
- 支持文本/图片/语音/文件/图文混排
- 原生流式回复 (Markdown 逐字显示)
- 模板卡片 (5 种类型)
- 加密文件自动 AES-256-CBC 解密
- 断线自动重连 (指数退避，无限重试)
- 消息去重 (防止重连后重复处理)
- 多账号支持

## 配置参考

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `botId` | — | **必填** Bot ID |
| `botSecret` | — | **必填** Bot Secret (建议用 `{ "env": "..." }`) |
| `aesKey` | — | 文件解密密钥 (收图片/文件时需要) |
| `connectionMode` | `"websocket"` | 连接模式 |
| `dmPolicy` | `"pairing"` | 私聊策略: open / pairing / allowlist |
| `groupPolicy` | `"allowlist"` | 群聊策略: open / allowlist / disabled |
| `requireMention` | `true` | 群聊是否需要 @机器人 |
| `wechatKf.enabled` | `false` | 启用微信客服 |
| `wechatKf.corpId` | — | 企业 Corp ID |
| `wechatKf.corpSecret` | — | 客服 Scope 的 Secret |
| `wechatKf.kfAccountId` | — | 客服账号 ID |

## 相关项目

- [WecomTeam/aibot-node-sdk](https://github.com/WecomTeam/aibot-node-sdk) — 官方 SDK (本插件基础)
- [BytePioneer-AI/openclaw-china](https://github.com/BytePioneer-AI/openclaw-china) — 社区多平台套件 (HTTP 回调模式)
- [sunnoy/openclaw-plugin-wecom](https://github.com/sunnoy/openclaw-plugin-wecom) — 高级群聊管理
- [StyXxxxxxx/openclaw-wecom-aibot](https://github.com/StyXxxxxxx/openclaw-wecom-aibot) — 另一个 WebSocket 实现

## 给 AI Agent 看的

如果你是 AI Agent 正在实现 WeCom 集成，请先阅读 [`AGENTS.md`](./AGENTS.md)。

## License

MIT
