/**
 * 飞书 bot 互动示例 —— 群里 @bot 发指令，宠物实时响应。
 *
 * 支持指令：
 *   摸摸头 / 摸头        → 宠物冒爱心
 *   投喂 / 小鱼干        → 天上掉小鱼干
 *   状态                 → bot 回一张当前宠物状态卡片（含摸头/投喂按钮）
 *   其他消息             → 走你原有的 bot 逻辑（记得用 pet-hook 上报状态）
 *
 * 准备（飞书开放平台 https://open.feishu.cn）：
 *   1. 建企业自建应用 → 启用机器人能力
 *   2. 权限：im:message、im:message:send_as_bot、im:chat:readonly
 *   3. 事件订阅 → 用「长连接」模式 → 订阅 im.message.receive_v1
 *      和 card.action.trigger（卡片按钮回调）
 *   4. 发布版本，把 bot 拉进群
 *
 * 运行：
 *   npm i @larksuiteoapi/node-sdk
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx node pet-bot.example.mjs
 */
import * as lark from '@larksuiteoapi/node-sdk'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))

/** 调宠物系统，失败静默 */
function pet(action, label = '') {
  execFile('node', [join(DIR, 'pet-hook.mjs'), action, label], () => {})
}

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
})

/** 状态查询卡片：带摸头/投喂两个按钮 */
function petCard(stateLabel) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '🐾 小绝' },
      template: 'green',
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: `当前状态：**${stateLabel}**` },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '摸摸头' },
            type: 'primary',
            value: { pet: 'pat' }, // ← 按钮回调里能拿到
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '投喂食物' },
            type: 'default',
            value: { pet: 'feed' },
          },
        ],
      },
    ],
  }
}

async function replyCard(messageId, card) {
  await client.im.message.reply({
    path: { message_id: messageId },
    data: { msg_type: 'interactive', content: JSON.stringify(card) },
  })
}

const eventDispatcher = new lark.EventDispatcher({}).register({
  // —— 收到消息 ——
  'im.message.receive_v1': async (data) => {
    const { message, sender } = data
    if (message.message_type !== 'text') return
    const text = JSON.parse(message.content).text.trim()
    const name = sender?.sender_id?.open_id ? '来自飞书' : '来自飞书'

    if (/摸.*头|pat/i.test(text)) {
      pet('pat', name)
      await replyCard(message.message_id, petCard('被摸头了，开心 ❤'))
    } else if (/投喂|食物|小鱼干|feed/i.test(text)) {
      pet('feed', name)
      await replyCard(message.message_id, petCard('真香，还想吃'))
    } else if (/状态|status/i.test(text)) {
      await replyCard(message.message_id, petCard('在线，随时能互动'))
    } else {
      // 这里接你原有的 bot 干活逻辑，关键节点记得上报：
      pet('thinking', '理解飞书消息中…')
      // ... 你的业务代码 ...
      // pet('working', '正在写多维表格')
      // pet('success', '任务完成')
    }
  },

  // —— 卡片按钮回调（点了「摸摸头」「投喂」） ——
  'card.action.trigger': async (data) => {
    const action = data?.action?.value?.pet
    if (action === 'pat' || action === 'feed') {
      pet(action, '飞书卡片按钮')
      return {
        toast: {
          type: 'success',
          content: action === 'pat' ? '小绝被摸头了 🐾' : '小绝吃到好吃的了 🍪',
        },
      }
    }
  },
})

// 长连接：不需要公网回调地址，bot 跑在你本机/服务器上即可
new lark.WSClient({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
}).start({ eventDispatcher })

console.log('🐾 飞书互动 bot 已启动（长连接模式）')
