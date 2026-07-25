/**
 * 小绝 · 桌面宠物主进程
 *
 * 桌面宠物形态：
 *  - 透明无边框窗口，置顶悬浮，不占任务栏/Dock
 *  - 按住拖动，单击摸头，右键菜单（摸头/投喂/置顶/鼠标穿透/看板/退出）
 *  - 系统托盘常驻
 *  - 内嵌事件服务器（desktop/server.cjs），飞书 CLI 外挂协议不变
 */
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  screen,
  shell,
  nativeImage,
  globalShortcut,
} = require('electron')
const path = require('path')
const { startPetServer } = require('./server.cjs')

const PORT = Number(process.env.PET_PORT || 7100)

let win = null
let tray = null
let alwaysOnTop = true
let clickThrough = false
let dragOffset = null

// 体型档位：窗口尺寸 + 渲染缩放
const SIZES = {
  small: { w: 320, h: 200, scale: 0.4 },
  mid: { w: 380, h: 460, scale: 1.35 },
  big: { w: 520, h: 640, scale: 1.9 },
}
let currentSize = 'small'

// 皮肤与形态（渲染端 localStorage 持久化，启动时回传同步）
const SKIN_LIST = [
  { id: 'pixel', name: '小绝 · 像素猫' },
  { id: 'caishen', name: '财神到' },
  { id: 'plant', name: '小绿芽' },
  { id: 'unicorn', name: '彩虹独角兽' },
  { id: 'plane', name: '飞飞 · 小飞机' },
]
const FORM_LIST = [
  { id: 'baby', name: '幼年形态' },
  { id: 'adult', name: '成年形态' },
]
let currentSkin = 'pixel'
let currentForm = 'adult'

function setSkin(patch) {
  if (patch.skin) currentSkin = patch.skin
  if (patch.form) currentForm = patch.form
  win?.webContents.send('set-skin', { skin: currentSkin, form: currentForm })
}

/** 小绝的绝活：让 watcher 去飞书捞消息干活 */
function runJob(command, label) {
  fetch(`http://localhost:${PORT}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, label, source: 'menu' }),
  }).catch(() => {})
}

function setSize(name) {
  currentSize = name
  const s = SIZES[name]
  if (!win || !s) return
  win.setSize(s.w, s.h)
  win.webContents.send('set-scale', s.scale)
}

function sendInteract(kind) {
  win?.webContents.send('interact', kind)
}

/** 鼠标穿透开关（菜单和全局快捷键共用） */
function setClickThrough(flag) {
  clickThrough = flag
  win?.setIgnoreMouseEvents(clickThrough, { forward: true })
  // 气泡提示一句，免得用户以为猫死了
  fetch(`http://localhost:${PORT}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: 'idle',
      label: clickThrough ? '穿透已开 · 按 ⌘⌥P 或托盘菜单恢复' : '穿透已关，又能摸我啦',
      source: 'system',
    }),
  }).catch(() => {})
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '✨ 小绝的自我介绍', click: () => win?.webContents.send('show-intro') },
    { type: 'separator' },
    { label: '摸摸头', click: () => sendInteract('pat') },
    { label: '投喂食物', click: () => sendInteract('feed') },
    { type: 'separator' },
    {
      label: '小绝的绝活',
      submenu: [
        { label: '整理今日待办事项', click: () => runJob('todo', '整理今日待办') },
        { type: 'separator' },
        { label: '总结过去 6 小时消息', click: () => runJob('summary:6', '6 小时消息总结') },
        { label: '总结过去 12 小时消息', click: () => runJob('summary:12', '12 小时消息总结') },
        { label: '总结过去 24 小时消息', click: () => runJob('summary:24', '24 小时消息总结') },
      ],
    },
    { type: 'separator' },
    {
      label: '🌈 皮肤',
      submenu: SKIN_LIST.map((s) => ({
        label: s.name,
        type: 'radio',
        checked: currentSkin === s.id,
        click: () => setSkin({ skin: s.id }),
      })),
    },
    {
      label: '形态',
      submenu: FORM_LIST.map((f) => ({
        label: f.name,
        type: 'radio',
        checked: currentForm === f.id,
        click: () => setSkin({ form: f.id }),
      })),
    },
    { type: 'separator' },
    {
      label: '体型',
      submenu: [
        {
          label: '小（不碍事）',
          type: 'radio',
          checked: currentSize === 'small',
          click: () => setSize('small'),
        },
        {
          label: '中',
          type: 'radio',
          checked: currentSize === 'mid',
          click: () => setSize('mid'),
        },
        {
          label: '大（盯着看）',
          type: 'radio',
          checked: currentSize === 'big',
          click: () => setSize('big'),
        },
      ],
    },
    { type: 'separator' },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: alwaysOnTop,
      click: (item) => {
        alwaysOnTop = item.checked
        win?.setAlwaysOnTop(alwaysOnTop, 'screen-saver')
      },
    },
    {
      label: '鼠标穿透（挂着不碍事）⌘⌥P',
      type: 'checkbox',
      checked: clickThrough,
      click: (item) => setClickThrough(item.checked),
    },
    { type: 'separator' },
    {
      label: '打开调试看板',
      click: () => shell.openExternal(`http://localhost:${PORT}/`),
    },
    {
      label: '退出小绝',
      click: () => app.quit(),
    },
  ])
}

