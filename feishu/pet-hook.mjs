#!/usr/bin/env node
/**
 * 飞书 bot 干活动作上报器 —— 让「小绝」跟着 bot 换动作。
 *
 * 用法：
 *   node pet-hook.mjs <state> [label]
 *   node pet-hook.mjs working "正在生成周报"
 *
 * state ∈ idle | thinking | working | success | error | sleeping
 *
 * 环境变量：
 *   PET_URL   宠物系统地址，默认 http://localhost:7100
 *   PET_SOURCE 上报来源标记，默认 feishu-bot
 *
 * 在飞书 CLI / bot 脚本里的典型埋点：
 *   收到消息   → thinking  "理解需求中…"
 *   调工具执行 → working   "正在写入多维表格"
 *   任务完成   → success   "周报已生成"
 *   异常捕获   → error     "API 超时，需要人工介入"
 *   空闲超时   → sleeping
 */

const PET_URL = (process.env.PET_URL || 'http://localhost:7100').replace(/\/$/, '')
const SOURCE = process.env.PET_SOURCE || 'feishu-bot'

const VALID = ['idle', 'thinking', 'working', 'success', 'error', 'sleeping']
const INTERACTS = ['pat', 'feed']

const [action, ...rest] = process.argv.slice(2)
const label = rest.join(' ')

if (INTERACTS.includes(action)) {
  // 互动指令：node pet-hook.mjs pat [来自飞书的@某某]
  try {
    const res = await fetch(`${PET_URL}/api/interact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: action, label, source: SOURCE }),
      signal: AbortSignal.timeout(3000),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error)
    console.log(`🐾 小绝收到互动 → [${action}] ${label || ''}`)
  } catch (err) {
    console.warn(`🐾 宠物系统不在线（${PET_URL}），跳过互动: ${err.message}`)
  }
  process.exit(0)
}

if (!VALID.includes(action)) {
  console.error(`state 必须是: ${VALID.join(' | ')}，互动指令: ${INTERACTS.join(' | ')}`)
  console.error(`示例: node pet-hook.mjs working "正在生成周报"`)
  console.error(`      node pet-hook.mjs pat "来自飞书 · 黑哥"`)
  process.exit(1)
}

try {
  const res = await fetch(`${PET_URL}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: action, label, source: SOURCE }),
    signal: AbortSignal.timeout(3000),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error)
  console.log(`🐾 小绝已切换 → [${action}] ${label || ''}`)
} catch (err) {
  // 宠物系统没开不阻塞 bot 主流程
  console.warn(`🐾 宠物系统不在线（${PET_URL}），跳过上报: ${err.message}`)
  process.exit(0)
}
