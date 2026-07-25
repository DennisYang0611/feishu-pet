import type { PetState } from '@/types/pet'

/**
 * 像素宠物「小绝」—— 与飞书绝活大会点位海报同一套视觉语言：
 * 像素主体 + 黑色粗描边 + 白色贴纸外框（由 CSS drop-shadow 实现）+ 网格纸底。
 *
 * 网格字符表：
 *  K 黑描边  W 白色毛发  p 粉色内耳  b 腮红  G 亮绿项圈  . 透明
 */

export const GRID_W = 22
export const GRID_H = 22

export const BODY: string[] = [
  '....KK..........KK....',
  '...KWWK........KWWK...',
  '...KWpK........KpWK...',
  '..KWWWKKKKKKKKKKWWWK..',
  '.KWWWWWWWWWWWWWWWWWWK.',
  '.KWWWWWWWWWWWWWWWWWWK.',
  'KWWWWWWWWWWWWWWWWWWWWK',
  'KWWWWWWWWWWWWWWWWWWWWK',
  'KbbWWWWWWWWWWWWWWWWbbK',
  'KWWWWWWWWWKKWWWWWWWWK.',
  'KWWWWWWWWKWWKWWWWWWWWK',
  '.KWWWWWWWWKKWWWWWWWWK.',
  '.KWWWWWWWWWWWWWWWWWWK.',
  '..KKKKKKKKKKKKKKKKKK..',
  '..KWWGGGGGGGGGGGGWWK..',
  '..KWGGGGGGGGGGGGGGWK..',
  '..KWWWWWWWWWWWWWWWWK..',
  '.KWWKWWWWWWWWWWWWKWWK.',
  '.KWWKWWWWWWWWWWWWKWWK.',
  '..KKKWWWWWWWWWWWWKKK..',
  '....KWWWWWWWWWWWWK....',
  '....KKKKKKKKKKKK......',
]

/** 幼年形态：大头短身小奶猫，与成年同一落地线（底部行对齐） */
export const BODY_BABY: string[] = [
  '......................',
  '......................',
  '......................',
  '......................',
  '......................',
  '......................',
  '....KK..........KK....',
  '...KWWK........KWWK...',
  '...KWpK........KpWK...',
  '..KWWWKKKKKKKKKKWWWK..',
  '.KWWWWWWWWWWWWWWWWWWK.',
  '.KWWWWWWWWWWWWWWWWWWK.',
  'KWWWWWWWWWWWWWWWWWWWWK',
  'KbbWWWWWWWWWWWWWWWWbbK',
  'KWWWWWWWWWWKKWWWWWWWWK',
  '.KWWWWWWWWWWWWWWWWWWK.',
  '..KKKKKKKKKKKKKKKKKK..',
  '...KWWGGGGGGGGGGWWK...',
  '..KWWWWWWWWWWWWWWWWK..',
  '..KWWKWWWWWWWWWWKWWK..',
  '...KKKWWWWWWWWWWKKK...',
  '......KKKKKKKKKK......',
]

export const LAPTOP: string[] = [
  'KKKKKKKKKKKKKK',
  'KTTTTTTTTTTTTK',
  'KTTTTTTTTTTTTK',
  'KTTTTTTTTTTTTK',
  'KKKKKKKKKKKKKK',
  '..KKKKKKKKKK..',
]

export const HEART: string[] = [
  '.RR.RR.',
  'RRRRRRR',
  'RRRRRRR',
  '.RRRRR.',
  '..RRR..',
  '...R...',
]

export const STAR: string[] = ['..Y..', '.YYY.', 'YYYYY', '.YYY.', '..Y..']

const PALETTE: Record<string, string> = {
  K: '#191919',
  W: '#FFFFFF',
  p: '#FF9EC6',
  b: '#FFB3C7',
  G: '#9BE83A',
  T: '#14202E',
  R: '#FF4D6D',
  Y: '#FFD60A',
  S: '#9BE83A', // 屏幕代码绿
}

export type EyeMode = 'open' | 'blink' | 'happy' | 'dizzy' | 'closed'

/** 眼睛 3x3 盒子左上角（网格坐标） */
const EYE_LEFT = { x: 5, y: 6 }
const EYE_RIGHT = { x: 14, y: 6 }
/** 幼年眼睛位置更低，且画成 2x3 的豆豆大眼 */
const EYE_LEFT_BABY = { x: 5, y: 11 }
const EYE_RIGHT_BABY = { x: 14, y: 11 }

