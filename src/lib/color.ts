/** #RRGGBB → 同系色候補（色相・彩度・明度を細かく刻む） */
export function relatedColorsFrom(baseHex: string, count = 6): string[] {
  const hsl = hexToHsl(baseHex)
  if (!hsl) return Array.from({ length: Math.max(1, count) }, () => baseHex)

  const out: string[] = []
  for (let i = 0; i < count; i++) {
    // 左右交互に 1.5° ずつ広げる／S・L はごくわずかに揺らす
    const step = Math.ceil(i / 2)
    const sign = i === 0 ? 0 : i % 2 === 0 ? 1 : -1
    const dh = sign * step * 1.5
    const ds = sign * step * 0.012
    const dl = (i % 2 === 0 ? 1 : -1) * step * 0.01
    out.push(
      hslToHex(
        (hsl.h + dh + 360) % 360,
        clamp(hsl.s + ds, 0.25, 0.92),
        clamp(hsl.l + dl, 0.32, 0.68),
      ),
    )
  }
  return out
}

/** パレット幅から、ピッカー1つ分を残して入る候補数 */
export function paletteCountForWidth(widthPx: number): number {
  const swatch = 28
  const gap = 8
  const picker = 28
  // n swatches + 1 picker, gaps between items: n
  // (n+1)*swatch + n*gap <= width
  const n = Math.floor((widthPx - picker) / (swatch + gap))
  return Math.max(4, Math.min(24, n))
}

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
