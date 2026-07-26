import { useEffect, useState } from 'react'

/**
 * 大模型设置：配置小绝汇报/总结用的 LLM 后端。
 * 四种模式：自定义 API（OpenAI 兼容）/ 本机 Codex CLI / 本机 Claude Code CLI / 飞书 Aily 智能伙伴。
 * 保存在 ~/.xiaojue-pet/llm.json，watcher 每次总结时实时读取，无需重启。
 */

const PROVIDERS = [
  { id: 'api', name: '自定义 API', desc: 'OpenAI 兼容接口' },
  { id: 'codex', name: 'Codex CLI', desc: '本机已登录账号' },
  { id: 'claude', name: 'Claude Code', desc: '本机已登录账号' },
  { id: 'aily', name: '飞书 Aily', desc: '智能伙伴原生总结' },
] as const

interface LlmConfigResp {
  provider: string
  baseUrl: string
  model: string
  ailyAppId: string
  hasKey: boolean
  apiKeyMasked: string
}

export function LlmSettings() {
  const [provider, setProvider] = useState<string>('api')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [ailyAppId, setAilyAppId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [keyMasked, setKeyMasked] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/llm-config')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error)
        const c: LlmConfigResp = d.config
        setProvider(c.provider)
        setBaseUrl(c.baseUrl)
        setModel(c.model)
        setAilyAppId(c.ailyAppId || '')
        setKeyMasked(c.apiKeyMasked)
      })
      .catch(() => setStatus('读取配置失败（宠物服务没开？）'))
  }, [])

  const save = async () => {
    setBusy(true)
    setStatus('保存中…')
    try {
      const res = await fetch('/api/llm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, baseUrl, model, apiKey, ailyAppId }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error)
      setKeyMasked(d.config.apiKeyMasked)
      setApiKey('')
      setStatus('已保存 ✓ 监工下次总结就用新配置，不用重启')
    } catch (e) {
      setStatus(`保存失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setStatus('正在让大模型说一句话…（CLI 模式可能要十几秒）')
    try {
      const res = await fetch('/api/llm-test', { method: 'POST' })
      const d = await res.json()
      if (d.ok) setStatus(`连接成功 ✓ 它说：「${d.text}」`)
      else setStatus(`连接失败 ✗ ${d.error}`)
    } catch (e) {
      setStatus(`连接失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border-2 border-[#191919] bg-white px-2.5 py-1.5 text-xs font-bold outline-none focus:border-[#2B5CFF]'

  return (
    <div className="sticker p-4">
      <h2 className="mb-1 text-lg font-black">
        大模型设置<span className="text-[#2B5CFF]">·</span>汇报大脑
      </h2>
      <p className="mb-3 text-[11px] leading-relaxed text-[#191919]/50">
        「宠物总结 / 绝活指令」用的 LLM。支持自定义 API、借用本机已登录的
        Codex / Claude Code，或直接让飞书 Aily 智能伙伴原生总结。
      </p>

      {/* 后端选择 */}
      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => setProvider(p.id)}
            className={`rounded-lg border-2 border-[#191919] px-1 py-1.5 text-center transition-all ${
              provider === p.id
                ? 'bg-[#191919] text-white shadow-[2px_2px_0_#9BE83A]'
                : 'bg-white hover:bg-[#F4F4F4]'
            }`}
          >
            <div className="text-[11px] font-black">{p.name}</div>
            <div className={`text-[9px] font-bold ${provider === p.id ? 'text-white/60' : 'text-[#191919]/40'}`}>
              {p.desc}
            </div>
          </button>
        ))}
      </div>

      {provider === 'api' ? (
        <div className="space-y-2">
          <input
            className={inputCls}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="Base URL，如 https://api.openai.com/v1"
          />
          <input
            className={inputCls}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="模型名，如 gpt-4o-mini"
          />
          <input
            className={inputCls}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keyMasked ? `已存 key（${keyMasked}），留空保持不变` : 'API Key'}
          />
        </div>
      ) : provider === 'aily' ? (
        <div className="space-y-2">
          <input
            className={inputCls}
            value={ailyAppId}
            onChange={(e) => setAilyAppId(e.target.value)}
            placeholder="Aily 应用 ID（spring_xxx__c，应用开发页地址栏复制）"
          />
          <p className="rounded-lg border-2 border-dashed border-[#191919]/30 px-2.5 py-2 text-[11px] font-bold leading-relaxed text-[#191919]/60">
            绝活指令直接交给你的 Aily 智能伙伴执行（它原生能读飞书消息），小绝负责传话和送达。
            需租户已开通 Aily 服务，且 lark-cli 已授权 aily 权限点。
          </p>
        </div>
      ) : (
        <p className="rounded-lg border-2 border-dashed border-[#191919]/30 px-2.5 py-2 text-[11px] font-bold leading-relaxed text-[#191919]/60">
          用本机 <code className="text-[#2B5CFF]">{provider === 'codex' ? 'codex' : 'claude'}</code>{' '}
          命令的非交互模式跑总结，走的是你自己登录的账号额度。
          先在终端确认 <code>{provider === 'codex' ? 'codex --version' : 'claude --version'}</code> 可用。
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-lg border-2 border-[#191919] bg-[#9BE83A] px-3 py-1.5 text-xs font-black shadow-[3px_3px_0_#191919] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#191919] disabled:opacity-50"
        >
          保存
        </button>
        <button
          onClick={test}
          disabled={busy}
          className="flex-1 rounded-lg border-2 border-[#191919] bg-white px-3 py-1.5 text-xs font-black shadow-[3px_3px_0_#191919] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_#191919] disabled:opacity-50"
        >
          测试连接
        </button>
      </div>
      {status && (
        <p className="mt-2 text-[11px] font-bold leading-relaxed text-[#191919]/70">{status}</p>
      )}
    </div>
  )
}
