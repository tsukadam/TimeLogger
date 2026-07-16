import { formatDurationHms } from '../../lib/time'
import chrome from '../../components/screenChrome.module.css'
import styles from '../LogScreen.module.css'
import { Donut } from './Donut'
import type { Slice } from './types'

/** Tasks / Genres 共用の円グラフ＋一覧表 */
export function SliceBreakdown({
  title,
  tableSlices,
  pieSlices,
  totalSec,
  draw,
  chartKey,
}: {
  title: string
  tableSlices: Slice[]
  pieSlices: Slice[]
  totalSec: number
  draw: boolean
  chartKey: string
}) {
  return (
    <>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {totalSec === 0 ? (
        <p className={chrome.status}>No Data</p>
      ) : (
        <>
          <div className={styles.pieCenter}>
            <Donut
              key={chartKey}
              slices={pieSlices}
              totalSec={totalSec}
              draw={draw}
            />
          </div>
          <table className={styles.table}>
            <tbody>
              {tableSlices.map((s) => (
                <tr key={s.id}>
                  <td className={styles.tdDot}>
                    <span
                      className={styles.dot}
                      style={{ background: s.color }}
                    />
                  </td>
                  <td className={styles.tdName}>{s.name}</td>
                  <td className={styles.tdTime}>
                    {formatDurationHms(s.sec)}
                  </td>
                  <td className={styles.tdPct}>
                    {((s.sec / Math.max(totalSec, 1)) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}
