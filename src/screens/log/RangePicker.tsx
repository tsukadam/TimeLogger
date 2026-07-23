import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { MonthCalendar } from '../../components/MonthCalendar'
import calStyles from '../../components/MonthCalendar.module.css'
import { MODAL_CLOSE_MS } from '../../components/Modal'
import form from '../../components/form.module.css'
import {
  formatYmd,
  monthKey,
  weekdayShort,
  ymParts,
  dayStartMs,
  DAY_MS,
} from '../../lib/time'
import { useScrollLock } from '../../lib/useScrollLock'
import type { LogPrefs } from '../../types'
import styles from '../LogScreen.module.css'
import { clampCustomGrain } from './prefs'

const MONTH_NAMES = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
]

export type SheetPos = { top: number; left: number; width: number }

function initDraft(prefs: LogPrefs, today: string): LogPrefs {
  if (prefs.kind === 'custom') {
    if (prefs.customApplied) {
      return {
        ...prefs,
        customStart: prefs.customApplied.start,
        customEnd: prefs.customApplied.end,
      }
    }
    return {
      ...prefs,
      customStart: today,
      customEnd: today,
    }
  }
  return prefs
}

function initViewYm(prefs: LogPrefs, today: string) {
  if (prefs.kind === 'day') return ymParts(prefs.day)
  if (prefs.kind === 'week') return ymParts(prefs.weekStart)
  if (prefs.kind === 'month') return ymParts(prefs.monthStart)
  if (prefs.kind === 'custom') {
    const s = prefs.customApplied?.start ?? prefs.customStart
    return ymParts(s)
  }
  return ymParts(today)
}

export function RangePicker({
  sheetPos,
  prefs,
  today,
  maxYear,
  onClose,
  onPersist,
}: {
  sheetPos: SheetPos
  prefs: LogPrefs
  today: string
  maxYear: number
  onClose: () => void
  onPersist: (next: LogPrefs) => void
}) {
  const [closing, setClosing] = useState(false)
  useScrollLock(true)
  const [draft, setDraft] = useState(() => initDraft(prefs, today))
  const [customTarget, setCustomTarget] = useState<'start' | 'end'>('start')
  const [viewYm, setViewYm] = useState(() => initViewYm(prefs, today))

  const requestClose = useCallback(() => {
    if (closing) return
    setClosing(true)
    window.setTimeout(() => {
      onClose()
    }, MODAL_CLOSE_MS)
  }, [closing, onClose])

  const applyPicker = () => {
    let next = { ...draft }
    if (draft.kind === 'custom') {
      const a =
        draft.customStart <= draft.customEnd
          ? draft.customStart
          : draft.customEnd
      const b =
        draft.customStart <= draft.customEnd
          ? draft.customEnd
          : draft.customStart
      const start = dayStartMs(a)
      const end = dayStartMs(b) + DAY_MS
      next = {
        ...draft,
        customStart: a,
        customEnd: b,
        customApplied: { start: a, end: b },
        customGrain: clampCustomGrain(draft.customGrain, start, end),
      }
    }
    onPersist(next)
    requestClose()
  }

  return createPortal(
    <div
      className={
        closing ? `${styles.modalRoot} ${styles.modalClosing}` : styles.modalRoot
      }
    >
      <button
        type="button"
        className={styles.modalBackdrop}
        aria-label="閉じる"
        onClick={requestClose}
      />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="期間を選ぶ"
        style={{
          top: sheetPos.top,
          left: sheetPos.left,
          width: sheetPos.width,
        }}
      >
        {draft.kind === 'custom' && (
          <div className={styles.customTargets}>
            <button
              type="button"
              className={
                customTarget === 'start'
                  ? styles.customTargetOn
                  : styles.customTarget
              }
              onClick={() => {
                setCustomTarget('start')
                setViewYm(ymParts(draft.customStart))
              }}
            >
              開始 {formatYmd(draft.customStart)}（
              {weekdayShort(draft.customStart)}）
            </button>
            <button
              type="button"
              className={
                customTarget === 'end'
                  ? styles.customTargetOn
                  : styles.customTarget
              }
              onClick={() => {
                setCustomTarget('end')
                setViewYm(ymParts(draft.customEnd))
              }}
            >
              終了 {formatYmd(draft.customEnd)}（
              {weekdayShort(draft.customEnd)}）
            </button>
          </div>
        )}

        {(draft.kind === 'day' ||
          draft.kind === 'week' ||
          draft.kind === 'month' ||
          draft.kind === 'custom') && (
          <MonthCalendar
            viewYm={viewYm}
            onViewYm={setViewYm}
            mode={draft.kind}
            selectedDay={draft.day}
            selectedWeekStart={draft.weekStart}
            selectedMonthStart={draft.monthStart}
            highlightStart={draft.customStart}
            highlightEnd={draft.customEnd}
            showYearNav
            maxYear={maxYear}
            onPickDay={(d) => {
              if (draft.kind === 'day') {
                setDraft({ ...draft, day: d })
                setViewYm(ymParts(d))
                onPersist({ ...prefs, day: d })
                requestClose()
              } else if (draft.kind === 'week') {
                setDraft({ ...draft, weekStart: d })
                setViewYm(ymParts(d))
                onPersist({ ...prefs, weekStart: d })
              } else if (draft.kind === 'month') {
                setDraft({ ...draft, monthStart: d })
                setViewYm(ymParts(d))
                onPersist({ ...prefs, monthStart: d })
              } else if (customTarget === 'start') {
                setDraft({
                  ...draft,
                  customStart: d,
                  customEnd: d > draft.customEnd ? d : draft.customEnd,
                })
              } else {
                setDraft({
                  ...draft,
                  customEnd: d,
                  customStart: d < draft.customStart ? d : draft.customStart,
                })
              }
            }}
          />
        )}

        {draft.kind === 'year' && (
          <div>
            <div className={calStyles.calHead}>
              <div className={calStyles.calNav}>
                <button
                  type="button"
                  className={calStyles.arrow}
                  onClick={() => {
                    const ys = ymParts(draft.yearStart)
                    setDraft({
                      ...draft,
                      yearStart: monthKey(ys.y - 1, ys.m),
                    })
                  }}
                >
                  «
                </button>
              </div>
              <span className={calStyles.calTitle}>
                {ymParts(draft.yearStart).y}年
              </span>
              <div className={calStyles.calNav}>
                <button
                  type="button"
                  className={calStyles.arrow}
                  disabled={ymParts(draft.yearStart).y >= maxYear}
                  onClick={() => {
                    const ys = ymParts(draft.yearStart)
                    setDraft({
                      ...draft,
                      yearStart: monthKey(Math.min(maxYear, ys.y + 1), ys.m),
                    })
                  }}
                >
                  »
                </button>
              </div>
            </div>
            <div className={styles.monthGrid}>
              {MONTH_NAMES.map((name, i) => {
                const m = i + 1
                const ys = ymParts(draft.yearStart)
                return (
                  <button
                    key={name}
                    type="button"
                    className={ys.m === m ? styles.monthOn : styles.monthBtn}
                    onClick={() => {
                      const k = monthKey(ys.y, m)
                      setDraft({ ...draft, yearStart: k })
                      onPersist({ ...prefs, yearStart: k })
                    }}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {draft.kind === 'custom' && (
          <div className={`${form.sheetActions} ${styles.applyCenter}`}>
            <button
              type="button"
              className={form.primary}
              onClick={applyPicker}
            >
              Apply
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
