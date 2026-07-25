import path from 'path'
import type { ServerResponse } from 'http'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { inspectAttr } from 'kimi-plugin-inspect-react'

/**
 * 宠物事件 API —— 飞书 CLI / bot 的接入口。
 *
 *  POST /api/event   { "state": "working", "label": "正在生成周报" }
 *  GET  /api/events   SSE 流，前端实时接收
 *  GET  /api/state    当前状态 + 最近日志（兜底轮询用）
 *
 * state ∈ idle | thinking | working | success | error | sleeping
 */
const VALID_STATES = new Set([
  'idle',
  'thinking',
  'working',
  'success',
  'error',
  'sleeping',
])

function petApi(): Plugin {
  const clients = new Set<ServerResponse>()
  let last = {
    state: 'idle',
    label: '待机中 · 等飞书 bot 召唤',
    ts: Date.now(),
    source: 'system',
  }
  const log: typeof last[] = [last]

  const broadcast = (payload: unknown) => {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of clients) {
      try {
        res.write(data)
      } catch {
        clients.delete(res)
      }
    }
  }

  return {
    name: 'pet-event-api',
    configureServer(server) {
      // SSE 保活
      const timer = setInterval(() => {
        for (const res of clients) {
          try {
            res.write(': ping\n\n')
          } catch {
            clients.delete(res)
          }
        }
      }, 25000)
      server.httpServer?.on('close', () => clearInterval(timer))

      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]

        if (url === '/api/events' && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          })
          res.write(
            `data: ${JSON.stringify({ type: 'init', last, log: log.slice(-30) })}\n\n`,
          )
          clients.add(res as ServerResponse)
          req.on('close', () => clients.delete(res as ServerResponse))
          return
        }

        if (url === '/api/state' && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          res.end(JSON.stringify({ last, log: log.slice(-30) }))
          return
        }

        if ((url === '/api/event' || url === '/api/interact') && req.method === 'OPTIONS') {
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
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            })
            try {
              const parsed = JSON.parse(body || '{}')
              if (!VALID_STATES.has(parsed.state)) {
                res.end(
                  JSON.stringify({
                    ok: false,
                    error: `state 必须是 ${[...VALID_STATES].join('/')}`,
                  }),
                )
                return
              }
              last = {
                state: parsed.state,
                label: String(parsed.label ?? '').slice(0, 60),
                ts: Date.now(),
                source: String(parsed.source ?? 'api').slice(0, 30),
              }
              log.push(last)
              if (log.length > 200) log.shift()
              broadcast({ type: 'event', event: last })
              res.end(JSON.stringify({ ok: true, event: last }))
            } catch {
              res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }))
            }
          })
          return
        }

        // 互动事件：飞书侧用户摸头/投喂 → 宠物冒爱心/吃小鱼干
        if (url === '/api/interact' && req.method === 'POST') {
          let body = ''
          req.on('data', (c) => (body += c))
          req.on('end', () => {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            })
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
              res.end(JSON.stringify({ ok: true, interact }))
            } catch {
              res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }))
            }
          })
          return
        }

        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react(), petApi()],
  server: {
    port: 7100,
    strictPort: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        pet: path.resolve(__dirname, 'pet.html'),
      },
    },
  },
})
