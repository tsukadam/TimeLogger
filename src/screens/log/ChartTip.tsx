import { formatDurationHms } from '../../lib/time'
import styles from '../LogScreen.module.css'
import type { Slice } from './types'

/** タップで出すタスク名チップ（スマホはホバーがないため） */
export function ChartTip({
  tip,
  onClose,
}: {
  tip: Slice | null
  onClose: () => void
}) {
  if (!tip) return null
  return (
    <button type="button" className={styles.chartTip} onClick={onClose}>
      <span className={styles.dot} style={{ background: tip.color }} />
      <span>{tip.name}</span>
      <span className={styles.chartTipTime}>{formatDurationHms(tip.sec)}</span>
    </button>
  )
}