function createWindow() {
  const s = SIZES[currentSize]
  win = new BrowserWindow({
    width: s.w,
    height: s.h,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setMenu(null)
  // 初始位置：屏幕右下角
  const { workAreaSize } = screen.getPrimaryDisplay()
  win.setPosition(workAreaSize.width - s.w - 40, workAreaSize.height - s.h - 40)
  win.loadFile(path.join(__dirname, '..', 'dist', 'pet.html'))
  // 加载完成后同步当前体型（否则渲染端用默认缩放）
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('set-scale', SIZES[currentSize].scale)
    // 自检：PET_SKIN=caishen PET_FORM=baby 强制皮肤
    if (process.env.PET_SKIN) {
      win?.webContents.send('set-skin', {
        skin: process.env.PET_SKIN,
        form: process.env.PET_FORM || 'adult',
      })
    }
    // 自检：PET_INTRO=1 触发自我介绍气泡
    if (process.env.PET_INTRO) {
      setTimeout(() => win?.webContents.send('show-intro'), 800)
    }
  })

  // 自检截图：PET_SHOT=/path.png 时加载完成后截一张窗口图
  if (process.env.PET_SHOT) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win.webContents.capturePage()
        require('fs').writeFileSync(process.env.PET_SHOT, img.toPNG())
        console.log('🐾 自检截图已保存:', process.env.PET_SHOT)
      }, Number(process.env.PET_SHOT_DELAY || 1500))
    })
  }

  win.on('closed', () => {
    win = null
  })
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'))
  tray = new Tray(icon.resize({ width: 22 }))
  tray.setToolTip('小绝 · 飞书干活宠物')
  tray.setContextMenu(buildMenu())
  tray.on('click', () => {
    if (!win) return createWindow()
    win.isVisible() ? win.hide() : win.show()
  })
}

// —— 拖拽（renderer 报告开始/移动，主进程算位置） ——
ipcMain.on('drag-start', () => {
  if (!win) return
  const cursor = screen.getCursorScreenPoint()
  const [wx, wy] = win.getPosition()
  dragOffset = { x: cursor.x - wx, y: cursor.y - wy }
})
ipcMain.on('drag-move', () => {
  if (!win || !dragOffset) return
  const cursor = screen.getCursorScreenPoint()
  win.setPosition(cursor.x - dragOffset.x, cursor.y - dragOffset.y)
})
ipcMain.on('drag-end', () => {
  dragOffset = null
})
ipcMain.on('context-menu', () => {
  buildMenu().popup({ window: win })
})
ipcMain.on('skin-changed', (_e, v) => {
  if (v?.skin) currentSkin = v.skin
  if (v?.form) currentForm = v.form
})

// —— 像素级点击穿透：透明区域放行鼠标，只有点在宠物本体上才吃事件 ——
// 渲染端定期上报画布的 alpha 遮罩（hit-mask），主进程轮询光标位置对照
const CANVAS_PX = 264 // PetStage 画布 22 格 × 12px
let hitMask = null // { w, h, scale, data:Uint8Array }
let hitIgnoring = false
ipcMain.on('hit-mask', (_e, m) => {
  if (m && m.w && m.h && m.data) hitMask = m
})
ipcMain.on('open-chat', (_e, chatId) => {
  if (typeof chatId === 'string' && chatId.startsWith('oc_')) {
    shell.openExternal(
      `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(chatId)}`,
    )
  }
})
function pollHitTest() {
  if (!win) return
  // 手动穿透模式 / 拖拽中不干预
  if (clickThrough || dragOffset) return
  let inside = false
  if (hitMask) {
    const b = win.getBounds()
    const c = screen.getCursorScreenPoint()
    if (c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height) {
      const rx = c.x - b.x
      const ry = c.y - b.y
      // 消息气泡可点击（跳飞书会话）
      const bb = hitMask.bubble
      if (bb && rx >= bb.x && rx < bb.x + bb.w && ry >= bb.y && ry < bb.y + bb.h) {
        inside = true
      } else {
        const s = hitMask.scale || 1
        const cssSize = CANVAS_PX * s
        const left = b.width - 8 - cssSize // pet 容器 right-2 bottom-2
        const top = b.height - 8 - cssSize
        const lx = rx - left
        const ly = ry - top
        if (lx >= 0 && ly >= 0 && lx < cssSize && ly < cssSize) {
          const mx = Math.floor((lx / s) * (hitMask.w / CANVAS_PX))
          const my = Math.floor((ly / s) * (hitMask.h / CANVAS_PX))
          inside = !!hitMask.data[my * hitMask.w + mx]
        }
      }
    }
    win.setIgnoreMouseEvents(!inside, { forward: true })
    hitIgnoring = !inside
  } else if (hitIgnoring) {
    win.setIgnoreMouseEvents(false)
    hitIgnoring = false
  }
}
setInterval(pollHitTest, 60)

app.whenReady().then(() => {
  app.dock?.hide() // 桌面宠物：不占 Dock
  startPetServer({
    port: PORT,
    distDir: path.join(__dirname, '..', 'dist'),
  })
  createWindow()
  createTray()

  // 全局快捷键：⌘⌥P 切换鼠标穿透（穿透开了之后的逃生通道）
  globalShortcut.register('CommandOrControl+Alt+P', () => {
    setClickThrough(!clickThrough)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 单实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => win?.show())
}

app.on('window-all-closed', () => {
  // 宠物常驻：窗口全关也不退出，靠托盘菜单退出
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
