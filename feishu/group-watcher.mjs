#!/usr/bin/env node
/**
 * 组委会群监工 · group-watcher
 *
 * 轮询「北京飞书 AI 绝活大会民间组委会」群消息，分类成事件喂给小绝：
 *
 *   群消息 ──lark-cli 15s 轮询──▶ 分类 ──▶ POST /api/event（宠物变脸+气泡播报）
 *      │ 普通聊天        → idle    「XX: …」
 *      │ @黑哥           → thinking「XX 在群里喊你」
 *      │ @所有人         → working 「全员广播：…」
 *      │ 图片/文件       → idle    「XX 发了张图」
 *      │ 庆祝关键词      → success 「群里在庆祝：…」（撒花）
 *      │ 一波刷屏 ≥5 条  → working 「群聊刷屏 xN」
 *      └ 群指令          → 摸摸/投喂 → /api/interact；宠物总结 → LLM 汇报
 *
 * 汇报：LLM 真总结（后端在 ~/.xiaojue-pet/llm.json 配置，看板「大模型设置」可视化修改），
 * 优先发回组委会群（bot 需在群内），失败降级私聊黑哥；
 * PET_REPORT_DRYRUN=1 时只推给宠物看板，不发飞书（联调用）。
 * 每天 18:00 自动发一份日报。
 *
 * 用法：node feishu/group-watcher.mjs
 * 环境变量：PET_CHAT_ID（必配，要监听的群 chat_id，oc_ 开头）
 *           PET_MY_OPEN_ID（必配，主人自己的 open_id，ou_ 开头，用于识别 @我 和自己发的消息）
 *           PET_URL（默认 http://localhost:7100） PET_LLM_MODEL（覆盖模型名）
 *           PET_REPORT_DRYRUN=1（不发飞书，只上看板，联调用）
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// 本地私有配置 feishu/.env.local（KEY=VALUE 每行一个，gitignore 不入库），环境变量优先
try {
  const envFile = join(dirname(fileURLToPath(import.meta.url)), '.env.local')
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  }
} catch { /* 没有就算了 */ }

const require = createRequire(import.meta.url)
const { llmChat, loadLlmConfig } = require('./llm-client.cjs')
const run = promisify(execFile)

const PET_URL = (process.env.PET_URL || 'http://localhost:7100').replace(/\/$/, '')
const CHAT_ID = process.env.PET_CHAT_ID || ''
const MY_OPEN_ID = process.env.PET_MY_OPEN_ID || ''
if (!CHAT_ID || !MY_OPEN_ID) {
  console.error('请先配置环境变量：PET_CHAT_ID（监听的群 chat_id）和 PET_MY_OPEN_ID（你的 open_id）。')
  console.error('获取方式：lark-cli im +chat-list --as user 找 chat_id；lark-cli contact +me --as user 找 open_id。')
  process.exit(1)
}
const POLL_SEC = 15
const DAILY_HOUR = 18
const DRYRUN = process.env.PET_REPORT_DRYRUN === '1'
const LARK = process.env.LARK_CLI || 'lark-cli'
const LARK_ENV = {
  ...process.env,
  LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
  LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
}

const CELEBRATE_WORDS = ['恭喜', '获奖', '中奖', '开奖', '颁奖', '🎉', '太强', '牛啊']
const REPORT_CMDS = ['宠物总结', '总结一下', '宠物汇报', '汇报一下']
const PAT_CMDS = ['摸摸', '摸头', 'rua']
const FEED_CMDS = ['投喂', '食物', '小鱼干', '喂食']

const seen = new Set()
const buffer = [] // {name,text,time}
let lastReportIdx = 0
let summarizing = false
const sentDays = new Set()
let decayTimer = null

// 收件箱扫描（私聊 + 所有群的新消息气泡提醒）
const INBOX = process.env.PET_INBOX !== '0' // 默认开
const INBOX_CHATS = Number(process.env.PET_INBOX_CHATS || 6)
const inboxSeen = new Map() // chat_id -> 最新 message_id
let inboxFirst = true

