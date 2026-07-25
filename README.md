# 小绝 · 飞书干活宠物

![小绝桌面实拍](public/screenshots/desktop-intro.png)

卡通贴纸风桌面宠物（画风：飞书绝活大会点位海报），飞书 bot 干活时实时换动作，
支持双向互动（摸头 / 投喂）、多皮肤换装、幼年/成年双形态。两种形态共用同一套事件协议。

## 皮肤与形态

- 5 套皮肤：**小绝·像素猫**（默认）、**财神到**（Q 版财神）、**小绿芽**（绿植小花）、
  **彩虹独角兽**、**飞飞·小飞机**（飞书配色），均为细腻卡通贴纸风（白描边 + 硬阴影）
- 每套皮肤有**幼年 / 成年**两种形态，随时切换
- 切换入口：桌面端右键 / 托盘菜单「皮肤」「形态」子菜单；看板底部按钮
- 选择本地持久化，重启保持；形象文件在 `public/skins/{caishen,plant,unicorn,plane}-{baby,adult}.png`

## 形态一：桌面宠物（QQ宠物形态，独立本地产品）

```bash
npm run pet        # 构建并启动；日常用 npm run pet:run
```

- 透明无边框窗口，置顶悬浮在桌面右下角，不占 Dock / 任务栏
- **按住拖动**移动位置，**单击**= 摸头冒爱心，**右键** = 菜单
- **像素级点击穿透**：透明区域点击直达桌面，只有点在宠物本体上才响应
- 菜单含「✨ 小绝的自我介绍」（诞生于 2026.7.25 飞书绝活大会北京场）
- 体型三档：小（默认 160×200，不碍事）/ 中 / 大，右键或托盘菜单切换
- 系统托盘常驻（像素猫图标），托盘菜单：自我介绍 / 摸头 / 投喂 / 绝活 / 🌈 皮肤 / 形态 / 体型 / 置顶 / 鼠标穿透 / 退出
- 鼠标穿透开了之后窗口不吃任何点击：按 **⌘⌥P**（全局快捷键）或托盘菜单取消勾选恢复
- 内嵌事件服务器（`desktop/server.cjs`，默认 :7100），**不依赖浏览器和 Vite**
- 10 分钟无事件自动进入 sleeping（摸鱼），来活自动醒
- 调试看板同时挂在 `http://localhost:7100/`（静态服务，非 Vite）

## 组委会群监工（群感知 + 汇报 + 收件箱提醒）

```bash
cp feishu/.env.local.example feishu/.env.local   # 改成你的群 chat_id 和 open_id
npm run pet:watch                                # 正式：汇报会发回飞书
PET_REPORT_DRYRUN=1 npm run pet:watch            # 联调：只在看板展示
```

依赖本机已登录的 [lark-cli](https://github.com/larksuite/cli)（`im` 权限）。
两个必配项获取方式：`lark-cli im +chat-list --as user` 找 `chat_id`，
`lark-cli contact +me --as user` 找 `open_id`。

- 15 秒轮询「北京飞书 AI 绝活大会民间组委会」，六类事件宠物各有动作：
  普通聊天 / @黑哥 / @所有人 / 图片文件 / 庆祝（撒花）/ 刷屏
- **收件箱提醒**：扫描最近活跃的 6 个会话（私聊 + 群），来新消息宠物歪头冒
  「📩 私聊/「群名」XX: …」气泡；自己发的和群里的机器人消息不提醒
  （`PET_INBOX=0` 关闭，`PET_INBOX_CHATS` 调扫描数量）
- **气泡点击跳转**：消息气泡带 ↗ 角标，点一下直接用 applink 打开飞书对应会话
- 群指令：发「摸摸」「投喂」直接逗宠物；发「宠物总结」触发 LLM 汇报
- **小绝的绝活**（点击宠物菜单触发，watcher 在线时执行）：
  「整理今日待办事项」/「过去 6 / 12 / 24 小时消息总结」——
  按时间窗捞组委会群 + 收件箱会话，LLM 生成待办清单或摘要，
  结果上看板汇报卡片并私聊黑哥（DRYRUN 只上看板）
- 汇报：LLM 真总结，发回群里，bot 未进群自动降级私聊黑哥；每天 18:00 自动日报
- 看板展示紫色汇报卡片；`PET_CHAT_ID` 可换群监听

## 大模型设置（汇报大脑）

看板右侧「大模型设置」卡片可切换小绝的 LLM 后端，保存在
`~/.xiaojue-pet/llm.json`，监工每次总结实时读取、无需重启：

- **自定义 API**：任意 OpenAI 兼容接口（baseUrl + apiKey + model）
- **Codex CLI**：`codex exec` 非交互模式，用本机已登录账号
- **Claude Code CLI**：`claude -p` 打印模式，用本机已登录账号

未配置时向后兼容黑哥本机的 `~/.heige-image/config.json`；`PET_LLM_MODEL` 可临时覆盖模型名。

## 形态二：网页调试看板（开发用）

```bash
npm run dev        # Vite 开发服务器，:7100
```

含状态模拟按钮、事件日志、海报画风走马灯。

## 飞书 CLI 外挂（两种形态通用）

```bash
node feishu/pet-hook.mjs working "正在生成周报"   # 状态上报（六档）
node feishu/pet-hook.mjs pat "来自飞书 · 黑哥"    # 互动：摸头
node feishu/pet-hook.mjs feed                     # 互动：投喂
```

完整协议、飞书 bot 长连接示例（`feishu/pet-bot.example.mjs`）见
[feishu/README.md](feishu/README.md)。

## 目录

```
desktop/    Electron 主进程 / 托盘 / 内嵌事件服务器
feishu/     飞书外挂：hook 脚本 + 互动 bot 示例 + 打通文档
src/pet/    像素 sprite 与动画舞台（网页看板与桌面窗口共用）
pet.html    桌面宠物窗口页（透明底）
index.html  网页调试看板
```

## 后续

- [ ] electron-builder 打包成 .app / .dmg（免 Node 环境分发）
- [x] 多皮肤与换装（5 皮肤 × 幼年/成年双形态）
- [ ] 桌面上随机游走 / 卖萌待机动作
- [ ] 互动回执：被摸后 bot 在飞书群里回一句撒娇文案
