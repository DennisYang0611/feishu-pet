import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PetStage } from '@/pet/PetStage'
import { usePetChannel } from '@/hooks/use-pet-channel'
import { STATE_META } from '@/types/pet'
import type { PetForm, SkinId } from '@/pet/skins'
import './index.css'

declare global {
  interface Window {
    petAPI?: {
      dragStart: () => void
      dragMove: () => void
      dragEnd: () => void
      openMenu: () => void
      onInteract: (cb: (kind: 'pat' | 'feed') => void) => void
      onScale: (cb: (scale: number) => void) => void
      onSkin: (cb: (v: { skin: SkinId; form: PetForm }) => void) => void
      skinChanged: (v: { skin: SkinId; form: PetForm }) => void
      onShowIntro: (cb: () => void) => void
      hitMask: (m: {
        w: number
        h: number
        scale: number
        data: Uint8Array
        bubble?: { x: number; y: number; w: number; h: number } | null
      }) => void
      openChat: (chatId: string) => void
      openAssistant: () => void
      closeAssistant: () => void
      resizeAssistant: (expanded: boolean) => void
      openWorkbench: () => void
      openApproval: (approval: {
        definitionCode: string
        instanceCode: string
        taskId: string
      }) => void
      openWorkbenchApproval: (instanceCode: string) => void
    }
  }
}

const INTRO_TEXT =
  '我叫小绝 🐾 诞生于 2026 年 7 月 25 日 · 飞书绝活大会北京场。bot 干活我伴舞，飞书来消息我冒泡，右键换皮肤、点我派绝活，摸我冒爱心～'

