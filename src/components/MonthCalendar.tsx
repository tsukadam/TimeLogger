import {
  addDaysKey,
  addMonthsKey,
  daysInMonth,
  pad2,
  todayKey,
} from '../lib/time'
import styles from './MonthCalendar.module.css'

export const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const

/** 月曜始まりの月グリッド（YYYY-MM-DD | null） */
export function buildMonthCells(y: number, m: number): (string | null)[] {
  const padLead = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const dim = daysInMonth(y, m)
  const cells: (string | null)[] = [
    ...Array.from({ length: padLead }, () => null),
    ...Array.from(
      { length: dim },
      (_, i) => `${y}-${pad2(m)}-${pad2(i + 1)}`,
    ),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export type MonthCalendarMode = 'single' | 'day' | 'week' | 'month' | 'custom'

export type MonthCalendarProps = {
  viewYm: { y: number; m: number }
  onViewYm: (v: { y: number; m: number }) => void
  mode: MonthCalendarMode
  /** single / day */
  selectedDay?: string
  selectedWeekStart?: string
  selectedMonthStart?: string
  highlightStart?: string
  highlightEnd?: string
  onPickDay: (dayKey: string) => void
  /** Log 用。false なら月送りだけ（DateField） */
  showYearNav?: boolean
  maxYear?: number
}

/**
 * 月曜始まりの月カレンダー。
 * DateField（単一日）と Log 期間ピッカー（帯ハイライト）で共用。
 */
export function MonthCalendar({
  viewYm,
  onViewYm,
  mode,
  selectedDay,
  selectedWeekStart,
  selectedMonthStart,
  highlightStart,
  highlightEnd,
  onPickDay,
  showYearNav = false,
  maxYear = 9999,
}: MonthCalendarProps) {
  const cells = buildMonthCells(viewYm.y, viewYm.m)

  const shiftMonth = (d: number) => {
    let m = viewYm.m + d
    let y = viewYm.y
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    onViewYm({ y, m })
  }

  const shiftYear = (d: number) => {
    const y = Math.min(maxYear, Math.max(1970, viewYm.y + d))
    onViewYm({ y, m: viewYm.m })
  }

  const hs =
    highlightStart && highlightEnd
      ? highlightStart <= highlightEnd
        ? highlightStart
        : highlightEnd
      : highlightStart
  const he =
    highlightStart && highlightEnd
      ? highlightStart <= highlightEnd
        ? highlightEnd
        : highlightStart
      : highlightEnd

  return (
    <div>
      <div className={styles.calHead}>
        {showYearNav ? (
          <div className={styles.calNav}>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => shiftYear(-1)}
            >
              «
            </button>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => shiftMonth(-1)}
            >
              ‹
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.arrow}
            onClick={() => shiftMonth(-1)}
          >
            ‹
          </button>
        )}
        <span className={styles.calTitle}>
          {viewYm.y}年{viewYm.m}月
        </span>
        {showYearNav ? (
          <div className={styles.calNav}>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => shiftMonth(1)}
            >
              ›
            </button>
            <button
              type="button"
              className={styles.arrow}
              disabled={viewYm.y >= maxYear}
              onClick={() => shiftYear(1)}
            >
              »
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.arrow}
            onClick={() => shiftMonth(1)}
          >
            ›
          </button>
        )}
      </div>
      <div className={styles.calWeekdays}>
        {WEEKDAY_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className={styles.calGrid}>
        {cells.map((day, i) => {
          if (!day) return <span key={`e${i}`} className={styles.calEmpty} />
          let selected = false
          let inBand = false
          if (mode === 'single' || mode === 'day') {
            selected = day === selectedDay
          }
          if (mode === 'week' && selectedWeekStart) {
            inBand =
              day >= selectedWeekStart &&
              day <= addDaysKey(selectedWeekStart, 6)
            selected = day === selectedWeekStart
          }
          if (mode === 'month' && selectedMonthStart) {
            inBand =
              day >= selectedMonthStart &&
              day < addMonthsKey(selectedMonthStart, 1)
            selected = day === selectedMonthStart
          }
          if (mode === 'custom' && hs && he) {
            inBand = day >= hs && day <= he
            selected = day === hs || day === he
          }
          return (
            <button
              key={day}
              type="button"
              className={[
                styles.calDay,
                inBand ? styles.calDayBand : '',
                selected ? styles.calDayOn : '',
                day === todayKey() ? styles.calToday : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onPickDay(day)}
            >
              {Number(day.slice(8, 10))}
            </button>
          )
        })}
      </div>
    </div>
  )
}
