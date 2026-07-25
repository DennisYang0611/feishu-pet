# 小绝 × 飞书 CLI 打通说明

宠物系统本体是 Vite 开发服务器，内置一条事件通道，飞书 bot（CLI 脚本）在干活的
关键节点 POST 一个状态，页面上的「小绝」就实时换动作。

## 启动

```bash
cd pet-system
npm run dev          # 默认 http://localhost:7100
```

## 事件协议

```
POST /api/event
Content-Type: application/json

{ "state": "working", "label": "正在生成周报", "source": "feishu-bot" }
```

| state      | 宠物动作              | 建议埋点           |
|------------|-----------------------|--------------------|
| thinking   | 歪头 + 问号泡泡       | 收到消息、理解意图 |
| working    | 抱笔记本敲代码 + 火花 | 调工具、写文档中   |
| success    | 起跳 + 星星撒花       | 任务完成           |
| error      | 抖动 + 蚊香眼         | 异常、需人工介入   |
| sleeping   | 闭眼 + Zzz            | 空闲超时           |
| idle       | 呼吸 + 偶尔眨眼       | 回到待机           |

- `label` 会显示在宠物头顶的气泡里（≤60 字）
- 前端通过 `GET /api/events`（SSE）实时接收；`GET /api/state` 可轮询兜底
- API 已开 CORS，飞书 CLI 和浏览器不同机时用 `PET_URL=http://<局域网IP>:7100`

## 在 bot 脚本里埋点

```js
import { execFile } from 'node:child_process'
const pet = (state, label) =>
  execFile('node', ['pet-hook.mjs', state, label], { cwd: __dirname }, () => {})

pet('thinking', '理解需求中…')
// …调飞书 OpenAPI 干活…
pet('working', '正在写入多维表格')
// …干完…
pet('success', '周报已生成')
```

Shell 版（任何语言都能用）：

```bash
curl -s -X POST http://localhost:7100/api/event \
  -H 'Content-Type: application/json' \
  -d '{"state":"working","label":"正在生成周报"}' || true
```

## 示例：一个最小 bot 主流程

```bash
node pet-hook.mjs thinking "收到 @小绝 的消息"
sleep 1
node pet-hook.mjs working "正在调用飞书 OpenAPI"
sleep 3
node pet-hook.mjs success "任务完成 ✅"
```

## 双向互动：飞书侧摸头 / 投喂

除了 bot 单向上报状态，飞书里的**人**也可以反过来逗宠物。

互动协议：

```
POST /api/interact
Content-Type: application/json

{ "kind": "pat",  "label": "来自飞书 · 黑哥" }   # pat=摸头冒爱心
{ "kind": "feed", "label": "来自飞书 · 黑哥" }   # feed=投喂食物
```

hook 脚本直接支持：

```bash
node pet-hook.mjs pat  "来自飞书 · 黑哥"
node pet-hook.mjs feed "来自飞书 · 黑哥"
```

### 完整飞书侧玩法（pet-bot.example.mjs）

`pet-bot.example.mjs` 是一个可直接套用的互动 bot，用飞书官方 SDK 的
**长连接模式**（WebSocket），不需要公网回调地址，bot 跑在本机即可：

1. 飞书开放平台建企业自建应用 → 启用机器人
2. 权限：`im:message`、`im:message:send_as_bot`
3. 事件订阅选「长连接」→ 订阅 `im.message.receive_v1` 和 `card.action.trigger`
4. 运行：

```bash
npm i @larksuiteoapi/node-sdk
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx node pet-bot.example.mjs
```

群里就能这样玩：

| 飞书里的动作          | 宠物反应           |
|-----------------------|--------------------|
| @bot 发「摸摸头」     | 冒爱心 + 眯眯眼笑  |
| @bot 发「投喂」       | 天上掉像素食物     |
| @bot 发「状态」       | bot 回一张带「摸摸头 / 投喂」按钮的卡片 |
| 点卡片上的按钮        | 对应互动 + 按钮 toast 反馈 |

## 路线图（demo 之后）

- [x] 飞书事件订阅直连（消息 + 卡片按钮 → 摸头/投喂回传）
- [ ] 多宠物风格切换（沿用海报六个主题色各出一套皮肤）
- [ ] 常驻桌面浮窗（Electron / Tauri 透明窗口）
- [ ] 状态持久化（重开页面恢复最后一次状态）
- [ ] 互动回执：宠物被摸后 bot 在群里发一句撒娇文案
