/**
 * 小绝 · LLM 客户端（server.cjs 与 group-watcher.mjs 共用，零依赖 CJS）
 *
 * 三种后端：
 *  - api    ：OpenAI 兼容接口（自定义 baseUrl + apiKey + model）
 *  - codex  ：本机 Codex CLI（codex exec 非交互模式，用你已登录的账号）
 *  - claude ：本机 Claude Code CLI（claude -p 打印模式，用你已登录的账号）
 *
 * 配置持久化在 ~/.xiaojue-pet/llm.json；
 * 没有配置文件时向后兼容黑哥本机的 ~/.heige-image/config.json。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const CONFIG_PATH = path.join(os.homedir(), '.xiaojue-pet', 'llm.json')

/** 默认配置：优先复用 heige-image 的 key（黑哥本机），否则给 OpenAI 官方模板 */
function defaultConfig() {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), '.heige-image/config.json'), 'utf8'),
    )
    if (cfg.base_url && cfg.api_key) {
      return {
        provider: 'api',
        baseUrl: String(cfg.base_url).replace(/\/$/, ''),
        apiKey: cfg.api_key,
        model: 'gpt-5.5',
      }
    }
  } catch {
    /* 没有 heige-image 配置就走通用模板 */
  }
  return {
    provider: 'api',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  }
}

function loadLlmConfig() {
  const base = defaultConfig()
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    const merged = { ...base, ...saved }
    if (process.env.PET_LLM_MODEL) merged.model = process.env.PET_LLM_MODEL
    return merged
  } catch {
    if (process.env.PET_LLM_MODEL) base.model = process.env.PET_LLM_MODEL
    return base
  }
}

/** 保存配置；apiKey 传空 = 保留旧 key（前端脱敏回显场景） */
function saveLlmConfig(patch) {
  const prev = loadLlmConfig()
  const next = { ...prev, ...patch }
  if (!patch.apiKey) next.apiKey = prev.apiKey
  next.provider = ['api', 'codex', 'claude'].includes(next.provider) ? next.provider : 'api'
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2))
  return next
}

function maskKey(k) {
  if (!k) return ''
  return k.length > 10 ? `${k.slice(0, 5)}…${k.slice(-4)}` : '****'
}

/** 调本机 CLI（codex / claude），prompt 走 argv 避免 shell 转义问题 */
function runCli(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Finder 启动的进程 PATH 很短，补上常见 CLI 安装目录
    const env = {
      ...process.env,
      PATH: `${os.homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
    }
    const p = spawn(cmd, args, { env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      p.kill('SIGKILL')
      reject(new Error(`${cmd} 响应超时（${Math.round(timeoutMs / 1000)}s）`))
    }, timeoutMs)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`找不到 ${cmd} 命令，请先安装并登录（${e.message}）`))
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      const text = out.trim()
      if (text) resolve(text)
      else reject(new Error(`${cmd} 退出码 ${code}：${err.trim().slice(-160) || '无输出'}`))
    })
  })
}

/** 通用 LLM 调用（带一次重试），返回纯文本 */
async function llmChat(prompt, { timeoutMs = 90_000 } = {}) {
  const cfg = loadLlmConfig()
  let lastErr
  for (const attempt of [1, 2]) {
    try {
      if (cfg.provider === 'codex') {
        const outFile = path.join(os.tmpdir(), `xiaojue-llm-${Date.now()}.txt`)
        await runCli(
          'codex',
          ['exec', '--skip-git-repo-check', '--output-last-message', outFile, prompt],
          timeoutMs,
        )
        const text = fs.readFileSync(outFile, 'utf8').trim()
        fs.unlink(outFile, () => {})
        if (text) return text
        throw new Error('codex 无输出')
      }
      if (cfg.provider === 'claude') {
        const text = await runCli('claude', ['-p', prompt], timeoutMs)
        if (text) return text
        throw new Error('claude 无输出')
      }
      // api：OpenAI 兼容接口
      if (!cfg.apiKey) throw new Error('未配置 API Key（看板「大模型设置」里填一下）')
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 600,
          temperature: 0.6,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content?.trim()
      if (text) return text
      throw new Error(data.error?.message || 'empty response')
    } catch (err) {
      lastErr = err
      console.warn(`[llm] 第 ${attempt} 次失败: ${err.message}`)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  throw lastErr
}

module.exports = { CONFIG_PATH, loadLlmConfig, saveLlmConfig, maskKey, llmChat }