// ── 宠物 API ─────────────────────────────────────
async function post(path, body) {
  try {
    const res = await fetch(`${PET_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    })
    return await res.json()
  } catch (err) {
    console.warn(`[pet] ${path} 失败（宠物不在线？）: ${err.message}`)
    return null
  }
}

/** 推一个群事件给宠物；群消息 45 秒后自动回 idle，不抢 bot 的工作状态 */
async function pushGroupEvent(state, label, chatId) {
  await post('/api/event', { state, label, source: '组委会群', chatId })
  clearTimeout(decayTimer)
  decayTimer = setTimeout(
    () => post('/api/event', { state: 'idle', label: '群里暂时安静了', source: 'auto' }),
    45_000,
  )
}

// ── 事件分类 ─────────────────────────────────────
/** 消息清洗：链接换成 🔗、压缩空白、超长截断 */
function cleanText(t) {
  let s = (t || '')
    .replace(/https?:\/\/\S+/g, '🔗')
    .replace(/\[Image:.*?\]/g, '[图片]')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > 34 ? s.slice(0, 34) + '…' : s
}

function classify(m) {
  let text = (m.content || '').trim()
  const name = m.sender?.name || '群友'
  const type = m.msg_type || 'text'
  const mentions = m.mentions || []
  let ev = 'chat'
  if (mentions.some((x) => x.id === MY_OPEN_ID)) ev = 'mention_me'
  else if (mentions.some((x) => x.id === 'all' || ['所有人', 'all'].includes(x.name)))
    ev = 'mention_all'
  else if (type === 'image') { ev = 'media'; text = '[图片]' }
  else if (type === 'sticker') { ev = 'media'; text = '[表情包]' }
  else if (type === 'file') { ev = 'media'; text = '[文件]' }
  else if (type !== 'text') text = text || `[${type}]`
  if ((ev === 'chat' || ev === 'mention_all') && CELEBRATE_WORDS.some((k) => text.includes(k)))
    ev = 'celebrate'
  return { ev, name, text: cleanText(text), time: (m.create_time || '').slice(-5) }
}

const STATE_MAP = {
  chat: (e) => ['idle', `${e.name}: ${e.text}`],
  mention_me: (e) => ['thinking', `${e.name} 在群里 @ 了你：${e.text}`],
  mention_all: (e) => ['working', `全员广播 · ${e.name}: ${e.text}`],
  media: (e) => ['idle', `${e.name} 发了${e.text}`],
  celebrate: (e) => ['success', `群里在庆祝：${e.text}`],
}

// ── LLM 汇报（后端走 ~/.xiaojue-pet/llm.json，可在看板「大模型设置」里改）──
async function llmSummarize(lines) {
  const prompt =
    '你是一只养在桌面上的像素猫宠物，名字叫「小绝」，主人是黑哥。' +
    '下面是「北京飞书 AI 绝活大会民间组委会」群最近的聊天记录，请你以宠物第一人称做一份简短汇报。\n' +
    '要求：\n1. 第一行一句话说清群里当前大势\n2. 然后 3-5 条要点，每条一行，谁在张罗什么、有什么进展\n' +
    '3. 如果有需要黑哥留意或回复的事，单独一行用「⚠️ 记得看：」开头；没有就不写\n' +
    '4. 全文不超过 200 字，口语化，轻松一点，可带一两个 emoji，用简体中文\n\n聊天记录：\n' +
    lines.join('\n')
  return llmChat(prompt)
}

function fallbackSummary(msgs) {
  const by = {}
  let imgs = 0
  for (const m of msgs) {
    by[m.name] = (by[m.name] || 0) + 1
    if (['[图片]', '[表情包]', '[文件]'].includes(m.text)) imgs++
  }
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const who = top.map(([n, c]) => `${n}(${c}条)`).join('、')
  return `总结引擎打盹了，先报个数：这段时间群里 ${msgs.length} 条消息，最活跃的是 ${who}，图片和文件 ${imgs} 个。稍后再让我总结一次试试。`
}

async function sendFeishu(text) {
  if (DRYRUN) return 'dryrun'
  const md = `**🐾 小绝 · 组委会群汇报**\n\n${text}`
  for (const target of [['--chat-id', CHAT_ID], ['--user-id', MY_OPEN_ID]]) {
    try {
      const { stdout } = await run(
        LARK,
        ['im', '+messages-send', '--as', 'bot', ...target, '--markdown', md],
        { timeout: 40_000, env: LARK_ENV },
      )
      const data = JSON.parse(stdout)
      if (data.ok) return target[0] === '--chat-id' ? '群内' : '私聊'
    } catch (err) {
      console.warn('[report] 发送失败:', err.message)
    }
  }
  return null
}

async function summarize(trigger = '手动') {
  if (summarizing) return
  summarizing = true
  try {
    await post('/api/event', {
      state: 'working',
      label: `开始整理群汇报（${trigger}）…`,
      source: 'watcher',
    })
    let msgs = buffer.slice(lastReportIdx)
    if (msgs.length < 10) msgs = buffer.slice(-40)
    const snapshotIdx = buffer.length
    let full
    if (!msgs.length) {
      full = '群里还静悄悄的，没什么可汇报的，我先趴会儿 😺'
    } else {
      const lines = msgs.map((m) => `${m.time} ${m.name}: ${m.text}`)
      try {
        full = await llmSummarize(lines.slice(-150))
      } catch {
        full = fallbackSummary(msgs)
      }
    }
    lastReportIdx = snapshotIdx
    const where = await sendFeishu(full)
    const note = { 群内: '已发到群里', 私聊: '已私聊发你（bot 还没进群）', dryrun: '联调模式，未发飞书' }[where] || '飞书发送失败，只在看板展示'
    await post('/api/report', {
      text: `${full}\n\n—— ${note}`,
      trigger,
      source: 'watcher',
    })
    await post('/api/event', {
      state: 'success',
      label: `汇报完成 · ${note}`,
      source: 'watcher',
    })
  } finally {
    summarizing = false
  }
}

// ── 轮询 ─────────────────────────────────────────
async function fetchMessages() {
  const { stdout } = await run(
    LARK,
    ['im', '+chat-messages-list', '--as', 'user', '--chat-id', CHAT_ID,
     '--page-size', '20', '--order', 'desc', '--no-reactions'],
    { timeout: 40_000, env: LARK_ENV, maxBuffer: 4 * 1024 * 1024 },
  )
  const data = JSON.parse(stdout)
  if (!data.ok) throw new Error(data.error?.message || 'lark-cli error')
  return data.data.messages
}

async function pollOnce(first) {
  const msgs = await fetchMessages() // 最新在前
  const fresh = msgs.filter((m) => !seen.has(m.message_id) && !m.deleted)
  for (const m of msgs) seen.add(m.message_id)
  const events = fresh.reverse().map(classify) // 旧→新
  for (const e of events) buffer.push({ name: e.name, text: e.text, time: e.time })
  if (buffer.length > 300) {
    const overflow = buffer.length - 300
    buffer.splice(0, overflow)
    lastReportIdx = Math.max(0, lastReportIdx - overflow)
  }
  if (first) {
    lastReportIdx = buffer.length // 历史不进首次汇报
    console.log(`[poller] 初始化完成，缓存 ${seen.size} 条历史，缓冲 ${buffer.length} 条`)
    return
  }
  if (!events.length) return
  if (events.length >= 5) {
    await pushGroupEvent('working', `群聊刷屏 · 一波 ${events.length} 条新消息`, CHAT_ID)
  }
  for (const e of events) {
    const [state, label] = STATE_MAP[e.ev](e)
    await pushGroupEvent(state, label, CHAT_ID)
    console.log(`[event] ${e.ev} · ${label}`)
  }
  // 群指令（只看文本消息，每条只响应一个指令）
  for (const m of fresh) {
    if (m.msg_type !== 'text') continue
    const text = m.content || ''
    const who = m.sender?.name || '群友'
    if (REPORT_CMDS.some((w) => text.includes(w))) {
      summarize(`${who} 在群里点名`)
      break
    }
    if (PAT_CMDS.some((w) => text.includes(w))) {
      await post('/api/interact', { kind: 'pat', label: `${who} 在群里摸了你`, source: '组委会群' })
      console.log(`[cmd] ${who} 摸了小绝`)
      break
    }
    if (FEED_CMDS.some((w) => text.includes(w))) {
      await post('/api/interact', { kind: 'feed', label: `${who} 在群里投喂了你`, source: '组委会群' })
      console.log(`[cmd] ${who} 投喂了小绝`)
      break
    }
  }
}

// ── 收件箱扫描：私聊 + 最近活跃的群，新消息冒气泡 ──
async function scanInbox() {
  const { stdout } = await run(
    LARK,
    ['im', '+chat-list', '--as', 'user', '--types', 'p2p,group',
     '--sort', 'active_time', '--page-size', String(INBOX_CHATS + 1)],
    { timeout: 40_000, env: LARK_ENV, maxBuffer: 4 * 1024 * 1024 },
  )
  const data = JSON.parse(stdout)
  if (!data.ok) throw new Error(data.error?.message || 'lark-cli chat-list error')
  const chats = (data.data.chats || [])
    .filter((c) => c.chat_id !== CHAT_ID) // 组委会群由详细轮询负责
    .slice(0, INBOX_CHATS)

  for (const chat of chats) {
    try {
      const { stdout: out } = await run(
        LARK,
        ['im', '+chat-messages-list', '--as', 'user', '--chat-id', chat.chat_id,
         '--page-size', '1', '--order', 'desc', '--no-reactions'],
        { timeout: 40_000, env: LARK_ENV, maxBuffer: 4 * 1024 * 1024 },
      )
      const d = JSON.parse(out)
      const m = d.data?.messages?.[0]
      if (!d.ok || !m || m.deleted) continue
      const prev = inboxSeen.get(chat.chat_id)
      inboxSeen.set(chat.chat_id, m.message_id)
      // PET_INBOX_TEST=1：强制把最新消息当新消息，联调提醒链路用
      if (process.env.PET_INBOX_TEST !== '1') {
        if (inboxFirst || prev === m.message_id || prev === undefined) continue
      }
      // 自己发的不提醒；群里的机器人消息太吵也过滤（私聊的 app 通知保留）
      const senderId = m.sender?.id || m.sender?.open_id
      const isBot = ['bot', 'app'].includes(m.sender?.sender_type)
      if (senderId === MY_OPEN_ID) continue
      if (isBot && chat.chat_mode !== 'p2p') continue
      const c = classify(m)
      const where = chat.chat_mode === 'p2p' ? '私聊' : `「${chat.name}」`
      await pushGroupEvent('thinking', `📩 ${where} ${c.name}: ${c.text}`, chat.chat_id)
      console.log(`[inbox] ${where} ${c.name}: ${c.text}`)
    } catch (err) {
      console.warn(`[inbox] 会话 ${chat.name || chat.chat_id} 失败: ${err.message}`)
    }
  }
  inboxFirst = false
}

// ── 小绝的绝活：待办整理 + N 小时消息总结 ──
let cmdBusy = false

async function fetchMessagesSince(chatId, startIso, limit = 50) {
  const { stdout } = await run(
    LARK,
    ['im', '+chat-messages-list', '--as', 'user', '--chat-id', chatId,
     '--start', startIso, '--page-size', String(limit), '--order', 'desc', '--no-reactions'],
    { timeout: 40_000, env: LARK_ENV, maxBuffer: 8 * 1024 * 1024 },
  )
  const data = JSON.parse(stdout)
  if (!data.ok) throw new Error(data.error?.message || 'lark-cli error')
  return data.data.messages || []
}

/** 拉过去 N 小时内的消息（组委会群 + 最近活跃会话），汇总成行 */
async function collectLines(hours) {
  const startIso = new Date(Date.now() - hours * 3600_000).toISOString()
  const chatIds = [{ id: CHAT_ID, name: '组委会群' }]
  try {
    const { stdout } = await run(
      LARK,
      ['im', '+chat-list', '--as', 'user', '--types', 'p2p,group',
       '--sort', 'active_time', '--page-size', String(INBOX_CHATS + 1)],
      { timeout: 40_000, env: LARK_ENV, maxBuffer: 4 * 1024 * 1024 },
    )
    const data = JSON.parse(stdout)
    for (const c of (data.data?.chats || [])) {
      if (c.chat_id !== CHAT_ID && chatIds.length <= INBOX_CHATS) {
        chatIds.push({ id: c.chat_id, name: c.chat_mode === 'p2p' ? `私聊·${c.name}` : c.name })
      }
    }
  } catch (err) {
    console.warn('[job] chat-list 失败，只用组委会群:', err.message)
  }
  const lines = []
  for (const c of chatIds) {
    try {
      const msgs = await fetchMessagesSince(c.id, startIso)
      for (const m of msgs.reverse()) {
        if (m.deleted) continue
        const e = classify(m)
        lines.push(`${(m.create_time || '').slice(5)} [${c.name}] ${e.name}: ${e.text}`)
      }
    } catch (err) {
      console.warn(`[job] 拉取 ${c.name} 失败: ${err.message}`)
    }
  }
  return lines.slice(-300)
}

async function sendFeishuUser(md) {
  if (DRYRUN) return 'dryrun'
  try {
    const { stdout } = await run(
      LARK,
      ['im', '+messages-send', '--as', 'bot', '--user-id', MY_OPEN_ID, '--markdown', md],
      { timeout: 40_000, env: LARK_ENV },
    )
    if (JSON.parse(stdout).ok) return '私聊'
  } catch (err) {
    console.warn('[job] 私聊发送失败:', err.message)
  }
  return null
}

async function runSummaryJob(hours, mode, label) {
  const modeName = mode === 'todo' ? '整理今日待办' : `总结过去 ${hours} 小时`
  await post('/api/event', { state: 'working', label: `${modeName} · 正在捞消息…`, source: 'watcher' })
  const lines = await collectLines(hours)
  let full
  if (!lines.length) {
    full = `过去 ${hours} 小时飞书静悄悄的，没有新消息，好好享受清净 😺`
  } else {
    const prompt =
      mode === 'todo'
        ? '你是桌面宠物「小绝」，主人是黑哥。下面是黑哥今天飞书各群和私聊的消息记录（格式：时间 [会话] 发言人: 内容）。\n' +
          '请帮黑哥整理一份「今日待办」：\n1. 从消息里挑出需要黑哥回复、处理、确认或跟进的事，按紧急程度列 3-8 条，每条一行，开头用 🔴🟡⚪ 标优先级\n' +
          '2. 每条说清谁在哪有什么事、需要黑哥做什么\n3. 没有明确待办就直说「今天没有必须跟进的硬待办」，再附 2-3 条值得关注的动态\n' +
          '4. 不超过 250 字，口语化，简体中文\n\n消息记录：\n' + lines.join('\n')
        : '你是桌面宠物「小绝」，主人是黑哥。下面是黑哥飞书过去 ' + hours + ' 小时各群和私聊的消息记录（格式：时间 [会话] 发言人: 内容）。\n' +
          '请做一份消息总结：\n1. 第一行一句话概括整体动态\n2. 按会话/主题分 3-6 条要点，每条一行，说清谁在聊什么、有什么结论或进展\n' +
          '3. 有需要黑哥留意的事单独一行「⚠️ 记得看：」指出；没有就不写\n4. 不超过 250 字，口语化，可带一两个 emoji，简体中文\n\n消息记录：\n' + lines.join('\n')
    try {
      full = await llmChat(prompt)
    } catch {
      full = `总结引擎打盹了。过去 ${hours} 小时共捞到 ${lines.length} 条消息，稍后再让我试一次。`
    }
  }
  const md = `**🐾 小绝 · ${label || modeName}**\n\n${full}`
  const where = await sendFeishuUser(md)
  const note = { 私聊: '已私聊发你', dryrun: '联调模式，未发飞书' }[where] || '飞书发送失败，只看板展示'
  await post('/api/report', { text: `${full}\n\n—— ${note}`, trigger: label || modeName, source: 'watcher' })
  await post('/api/event', { state: 'success', label: `${modeName}完成 · ${note}`, source: 'watcher' })
}

async function handleCommand(cmd) {
  if (cmdBusy) {
    await post('/api/event', { state: 'error', label: '上一个绝活还没演完，稍等…', source: 'watcher' })
    return
  }
  cmdBusy = true
  try {
    if (cmd.command === 'todo') {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const hours = Math.round(Math.max(1, (Date.now() - todayStart.getTime()) / 3600_000) * 10) / 10
      await runSummaryJob(hours, 'todo', cmd.label)
    } else if (cmd.command?.startsWith('summary:')) {
      const h = [6, 12, 24].includes(Number(cmd.command.split(':')[1]))
        ? Number(cmd.command.split(':')[1])
        : 6
      await runSummaryJob(h, 'summary', cmd.label)
    }
  } catch (err) {
    console.warn('[cmd] 执行失败:', err.message)
    await post('/api/event', { state: 'error', label: `绝活演砸了：${String(err.message).slice(0, 30)}`, source: 'watcher' })
  } finally {
    cmdBusy = false
  }
}

/** 监听菜单下发的干活指令（SSE 长连，断了自动重连；init 会补投最近一条，靠 ts 去重） */
let cmdHandledTs = 0
function maybeHandleCommand(cmd) {
  if (!cmd || !cmd.ts) return
  if (cmd.ts <= cmdHandledTs) return // 已执行过
  if (Date.now() - cmd.ts > 3 * 60_000) return // 太旧的指令不补（重启场景）
  cmdHandledTs = cmd.ts
  handleCommand(cmd)
}

async function listenCommands() {
  for (;;) {
    try {
      const res = await fetch(`${PET_URL}/api/events`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const line = chunk.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          try {
            const d = JSON.parse(line.slice(6))
            if (d.type === 'command') maybeHandleCommand(d.command)
            else if (d.type === 'init' && d.lastCommand) maybeHandleCommand(d.lastCommand)
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      console.warn('[cmd] SSE 断开，5s 后重连:', err.message)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}

async function main() {
  const { provider, model } = loadLlmConfig()
  const llmDesc = provider === 'api' ? model : `${provider} CLI`
  console.log(`🐾 小绝群监工启动 → ${PET_URL}（轮询 ${POLL_SEC}s，日报 ${DAILY_HOUR}:00，LLM ${llmDesc}${DRYRUN ? '，DRYRUN 不发飞书' : ''}${INBOX ? `，收件箱扫描 ${INBOX_CHATS} 个会话` : ''}，绝活指令监听中）`)
  listenCommands()
  let first = true
  const reportNow = process.argv.includes('--report-now')
  for (;;) {
    try {
      await pollOnce(first)
      if (first && reportNow) summarize('手动测试')
      first = false
    } catch (err) {
      console.warn('[poller] 本轮失败:', err.message)
    }
    if (INBOX) {
      try {
        await scanInbox()
      } catch (err) {
        console.warn('[inbox] 本轮失败:', err.message)
      }
    }
    // 每日 18:00 自动日报
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    if (now.getHours() === DAILY_HOUR && !sentDays.has(day)) {
      sentDays.add(day)
      summarize('每日自动日报')
    }
    await new Promise((r) => setTimeout(r, POLL_SEC * 1000))
  }
}

main()
