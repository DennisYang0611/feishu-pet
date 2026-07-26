/**
 * 小绝 · LLM 客户端（server.cjs 与 group-watcher.mjs 共用，零依赖 CJS）
 *
 * 四种后端：
 *  - api    ：OpenAI 兼容接口（自定义 baseUrl + apiKey + model）
 *  - codex  ：本机 Codex CLI（codex exec 非交互模式，用你已登录的账号）
 *  - claude ：本机 Claude Code CLI（claude -p 打印模式，用你已登录的账号）
 *  - aily   ：飞书 Aily 智能伙伴（走 lark-cli 用户态调 Aily OpenAPI，需 ailyAppId）
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
  next.provider = ['api', 'codex', 'claude', 'aily'].includes(next.provider) ? next.provider : 'api'
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2))
  return next
}

function maskKey(k) {
  if (!k) return ''
  return k.length > 10 ? `${k.slice(0, 5)}…${k.slice(-4)}` : '****'
}

/** 调本机 CLI（codex / claude），prompt 走 argv 避免 shell 转义问题。
 *  cwd 锁到临时目录：总结场景不需要项目上下文，防止 agent 在工作目录里开工具循环。 */
function runCli(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Finder 启动的进程 PATH 很短，补上常见 CLI 安装目录
    const env = {
      ...process.env,
      PATH: `${os.homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
    }
    const p = spawn(cmd, args, { env, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] })
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

/** 调 lark-cli 并合并 stdout/stderr 解析 JSON（lark-cli 报错时走 stderr 且退出码非 0） */
function runLarkApi(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PATH: `${os.homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
    }
    const p = spawn('lark-cli', args, { env, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      p.kill('SIGKILL')
      reject(new Error(`lark-cli 响应超时（${Math.round(timeoutMs / 1000)}s）`))
    }, timeoutMs)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`找不到 lark-cli 命令，请先安装并登录（${e.message}）`))
    })
    p.on('close', () => {
      clearTimeout(timer)
      const raw = (out.trim() || err.trim())
      const start = raw.indexOf('{')
      if (start >= 0) {
        try {
          resolve(JSON.parse(raw.slice(start)))
          return
        } catch {
          /* 落到通用错误 */
        }
      }
      reject(new Error(`lark-cli 无有效输出：${raw.slice(-160) || '空'}`))
    })
  })
}

/** 通过 lark-cli api 逃生舱调 Aily OpenAPI（用户态），返回 data 字段 */
async function ailyApi(method, apiPath, body, timeoutMs = 60_000) {
  const args = ['api', method, apiPath, '--as', 'user']
  if (body !== undefined) args.push('--data', JSON.stringify(body))
  const d = await runLarkApi(args, timeoutMs)
  if (!d.ok) {
    const msg = d.error?.message || 'Aily 接口调用失败'
    if (String(d.error?.code) === '2320008' || msg.includes('未找到关联的 Aily 租户')) {
      throw new Error('当前飞书租户未开通 Aily 服务，无法使用 Aily 引擎（可在 Aily 管理后台开通后重试）')
    }
    if (msg.includes('scope')) {
      throw new Error(`Aily 权限不足：${msg}（需重新授权 aily:session/message/run 权限点）`)
    }
    throw new Error(msg)
  }
  return d.data ?? d
}

/** Aily 对话：创建会话 → 发消息 → 触发运行 → 轮询拿 ASSISTANT 回复 */
async function ailyChat(prompt, ailyAppId, timeoutMs) {
  if (!ailyAppId) {
    throw new Error('未配置 Aily 应用 ID（spring_xxx__c，看板「大模型设置」里填，Aily 应用开发页地址栏可复制）')
  }
  const deadline = Date.now() + timeoutMs
  // 1. 会话
  const s = await ailyApi('POST', '/open-apis/aily/v1/sessions', {})
  const sid = s.session?.id
  if (!sid) throw new Error('Aily 创建会话失败')
  try {
    // 2. 消息
    await ailyApi('POST', `/open-apis/aily/v1/sessions/${sid}/messages`, {
      idempotent_id: `xj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content_type: 'MDX',
      content: prompt,
    })
    // 3. 运行
    const r = await ailyApi('POST', `/open-apis/aily/v1/sessions/${sid}/runs`, {
      app_id: ailyAppId,
    })
    const rid = r.run?.id
    if (!rid) throw new Error('Aily 触发运行失败')
    // 4. 轮询运行状态
    for (;;) {
      if (Date.now() > deadline) throw new Error(`Aily 响应超时（${Math.round(timeoutMs / 1000)}s）`)
      await new Promise((res) => setTimeout(res, 3000))
      const st = await ailyApi('GET', `/open-apis/aily/v1/sessions/${sid}/runs/${rid}`, undefined)
      const status = st.run?.status
      if (status === 'COMPLETED') break
      if (['FAILED', 'CANCELED', 'EXPIRED'].includes(status)) {
        throw new Error(`Aily 运行失败（${status}）`)
      }
    }
    // 5. 取 ASSISTANT 回复
    const m = await ailyApi(
      'GET',
      `/open-apis/aily/v1/sessions/${sid}/messages?run_id=${rid}&page_size=20`,
      undefined,
    )
    const text = (m.messages || [])
      .filter((x) => x.sender?.sender_type === 'ASSISTANT')
      .map((x) => x.plain_text || x.content || '')
      .join('\n')
      .trim()
    if (text) return text
    throw new Error('Aily 没有返回内容')
  } finally {
    // 会话用完销毁，不留垃圾
    ailyApi('DELETE', `/open-apis/aily/v1/sessions/${sid}`, undefined, 15_000).catch(() => {})
  }
}

/** 通用 LLM 调用（带一次重试），返回纯文本。CLI 模式本地模型冷启动慢，默认给 300s */
async function llmChat(prompt, { timeoutMs = 90_000 } = {}) {
  const cfg = loadLlmConfig()
  const cliTimeout = Math.max(timeoutMs, 300_000)
  let lastErr
  for (const attempt of [1, 2]) {
    try {
      if (cfg.provider === 'codex') {
        const outFile = path.join(os.tmpdir(), `xiaojue-llm-${Date.now()}.txt`)
        // 关键：-C 锁到临时目录 + 只读沙盒，否则 codex 会在当前工作目录开 agent 工具循环
        await runCli(
          'codex',
          [
            'exec',
            '--skip-git-repo-check',
            '--sandbox',
            'read-only',
            '-C',
            os.tmpdir(),
            '--output-last-message',
            outFile,
            prompt,
          ],
          cliTimeout,
        )
        const text = fs.readFileSync(outFile, 'utf8').trim()
        fs.unlink(outFile, () => {})
        if (text) return text
        throw new Error('codex 无输出')
      }
      if (cfg.provider === 'claude') {
        const text = await runCli('claude', ['-p', prompt], cliTimeout)
        if (text) return text
        throw new Error('claude 无输出')
      }
      if (cfg.provider === 'aily') {
        const text = await ailyChat(prompt, cfg.ailyAppId, cliTimeout)
        if (text) return text
        throw new Error('aily 无输出')
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