function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: string[],
  ox: number,
  oy: number,
  s: number,
) {
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === '.') continue
      const color = PALETTE[ch]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect((ox + x) * s, (oy + y) * s, s, s)
    }
  })
}

function px(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  s: number,
  color: string,
) {
  ctx.fillStyle = color
  ctx.fillRect(gx * s, gy * s, s, s)
}

function drawEye(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  mode: EyeMode,
  baby = false,
) {
  const X = (dx: number, dy: number, c: string) =>
    px(ctx, ox + dx, oy + dy, s, c)
  if (mode === 'open') {
    X(0, 0, '#FFFFFF'); X(1, 0, '#191919')
    X(0, 1, '#191919'); X(1, 1, '#191919')
    if (baby) { X(0, 2, '#191919'); X(1, 2, '#191919') } // 幼年豆豆大眼
  } else if (mode === 'blink' || mode === 'closed') {
    X(0, 1, '#191919'); X(1, 1, '#191919')
  } else if (mode === 'happy') {
    X(0, 1, '#191919'); X(1, 0, '#191919')
  } else if (mode === 'dizzy') {
    X(0, 0, '#191919'); X(1, 1, '#191919'); X(2, 0, '#191919')
    X(0, 2, '#191919'); X(2, 2, '#191919')
  }
}

export interface PetDrawOptions {
  state: PetState
  eyes: EyeMode
  /** 0..1 动画进度，用于屏幕闪烁、打字爪 */
  tick: number
  /** 网格坐标偏移（抖动/跳动由调用方加） */
  ox?: number
  oy?: number
  /** 幼年 / 成年形态（默认成年） */
  form?: 'baby' | 'adult'
}

export function drawPet(
  ctx: CanvasRenderingContext2D,
  s: number,
  opts: PetDrawOptions,
) {
  const ox = opts.ox ?? 0
  const oy = opts.oy ?? 0
  const baby = opts.form === 'baby'

  // 本体
  ctx.save()
  if (opts.state === 'thinking') {
    // 歪头：轻微旋转
    const cx = (GRID_W / 2) * s
    const cy = 11 * s
    ctx.translate(cx, cy)
    ctx.rotate(Math.sin(opts.tick / 900) * 0.06)
    ctx.translate(-cx, -cy)
  }
  drawGrid(ctx, baby ? BODY_BABY : BODY, ox, oy, s)
  const eyeMode: EyeMode =
    opts.state === 'sleeping' ? 'closed' : opts.state === 'error' ? 'dizzy' : opts.eyes
  const eyeL = baby ? EYE_LEFT_BABY : EYE_LEFT
  const eyeR = baby ? EYE_RIGHT_BABY : EYE_RIGHT
  drawEye(ctx, ox + eyeL.x, oy + eyeL.y, s, eyeMode, baby)
  drawEye(ctx, ox + eyeR.x, oy + eyeR.y, s, eyeMode, baby)
  ctx.restore()

  // 干活中：抱着笔记本敲代码
  if (opts.state === 'working') {
    const lx = ox + 4
    const ly = oy + 15
    drawGrid(ctx, LAPTOP, lx, ly, s)
    // 屏幕代码行闪烁
    const lines = [
      [2, 3, 6, 9],
      [1, 4, 5, 8, 11],
      [3, 7, 10],
    ]
    lines.forEach((segs, row) => {
      segs.forEach((col, i) => {
        const on = Math.floor(opts.tick / 300 + row * 2 + i) % 3 !== 0
        if (on) px(ctx, lx + col, ly + 1 + row, s, PALETTE.S)
        if (on && (i + row) % 2 === 0) px(ctx, lx + col + 1, ly + 1 + row, s, PALETTE.S)
      })
    })
    // 打字爪：两只爪子交替抬起
    const pawPhase = Math.floor(opts.tick / 180) % 2
    const pawY = ly - (pawPhase === 0 ? 2 : 1)
    const pawY2 = ly - (pawPhase === 0 ? 1 : 2)
    px(ctx, lx + 2, pawY, s, '#191919'); px(ctx, lx + 3, pawY, s, '#FFFFFF')
    px(ctx, lx + 10, pawY2, s, '#191919'); px(ctx, lx + 11, pawY2, s, '#FFFFFF')
  }
}

export function drawParticle(
  ctx: CanvasRenderingContext2D,
  grid: string[],
  gx: number,
  gy: number,
  s: number,
  alpha: number,
) {
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
  drawGrid(ctx, grid, gx, gy, s)
  ctx.restore()
}
