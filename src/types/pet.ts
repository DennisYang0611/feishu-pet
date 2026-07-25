export type PetState =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'success'
  | 'error'
  | 'sleeping'

export interface PetEvent {
  state: PetState
  label?: string
  ts: number
  source?: string
  /** 飞书会话 id（oc_xxx），气泡点击可跳转到对应聊天 */
  chatId?: string
}

export interface PetReport {
  text: string
  trigger?: string
  ts: number
  source?: string
}

export const PET_STATES: PetState[] = [
  'idle',
  'thinking',
  'working',
  'success',
  'error',
  'sleeping',
]

export const STATE_META: Record<
  PetState,
  { name: string; color: string; textColor: string; desc: string }
> = {
  idle: {
    name: '待机',
    color: '#2B5CFF',
    textColor: '#ffffff',
    desc: '等 bot 召唤',
  },
  thinking: {
    name: '理解中',
    color: '#8B5CF6',
    textColor: '#ffffff',
    desc: 'bot 在理解你的意图',
  },
  working: {
    name: '干活中',
    color: '#FF8A00',
    textColor: '#191919',
    desc: 'bot 正在执行任务',
  },
  success: {
    name: '搞定',
    color: '#9BE83A',
    textColor: '#191919',
    desc: '任务完成',
  },
  error: {
    name: '出错了',
    color: '#FF4D4F',
    textColor: '#ffffff',
    desc: '任务失败 / 需要人工介入',
  },
  sleeping: {
    name: '摸鱼中',
    color: '#94A3B8',
    textColor: '#191919',
    desc: '长时间无任务',
  },
}