export function PetWindow() {
  const { current, stateSince, interact, bumpInteract } = usePetChannel()
  const meta = STATE_META[current.state]
  const [now, setNow] = useState(Date.now())
  const [scale, setScale] = useState(0.4)
  const [skin, setSkin] = useState<SkinId>(
    () => (localStorage.getItem('pet-skin') as SkinId) || 'pixel',
  )
  const [form, setForm] = useState<PetForm>(
    () => (localStorage.getItem('pet-form') as PetForm) || 'adult',
  )
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [introUntil, setIntroUntil] = useState(0)
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000)
    return () => {
      clearInterval(t)
      if (clickTimer.current) clearTimeout(clickTimer.current)
    }
  }, [])

  // 自我介绍（托盘/右键菜单触发）：气泡展示 9 秒
  useEffect(() => {
    window.petAPI?.onShowIntro(() => setIntroUntil(Date.now() + 9000))
  }, [])

  // 像素级点击穿透：定期把画布的 alpha 遮罩上报给主进程
  useEffect(() => {
    const off = document.createElement('canvas')
    off.width = 66
    off.height = 66
    const octx = off.getContext('2d', { willReadFrequently: true })
    if (!octx) return
    const t = setInterval(() => {
      const c = document.querySelector<HTMLCanvasElement>('.pet-canvas')
      if (!c || !window.petAPI?.hitMask) return
      octx.clearRect(0, 0, 66, 66)
      octx.drawImage(c, 0, 0, 66, 66)
      const d = octx.getImageData(0, 0, 66, 66).data
      const mask = new Uint8Array(66 * 66)
      for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] > 40 ? 1 : 0
      // 气泡可点时把它的矩形也上报，避免被像素级穿透放行
      let bubble: { x: number; y: number; w: number; h: number } | null = null
      const b = document.getElementById('pet-bubble-click')
      if (b) {
        const r = b.getBoundingClientRect()
        bubble = { x: r.x, y: r.y, w: r.width, h: r.height }
      }
      window.petAPI.hitMask({ w: 66, h: 66, scale: scaleRef.current, data: mask, bubble })
    }, 150)
    return () => clearInterval(t)
  }, [])

  // 主进程转发的互动（托盘/右键菜单触发）与体型切换
  useEffect(() => {
    window.petAPI?.onInteract((kind) => bumpInteract(kind))
    window.petAPI?.onScale((s) => setScale(s))
    window.petAPI?.onSkin((v) => {
      setSkin(v.skin)
      setForm(v.form)
      localStorage.setItem('pet-skin', v.skin)
      localStorage.setItem('pet-form', v.form)
    })
  }, [bumpInteract])

  // 启动时把持久化的皮肤同步给主进程（菜单勾选状态）
  useEffect(() => {
    window.petAPI?.skinChanged({ skin, form })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 未读消息：带 chatId 的消息提醒会挂着不消失，直到点气泡跳过去看
  const [unread, setUnread] = useState<{ n: number; chatId?: string; label: string }>({
    n: 0,
    label: '',
  })
  const seenMsgTs = useRef(0)
  useEffect(() => {
    const ev = current
    if (!ev.chatId) return
    if (['system', 'auto', 'demo', 'local', 'menu'].includes(ev.source ?? '')) return
    if (ev.ts <= seenMsgTs.current) return
    seenMsgTs.current = ev.ts
    // 重启补投的旧消息（5 分钟前）不计未读，免得一开机就挂着气泡
    if (Date.now() - ev.ts > 5 * 60_000) return
    setUnread((u) => ({ n: u.n + 1, chatId: ev.chatId, label: ev.label ?? '' }))
  }, [current])

  const clearUnread = useRef(() => {})
  clearUnread.current = () => setUnread({ n: 0, label: '' })

  // 气泡：未读消息常驻直到点掉；普通状态事件 30 秒内可见；小体型时同步缩小避免超出窗口
  const introActive = now < introUntil
  const hasUnread = unread.n > 0
  const bubbleVisible =
    introActive || hasUnread || (Boolean(current.label) && now - current.ts < 30000)
  const bubbleScale = Math.min(1, Math.max(0.75, scale / 0.8))
  const bubbleBadge = introActive ? '自我介绍' : hasUnread ? `新消息 x${unread.n}` : meta.name
  const bubbleBadgeBg = introActive ? '#FF9EC6' : hasUnread ? '#FF4D4F' : meta.color
  const bubbleBadgeColor = introActive || hasUnread ? '#191919' : meta.textColor
  const bubbleText = introActive ? INTRO_TEXT : hasUnread ? unread.label : current.label
  // 消息类气泡可点击跳转飞书会话（自我介绍不可点）
  const bubbleClickable = !introActive && (hasUnread || Boolean(current.chatId))
  const bubbleChatId = hasUnread ? unread.chatId : current.chatId

  const onBubbleClick = () => {
    if (!bubbleClickable) return
    const chatId = bubbleChatId
    clearUnread.current()
    if (chatId) window.petAPI?.openChat(chatId)
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    drag.current = { x: e.screenX, y: e.screenY, moved: false }
    window.petAPI?.dragStart()
    const move = (ev: MouseEvent) => {
      if (!drag.current) return
      if (
        Math.abs(ev.screenX - drag.current.x) + Math.abs(ev.screenY - drag.current.y) >
        6
      ) {
        drag.current.moved = true
      }
      if (drag.current.moved) window.petAPI?.dragMove()
    }
    const up = () => {
      if (drag.current && !drag.current.moved) {
        if (clickTimer.current) {
          clearTimeout(clickTimer.current)
          clickTimer.current = null
          window.petAPI?.openAssistant()
        } else {
          clickTimer.current = setTimeout(() => {
            clickTimer.current = null
            bumpInteract('pat')
          }, 240)
        }
      }
      drag.current = null
      window.petAPI?.dragEnd()
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="relative h-screen w-screen select-none overflow-hidden">
      {/* 气泡台词（贴纸风，自动隐藏）：锚右对齐宠物，可向左舒展 */}
      <div
        className={`pointer-events-none absolute right-2 top-1 z-10 transition-all duration-300 ${
          bubbleVisible ? 'opacity-100' : '-translate-y-2 opacity-0'
        }`}
        style={{
          transform: `scale(${bubbleScale})`,
          transformOrigin: 'top right',
        }}
      >
        <div
          id={bubbleClickable ? 'pet-bubble-click' : undefined}
          onClick={onBubbleClick}
          title={bubbleClickable ? '点击跳转到飞书会话' : undefined}
          className={`relative rounded-2xl border-[3px] border-[#191919] bg-white px-3 py-2 shadow-[4px_4px_0_#191919] ${
            bubbleClickable ? 'pointer-events-auto cursor-pointer hover:bg-[#F0F5FF]' : ''
          }`}
          style={{ maxWidth: 'calc(100vw - 16px)' }}
        >
          <div
            className="absolute -top-2.5 right-3 rounded border-2 border-[#191919] px-1.5 text-[10px] font-black"
            style={{ background: bubbleBadgeBg, color: bubbleBadgeColor }}
          >
            {bubbleBadge}
          </div>
          <p className="pt-1 text-left text-xs font-bold leading-snug text-[#191919]">
            {bubbleText}
            {bubbleClickable && <span className="text-[#2B5CFF]"> ↗</span>}
          </p>
          <div className="absolute -bottom-[9px] right-6 h-3.5 w-3.5 rotate-45 border-b-[3px] border-r-[3px] border-[#191919] bg-white" />
        </div>
      </div>

      {/* 宠物本体锚定右下：按住拖动，单击摸头，右键菜单 */}
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={(event) => {
          event.preventDefault()
          if (clickTimer.current) {
            clearTimeout(clickTimer.current)
            clickTimer.current = null
          }
          window.petAPI?.openAssistant()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          window.petAPI?.openMenu()
        }}
        className="absolute bottom-2 right-2 cursor-grab active:cursor-grabbing"
        title="单击摸头，双击打开小绝助手"
      >
        <PetStage
          state={current.state}
          stateSince={stateSince}
          interact={interact}
          scale={scale}
          skin={skin}
          form={form}
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<PetWindow />)
