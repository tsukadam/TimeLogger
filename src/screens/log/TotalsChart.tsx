import { useRef, useState } from 'react'
import { useOutsideClose } from '../../lib/useOutsideClose'
import { StackBars, type StackBarCol } from './StackBars'
import type { Slice, TotalCol } from './types'

export function TotalsChart({
  columns,
  draw = true,
}: {
  columns: TotalCol[]
  /** false の間は下地トラックだけ描く（タブ切替アニメ中の負荷回避） */
  draw?: boolean
}) {
  const [tip, setTip] = useState<{ key: string; slice: Slice } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useOutsideClose(wrapRef, tip !== null, () => setTip(null))

  const stackCols: StackBarCol[] = columns.map((col) => {
    let acc = 0
    return {
      key: col.key,
      label: col.label,
      segs: col.parts.map((p) => {
        const bottom = (acc / col.spanSec) * 100
        acc += p.sec
        const segKey = `${col.key}:${p.id}`
        return {
          key: p.id,
          bottomPct: bottom,
          heightPct: (p.sec / col.spanSec) * 100,
          color: p.color,
          variant: 'total' as const,
          onClick: () =>
            setTip((cur) =>
              cur?.key === segKey ? null : { key: segKey, slice: p },
            ),
        }
      }),
    }
  })

  return (
    <StackBars
      columns={stackCols}
      draw={draw}
      tip={tip?.slice ?? null}
      onCloseTip={() => setTip(null)}
      wrapRef={wrapRef}
    />
  )
}
