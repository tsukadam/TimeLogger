import { useRef, useState, type CSSProperties } from 'react'
import { useOutsideClose } from '../../lib/useOutsideClose'
import styles from '../LogScreen.module.css'
import { ChartTip } from './ChartTip'
import type { Slice } from './types'

// 円グラフのスイープ描画にかける時間（ラベルはこの後にフェードイン）
const SWEEP_MS = 350

export function Donut({
  slices,
  totalSec,
  draw = true,
}: {
  slices: Slice[]
  totalSec: number
  /** false の間は下地の輪だけ描く（タブ切替アニメ中の負荷回避） */
  draw?: boolean
}) {
  const [tip, setTip] = useState<Slice | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // 期間が変われば key で再マウントされるので、slices の同一性変化では消さない
  // （記録中は毎秒再レンダーされ、出した瞬間にチップが消えてしまうため）
  useOutsideClose(wrapRef, tip !== null, () => setTip(null))
  const LABEL_FS = 11
  // ラベル文字列が外へ伸びる分のパディングを含めた viewBox
  const SIDE_PAD = 64
  const CORE_W = 300
  const VB_W = CORE_W + SIDE_PAD * 2
  const HOLE = 24
  const RING_OUT = 70
  const R = (RING_OUT + HOLE) / 2
  const STROKE = RING_OUT - HOLE
  // 水平線の終端とラベルの間の余白（棒の始点と円のパディングにも使う）
  const LABEL_PAD = 4
  // 伸ばし棒の始点: 円の外周から LABEL_PAD だけ外側
  const LEADER_START_R = RING_OUT + LABEL_PAD
  // 外周B（Basic）: 左右にずらす前の基準半径。ここまで放射状に棒を伸ばす
  // 始点パディングの分だけ全体も外側にずれる
  const BASE_R = RING_OUT + LABEL_FS * 1.2 + LABEL_PAD
  // 外周R/L: 外周Bを左右へずらした円。ラベルはこの上に載る
  const LR_ADJUST = 18
  // 上下はラベル1行分の半分程度あれば足りる
  const Y_PAD = Math.ceil(LABEL_FS * 0.55)
  const VB_H = (BASE_R + Y_PAD) * 2
  const CX = VB_W / 2
  const CY = VB_H / 2
  const C = 2 * Math.PI * R

  type Callout = {
    id: string
    name: string
    tx: number
    ty: number
    anchor: 'start' | 'end'
    // 伸ばし棒: パイ外縁 →（放射状）→ 外周B →（水平）→ ラベル手前
    points: string
  }

  const callouts: Callout[] = []
  let acc = 0
  for (const s of slices) {
    const frac = totalSec > 0 ? s.sec / totalSec : 0
    if (frac <= 0) continue
    // 0度 = 真上（-90 で SVG の右起点を上へ回す）
    const startDeg = (acc / Math.max(totalSec, 1)) * 360
    const midDeg = startDeg + frac * 180
    acc += s.sec
    const midRad = ((midDeg - 90) * Math.PI) / 180
    const cos = Math.cos(midRad)
    const sin = Math.sin(midRad)
    const onRight = cos >= 0
    const dir = onRight ? 1 : -1
    // 放射部: パイ外縁の少し外（パディング分）から外周Bまで
    const px = CX + cos * LEADER_START_R
    const py = CY + sin * LEADER_START_R
    const bx = CX + cos * BASE_R
    const by = CY + sin * BASE_R
    // 水平部: LR_ADJUST からラベル余白を引いた長さ
    const hx = bx + dir * (LR_ADJUST - LABEL_PAD)
    // ラベルは外周R/L（外周Bを左右にずらした円）上
    const tx = bx + dir * LR_ADJUST
    callouts.push({
      id: s.id,
      name: s.name.length > 10 ? `${s.name.slice(0, 9)}…` : s.name,
      tx,
      ty: by,
      // 右: 左寄せ（文字は外へ）／ 左: 右寄せ（文字は外へ）
      anchor: onRight ? 'start' : 'end',
      points: `${px},${py} ${bx},${by} ${hx},${by}`,
    })
  }

  let drawAcc = 0

  return (
    <div className={styles.donutWrap} ref={wrapRef}>
      <svg
        className={styles.donut}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
      >
        <circle
          r={R}
          cx={CX}
          cy={CY}
          fill="none"
          stroke="var(--panel-2)"
          strokeWidth={STROKE}
        />
        {draw &&
          slices.map((s) => {
            const frac = totalSec > 0 ? s.sec / totalSec : 0
            const startFrac = drawAcc / Math.max(totalSec, 1)
            const rot = startFrac * 360
            drawAcc += s.sec
            return (
              <circle
                key={s.id}
                r={R}
                cx={CX}
                cy={CY}
                fill="none"
                stroke={s.color}
                strokeWidth={STROKE}
                strokeDasharray={`${frac * C} ${C}`}
                transform={`rotate(${rot - 90} ${CX} ${CY})`}
                className={styles.donutSlice}
                style={
                  {
                    '--c': `${C}`,
                    '--target': `${frac * C}`,
                    // 真上から時計回りに一周伸びていくスイープ
                    animationDelay: `${startFrac * SWEEP_MS}ms`,
                    animationDuration: `${Math.max(frac * SWEEP_MS, 1)}ms`,
                  } as CSSProperties
                }
                onClick={() => setTip((cur) => (cur?.id === s.id ? null : s))}
              />
            )
          })}
        {draw &&
          callouts.map((c) => (
            <g key={c.id} className={styles.callout}>
              <polyline
                points={c.points}
                fill="none"
                stroke="var(--muted)"
                strokeWidth={1}
              />
              <text
                x={c.tx}
                y={c.ty + LABEL_FS * 0.32}
                textAnchor={c.anchor}
                className={styles.donutLabel}
              >
                {c.name}
              </text>
            </g>
          ))}
      </svg>
      <ChartTip tip={tip} onClose={() => setTip(null)} />
    </div>
  )
}
