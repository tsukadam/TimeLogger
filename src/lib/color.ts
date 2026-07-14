function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = Number.parseInt(m[1]!, 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60
      break
    case g:
      h = ((b - r) / d + 2) * 60
      break
    default:
      h = ((r - g) / d + 4) * 60
  }
  return { h, s, l }
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

function normalizeHex(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  return `#${m[1]!.toLowerCase()}`
}

/**
 * 明暗: 暗2 / 暗1 / 元 / 明
 * 明は弱め（旧 +2 → +1）
 */
const L_LEVELS = [-4, -2, 0, 1] as const
const L_DELTA = 0.062
/** 彩度: 下げ / 基準 / 上げ */
const S_DELTAS = [-0.14, 0, 0.14] as const
/** 色相1段（弱め） */
const HUE_SHIFT = 8
const HUE_ROW_OFFSETS = [-2, -1, 0, 1, 2] as const

/**
 * 1行12色。
 * 彩度グループごとに: 暗2 → 暗1 → 元 → 明
 * 全体: [S↓の4] [S基準の4] [S↑の4]
 */
function buildRow(h: number, baseS: number, baseL: number): string[] {
  const out: string[] = []
  for (const ds of S_DELTAS) {
    const s = clamp(baseS + ds, 0.12, 0.95)
    for (const li of L_LEVELS) {
      const l = clamp(baseL + li * L_DELTA, 0.16, 0.84)
      out.push(hslToHex(h, s, l))
    }
  }
  return out
}

/** 中央行・基準彩度グループの「元」マス index = 1*4 + 2 */
export const TASK_BASE_CELL = { row: 2, col: 6 } as const

/**
 * タスク色グリッド 5行×12列
 * - 中央行・元マス = フォルダ色
 * - 「＋」は UI 側で右下にはみ出し
 */
export function taskColorGrid(baseHex: string): string[][] {
  const base = normalizeHex(baseHex)
  const hsl = hexToHsl(base) ?? { h: 30, s: 0.62, l: 0.55 }

  return HUE_ROW_OFFSETS.map((off, rowIndex) => {
    const h = (hsl.h + off * HUE_SHIFT + 360) % 360
    const row = buildRow(h, hsl.s, hsl.l)
    if (rowIndex === TASK_BASE_CELL.row) {
      row[TASK_BASE_CELL.col] = base
    }
    return row
  })
}

/** タスク色がフォルダ基準グリッド上のどのマスか（カスタムなら null） */
export function findTaskColorPos(
  folderColor: string,
  taskColor: string,
): { row: number; col: number } | null {
  const grid = taskColorGrid(folderColor)
  const target = normalizeHex(taskColor).toLowerCase()
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row]!.length; col++) {
      if (grid[row]![col]!.toLowerCase() === target) {
        return { row, col }
      }
    }
  }
  return null
}

/**
 * フォルダ色変更時、候補マス由来なら同位置の新色へ。
 * ピッカー色（グリッドに無い）はそのまま → null。
 */
export function remapPaletteTaskColor(
  oldFolderColor: string,
  newFolderColor: string,
  taskColor: string,
): string | null {
  const pos = findTaskColorPos(oldFolderColor, taskColor)
  if (!pos) return null
  return taskColorGrid(newFolderColor)[pos.row]![pos.col]!
}

export const DEFAULT_PALETTE = [
  '#e08a3c',
  '#5bb98c',
  '#5b8de2',
  '#c45c9a',
  '#c9b458',
  '#e25b5b',
  '#8b8f98',
  '#6bc4c4',
  '#d2783a',
  '#7a8cff',
  '#d4a0c8',
  '#a8c45c',
]

/** フォルダ用デフォルト色（適当な固定パレット） */
export const FOLDER_PALETTE = [
  '#e08a3c',
  '#5bb98c',
  '#5b8de2',
  '#c45c9a',
  '#c9b458',
  '#e25b5b',
  '#6a9a8b',
  '#b89b6a',
  '#7d8bb8',
  '#a67c7c',
  '#8a9e6e',
  '#9a8ab0',
]
