import { useState } from 'react'
import { PetStage } from '@/pet/PetStage'
import { usePetChannel } from '@/hooks/use-pet-channel'
import { PET_STATES, STATE_META, type PetState } from '@/types/pet'
import { FORMS, SKINS, type PetForm, type SkinId } from '@/pet/skins'
import { LlmSettings } from '@/components/LlmSettings'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

const POSTERS = [
  '01-垃圾桶.png',
  '02-绿植.png',
  '03-充电处.png',
  '04-活动入口.png',
  '05-扶梯口.png',
  '06-vibe-coding区.png',
]

const DEMO_PRESETS: Record<PetState, string> = {
  idle: '待机 · 随时可 @',
  thinking: '@小绝 帮我写本周周报',
  working: '正在生成周报 · 第 3 节',
  success: '周报已生成，草稿箱等你确认',
  error: '飞书 API 超时，需要人工看一眼',
  sleeping: '30 分钟没活干，先眯一会',
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

export default function Home() {
  const { current, log, connected, stateSince, sendEvent, interact, bumpInteract, lastReport } =
    usePetChannel()
  const meta = STATE_META[current.state]
  const [skin, setSkin] = useState<SkinId>(
    () => (localStorage.getItem('pet-skin') as SkinId) || 'pixel',
  )
  const [form, setForm] = useState<PetForm>(
    () => (localStorage.getItem('pet-form') as PetForm) || 'adult',
  )
  const pickSkin = (s: SkinId) => {
    setSkin(s)
    localStorage.setItem('pet-skin', s)
  }
  const pickForm = (f: PetForm) => {
    setForm(f)
    localStorage.setItem('pet-form', f)
  }

  const pat = () => bumpInteract('pat')
  const feed = () => bumpInteract('feed')

  return (
    <div className="grid-paper min-h-screen font-sans text-[#191919]">
      {/* ===== 顶栏 ===== */}
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 pt-8">
        <div className="flex items-center gap-3">
          <div className="sticker px-4 py-2">
            <h1 className="text-2xl font-black tracking-tight">
              飞书干活宠物<span className="text-[#9BE83A]">·</span>小绝
            </h1>
          </div>
          <div
            className="sticker px-3 py-1"
            style={{ background: '#191919' }}
          >
            <span className="text-sm font-black text-white">2026</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            className="border-2 border-[#191919] px-3 py-1 text-xs font-bold"
            style={{ background: meta.color, color: meta.textColor }}
          >
            {meta.name}
          </Badge>
          <div className="sticker flex items-center gap-2 px-3 py-1.5">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                connected ? 'bg-[#9BE83A]' : 'bg-[#FF4D4F]'
              }`}
            />
            <span className="text-xs font-bold">
              {connected ? 'bot 通道已连接' : '通道重连中…'}
            </span>
          </div>
        </div>
      </header>

      {/* ===== 主区域 ===== */}
      <main className="mx-auto grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-[1fr_380px]">
        {/* 宠物舞台 */}
        <section className="sticker relative flex min-h-[520px] flex-col items-center justify-center overflow-hidden bg-white">
          {/* 浏览器窗口条（海报同款元素） */}
          <div className="absolute left-0 right-0 top-0 flex items-center gap-2 border-b-[3px] border-[#191919] bg-[#F4F4F0] px-4 py-2.5">
            <span className="h-3 w-3 rounded-full border-2 border-[#191919] bg-[#FF8FD8]" />
            <span className="h-3 w-3 rounded-full border-2 border-[#191919] bg-[#FFD60A]" />
            <span className="h-3 w-3 rounded-full border-2 border-[#191919] bg-[#9BE83A]" />
            <span className="ml-3 text-xs font-bold text-[#191919]/60">
              feishu://pet/小绝
            </span>
          </div>

          {/* 气泡台词 */}
          <div
            className="animate-float relative z-10 mb-2 mt-10 max-w-[320px] rounded-2xl border-[3px] border-[#191919] bg-white px-4 py-2 text-center shadow-[5px_5px_0_#191919]"
          >
            <div
              className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-md border-2 border-[#191919] px-2 py-0.5 text-[10px] font-black"
              style={{ background: meta.color, color: meta.textColor }}
            >
              {meta.name}
            </div>
            <p className="pt-1 text-sm font-bold leading-snug">
              {current.label || meta.desc}
            </p>
            <div className="absolute -bottom-[11px] left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b-[3px] border-r-[3px] border-[#191919] bg-white" />
          </div>

          {/* 宠物本体 */}
          <div className="grid-paper flex flex-1 items-center justify-center self-stretch">
            <PetStage
              state={current.state}
              stateSince={stateSince}
              interact={interact}
              skin={skin}
              form={form}
              onPat={pat}
            />
          </div>

          {/* 皮肤与形态选择 */}
          <div className="flex flex-wrap items-center gap-1.5 border-t-[3px] border-[#191919] bg-[#F4F4F0] px-3 py-2.5">
            {SKINS.map((s) => (
              <button
                key={s.id}
                onClick={() => pickSkin(s.id)}
                className={`rounded-lg border-2 border-[#191919] px-2 py-1 text-[11px] font-black transition-all ${
                  skin === s.id
                    ? 'bg-[#191919] text-[#9BE83A] shadow-[2px_2px_0_rgba(25,25,25,0.3)]'
                    : 'bg-white text-[#191919] hover:bg-[#9BE83A]/30'
                }`}
              >
                {s.name}
              </button>
            ))}
            <span className="mx-1 h-4 w-0.5 bg-[#191919]/20" />
            {FORMS.map((f) => (
              <button
                key={f.id}
                onClick={() => pickForm(f.id)}
                className={`rounded-lg border-2 border-[#191919] px-2 py-1 text-[11px] font-black transition-all ${
                  form === f.id
                    ? 'bg-[#8B5CF6] text-white'
                    : 'bg-white text-[#191919] hover:bg-[#8B5CF6]/20'
                }`}
              >
                {f.name.replace('形态', '')}
              </button>
            ))}
          </div>

          {/* 底部互动条 */}
          <div className="flex items-center gap-3 border-t-[3px] border-[#191919] bg-[#F4F4F0] px-4 py-3">
            <Button
              onClick={pat}
              className="border-[3px] border-[#191919] bg-[#FF8FD8] font-black text-[#191919] shadow-[4px_4px_0_#191919] transition-all hover:bg-[#FF8FD8] hover:shadow-[2px_2px_0_#191919] hover:translate-x-[2px] hover:translate-y-[2px]"
            >
              摸摸头
            </Button>
            <Button
              onClick={feed}
              className="border-[3px] border-[#191919] bg-[#FFD60A] font-black text-[#191919] shadow-[4px_4px_0_#191919] transition-all hover:bg-[#FFD60A] hover:shadow-[2px_2px_0_#191919] hover:translate-x-[2px] hover:translate-y-[2px]"
            >
              投喂食物
            </Button>
            <span className="ml-2 text-xs font-bold text-[#191919]/50">
              点宠物也可以摸头
            </span>
          </div>
        </section>

        {/* 右侧控制面板 */}
        <aside className="flex flex-col gap-6">
          {/* 状态模拟 */}
          <div className="sticker p-4">
            <h2 className="mb-1 text-lg font-black">模拟 bot 状态</h2>
            <p className="mb-3 text-xs font-bold text-[#191919]/50">
              和飞书 bot 上报走同一条 /api/event 通道
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PET_STATES.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  onClick={() => sendEvent(s, DEMO_PRESETS[s])}
                  className={`h-auto flex-col items-start gap-0.5 border-[3px] border-[#191919] px-3 py-2 font-black shadow-[3px_3px_0_#191919] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0_#191919] ${
                    current.state === s ? 'ring-2 ring-offset-1' : ''
                  }`}
                  style={{
                    background: current.state === s ? STATE_META[s].color : '#fff',
                    color: current.state === s ? STATE_META[s].textColor : '#191919',
                  }}
                >
                  <span>{STATE_META[s].name}</span>
                  <span className="text-[10px] font-bold opacity-60">
                    {STATE_META[s].desc}
                  </span>
                </Button>
              ))}
            </div>
          </div>

          {/* 事件日志 */}
          <div className="sticker flex min-h-0 flex-1 flex-col p-4">
            <h2 className="mb-3 text-lg font-black">事件日志</h2>
            <ScrollArea className="h-44 pr-2">
              <div className="flex flex-col gap-2">
                {[...log].reverse().map((ev, i) => (
                  <div
                    key={ev.ts + '-' + i}
                    className="flex items-start gap-2 rounded-lg border-2 border-[#191919]/10 bg-[#F8F8F4] px-2 py-1.5"
                  >
                    <span
                      className="mt-0.5 shrink-0 rounded border border-[#191919] px-1.5 text-[10px] font-black"
                      style={{
                        background: STATE_META[ev.state].color,
                        color: STATE_META[ev.state].textColor,
                      }}
                    >
                      {STATE_META[ev.state].name}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold">
                        {ev.label || STATE_META[ev.state].desc}
                      </p>
                      <p className="text-[10px] font-bold text-[#191919]/40">
                        {fmtTime(ev.ts)} · {ev.source ?? 'api'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* 群汇报卡片 */}
          {lastReport && (
            <div className="sticker border-[#8B5CF6] p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg font-black">
                  组委会群汇报<span className="text-[#8B5CF6]">·</span>小绝
                </h2>
                <span className="rounded border-2 border-[#191919] bg-[#8B5CF6] px-1.5 py-0.5 text-[10px] font-black text-white">
                  {fmtTime(lastReport.ts)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-xs font-bold leading-relaxed text-[#191919]/80">
                {lastReport.text}
              </p>
              {lastReport.trigger && (
                <p className="mt-2 text-[10px] font-bold text-[#191919]/40">
                  触发：{lastReport.trigger}
                </p>
              )}
            </div>
          )}

          {/* 飞书打通 */}
          <div className="sticker bg-[#191919] p-4 text-white">
            <h2 className="mb-2 text-lg font-black text-[#9BE83A]">
              打通飞书 CLI
            </h2>
            <p className="mb-2 text-xs leading-relaxed text-white/70">
              bot 干活时在关键节点 POST 状态，宠物实时换动作：
            </p>
            <pre className="overflow-x-auto rounded-lg border-2 border-[#9BE83A]/40 bg-black/60 p-3 text-[11px] leading-relaxed text-[#9BE83A]">
{`curl -X POST http://localhost:7100/api/event \\
  -H 'Content-Type: application/json' \\
  -d '{"state":"working",
       "label":"正在生成周报"}'`}
            </pre>
            <p className="mt-2 text-[11px] leading-relaxed text-white/50">
              六档状态：idle / thinking / working / success / error / sleeping。
              也可以直接用 <code className="text-[#FF8FD8]">feishu/pet-hook.mjs</code> 脚本。
            </p>
          </div>

          {/* 大模型设置 */}
          <LlmSettings />
        </aside>
      </main>

      {/* ===== 真机实拍 ===== */}
      <section className="mx-auto max-w-6xl px-6 pb-6">
        <div className="sticker overflow-hidden p-4">
          <h2 className="mb-3 text-sm font-black text-[#191919]/60">
            真机实拍 · 透明窗口悬浮在桌面右下角，来消息冒泡、右键派活
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { src: './screenshots/desktop-intro.png', cap: '桌面悬浮 · 自我介绍' },
              { src: './screenshots/board-working.png', cap: '看板 · 干活中状态联动' },
              { src: './screenshots/board-skins.png', cap: '看板 · 换装与大模型设置' },
            ].map((s) => (
              <figure key={s.src} className="m-0">
                <img
                  src={s.src}
                  alt={s.cap}
                  className="w-full rounded-lg border-[3px] border-[#191919] object-cover shadow-[4px_4px_0_#191919]"
                  loading="lazy"
                />
                <figcaption className="mt-1.5 text-center text-[11px] font-black text-[#191919]/50">
                  {s.cap}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 风格来源：海报走马灯 ===== */}
      <section className="mx-auto max-w-6xl px-6 pb-6">
        <div className="sticker overflow-hidden p-4">
          <h2 className="mb-3 text-sm font-black text-[#191919]/60">
            画风来源 · 飞书绝活大会北京场点位海报（同一套贴纸语言）
          </h2>
          <div className="relative overflow-hidden">
            <div className="animate-marquee flex w-max gap-4">
              {[...POSTERS, ...POSTERS].map((p, i) => (
                <img
                  key={i}
                  src={encodeURI(`./posters/${p}`)}
                  alt={p.replace('.png', '')}
                  className="h-36 rounded-lg border-[3px] border-[#191919] object-cover shadow-[4px_4px_0_#191919]"
                  loading="lazy"
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== 署名 ===== */}
      <footer className="flex justify-center pb-8">
        <div className="-rotate-2 rounded-lg border-[3px] border-white bg-[#191919] px-4 py-1.5 shadow-[5px_5px_0_rgba(25,25,25,0.25)]">
          <span className="text-sm font-black text-white">绝活家 </span>
          <span className="text-sm font-black text-[#9BE83A]">@黑哥</span>
        </div>
      </footer>
    </div>
  )
}
