/**
 * 小绝桌面宠物 · 内嵌事件服务器（零依赖，Node 原生 http）
 *
 *  - POST /api/event     飞书 bot 上报状态（六档）
 *  - POST /api/interact  互动（pat 摸头 / feed 投喂）
 *  - GET  /api/events    SSE 实时推送（宠物窗口 + 调试看板共用）
 *  - GET  /api/state     当前状态兜底轮询
 *  - GET  /*             调试看板静态文件（dist/），不依赖 Vite
 *
 * 额外行为：10 分钟没有任何事件 → 自动进入 sleeping（摸鱼）。
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const {
  CONFIG_PATH,
  loadLlmConfig,
  saveLlmConfig,
  maskKey,
  llmChat,
} = require('../feishu/llm-client.cjs')

const VALID_STATES = new Set([
  'idle',
  'thinking',
  'working',
  'success',
  'error',
  'sleeping',
])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

function startPetServer({ port = 7100, distDir, onEvent } = {}) {
  const clients = new Set()
  let last = {
    state: 'idle',
    label: '待机中 · 等飞书 bot 召唤',
    ts: Date.now(),
    source: 'system',
  }
  const log = [last]
  let lastReport = null
  let lastCommand = null // 最近一条绝活指令，SSE 重连时随 init 补投，防启动竞态丢指令

  const broadcast = (payload) => {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of clients) {
      try {
        res.write(data)
      } catch {
        clients.delete(res)
      }
    }
  }

  const pushEvent = (ev) => {
    last = ev
    log.push(ev)
    if (log.length > 200) log.shift()
    broadcast({ type: 'event', event: ev })
    onEvent?.(ev)
  }

  // 桌面宠物式：10 分钟没活干自动睡着
  const autoSleep = setInterval(() => {
    if (last.state !== 'sleeping' && Date.now() - last.ts > 10 * 60 * 1000) {
      pushEvent({
        state: 'sleeping',
        label: '10 分钟没活干，先眯一会',
        ts: Date.now(),
        source: 'auto',
      })
    }
  }, 30 * 1000)
  autoSleep.unref?.()

  const json = (res, obj, code = 200) => {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify(obj))
  }

  const server = http.createServer((req, res) => {
    let url = req.url?.split('?')[0] || '/'
    try {
      url = decodeURIComponent(url)
    } catch {
      /* 保持原样 */
    }

    if (url === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })
      res.write(
        `data: ${JSON.stringify({ type: 'init', last, log: log.slice(-30), lastReport, lastCommand })}\n\n`,
      )
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }

    if (url === '/api/state' && req.method === 'GET') {
      json(res, { last, log: log.slice(-30), lastReport })
      return
    }

    if (
      (url === '/api/event' ||
        url === '/api/interact' ||
        url === '/api/report' ||
        url === '/api/command' ||
        url === '/api/llm-config' ||
        url === '/api/llm-test') &&
      req.method === 'OPTIONS'
    ) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
      return
    }

    if (url === '/api/event' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}')
          if (!VALID_STATES.has(parsed.state)) {
            json(res, {
              ok: false,
              error: `state 必须是 ${[...VALID_STATES].join('/')}`,
            })
            return
          }
          const ev = {
            state: parsed.state,
            label: String(parsed.label ?? '').slice(0, 60),
            ts: Date.now(),
            source: String(parsed.source ?? 'api').slice(0, 30),
          }
          // 可选：飞书会话 id，气泡点击可跳转到对应聊天
          if (parsed.chatId) ev.chatId = String(parsed.chatId).slice(0, 40)
          pushEvent(ev)
          json(res, { ok: true, event: ev })
        } catch {
          json(res, { ok: false, error: 'invalid JSON' })
        }
      })
      return
    }

    if (url === '/api/interact' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}')
          const kind = parsed.kind === 'feed' ? 'feed' : 'pat'
          const interact = {
            kind,
            label: String(parsed.label ?? '').slice(0, 40),
            ts: Date.now(),
            source: String(parsed.source ?? 'api').slice(0, 30),
          }
          broadcast({ type: 'interact', interact })
          json(res, { ok: true, interact })
        } catch {
          json(res, { ok: false, error: 'invalid JSON' })
        }
      })
      return
    }

    // 群汇报卡片：watcher 的 LLM 总结全文
    if (url === '/api/report' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}')
          const report = {
            text: String(parsed.text ?? '').slice(0, 1200),
            trigger: String(parsed.trigger ?? '').slice(0, 40),
            ts: Date.now(),
            source: String(parsed.source ?? 'api').slice(0, 30),
          }
          lastReport = report
          broadcast({ type: 'report', report })
          json(res, { ok: true, report })
        } catch {
          json(res, { ok: false, error: 'invalid JSON' })
        }
      })
      return
    }

    // 小绝的绝活：菜单下发干活指令（watcher 监听执行）
    if (url === '/api/command' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}')
          const cmd = {
            command: String(parsed.command ?? '').slice(0, 30),
            label: String(parsed.label ?? '').slice(0, 40),
            ts: Date.now(),
            source: String(parsed.source ?? 'api').slice(0, 30),
          }
          lastCommand = cmd
          broadcast({ type: 'command', command: cmd })
          json(res, { ok: true, command: cmd })
        } catch {
          json(res, { ok: false, error: 'invalid JSON' })
        }
      })
      return
    }

    // —— 大模型设置：读配置（key 脱敏）——
    if (url === '/api/llm-config' && req.method === 'GET') {
      const cfg = loadLlmConfig()
      json(res, {
        ok: true,
        config: {
          provider: cfg.provider,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          hasKey: Boolean(cfg.apiKey),
          apiKeyMasked: maskKey(cfg.apiKey),
        },
        configPath: CONFIG_PATH,
      })
      return
    }

    // —— 大模型设置：保存 ——
    if (url === '/api/llm-config' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}')
          const next = saveLlmConfig({
            provider: parsed.provider,
            baseUrl: String(parsed.baseUrl ?? '').trim(),
            model: String(parsed.model ?? '').trim(),
            apiKey: String(parsed.apiKey ?? '').trim(),
          })
          json(res, {
            ok: true,
            config: {
              provider: next.provider,
              baseUrl: next.baseUrl,
              model: next.model,
              hasKey: Boolean(next.apiKey),
              apiKeyMasked: maskKey(next.apiKey),
            },
          })
        } catch (err) {
          json(res, { ok: false, error: String(err.message || err) })
        }
      })
      return
    }

    // —— 大模型设置：连接测试（用当前已保存的配置）——
    if (url === '/api/llm-test' && req.method === 'POST') {
      llmChat('用一句不超过 20 字的话介绍你自己。', { timeoutMs: 60_000 })
        .then((text) => json(res, { ok: true, text: text.slice(0, 120) }))
        .catch((err) => json(res, { ok: false, error: String(err.message || err) }))
      return
    }

    // 静态文件（调试看板）
    if (req.method === 'GET' && distDir) {
      const rel = url === '/' ? '/index.html' : url
      const file = path.normalize(path.join(distDir, rel))
      if (file.startsWith(distDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        })
        fs.createReadStream(file).pipe(res)
        return
      }
    }

    json(res, { ok: false, error: 'not found' }, 404)
  })

  // SSE 保活
  const keepAlive = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(': ping\n\n')
      } catch {
        clients.delete(res)
      }
    }
  }, 25000)
  keepAlive.unref?.()

  server.listen(port, () => {
    console.log(`🐾 小绝事件服务器: http://localhost:${port}`)
  })
  return server
}

module.exports = { startPetServer }

// 也可以独立跑：node desktop/server.cjs（配合任何静态看板/调试）
if (require.main === module) {
  startPetServer({
    port: Number(process.env.PET_PORT || 7100),
    distDir: path.join(__dirname, '..', 'dist'),
  })
}
