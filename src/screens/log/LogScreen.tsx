import { useEffect, useMemo, useRef, useState } from 'react'
import { EventEditModal } from '../../components/EventEditModal'
import { FolderIcon } from '../../components/FolderIcon'
import chrome from '../../components/screenChrome.module.css'
import {
  addDaysKey,
  addMonthsKey,
  durationLabel,
  formatDurationHms,
  formatEventRange,
  todayKey,
  ymParts,
} from '../../lib/time'
import { useNowTick } from '../../lib/useNowTick'
import { useTabIndicator } from '../../lib/useTabIndicator'
import { useStoreActions, useStoreData } from '../../state/Store'
import type { LogKind, LogPrefs } from '../../types'
import styles from '../LogScreen.module.css'
import { aggregateLogData, resolveDisplay } from './aggregate'
import { IndividualChart } from './IndividualChart'
import { buildApplied, makeDefaultPrefs, normalizePrefs } from './prefs'
import { RangePicker, type SheetPos } from './RangePicker'
import { SliceBreakdown } from './SliceBreakdown'
import { TotalsChart } from './TotalsChart'

export function LogScreen() {
  const { loading, error, events, tasks, folders, logPrefs } = useStoreData()
  const { clearError, saveLogPrefs } = useStoreActions()

  const today = todayKey()
  const ty = ymParts(today).y

  const [prefs, setPrefs] = useState<LogPrefs>(() => makeDefaultPrefs())
  const [prefsReady, setPrefsReady] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sheetPos, setSheetPos] = useState<SheetPos | null>(null)
  const rangeBtnRef = useRef<HTMLButtonElement | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  // Summary グラフの表示モード（Tasks = タスクの時系列 / Genres = ジャンル合算）
  const [sumMode, setSumMode] = useState<'tasks' | 'genres'>('tasks')
  // タブ移動と同時に重いグラフ描画を始めるとアニメがコマ落ちするため、
  // 枠・下地・一覧は先に出し、グラフの中身は段階的に描く:
  // 1) 棒（スライド後）→ 2) 円1（棒のマスクが終わってから）→ 3) 円2（さらに後）
  const [drawStage, setDrawStage] = useState(0)
  useEffect(() => {
    setDrawStage(0)
    const t1 = window.setTimeout(() => setDrawStage(1), 300)
    const t2 = window.setTimeout(() => setDrawStage(2), 850)
    const t3 = window.setTimeout(() => setDrawStage(3), 1200)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [prefs.kind])

  const { wrapRef: kindTabsRef, ind: kindInd } = useTabIndicator(prefs.kind, [
    prefsReady,
  ])

  // settings から復元（旧形式の設定も正規化して受け入れる）
  useEffect(() => {
    if (loading) return
    const next = normalizePrefs(logPrefs) ?? makeDefaultPrefs()
    setPrefs(next)
    setPrefsReady(true)
  }, [loading, logPrefs])

  const hasLive = useMemo(() => events.some((e) => e.endedAt === null), [events])
  const now = useNowTick(hasLive)

  const applied = useMemo(
    () => buildApplied(prefs, now, events),
    [prefs, now, events],
  )

  const persist = async (next: LogPrefs) => {
    setPrefs(next)
    try {
      await saveLogPrefs(next)
    } catch {
      /* Store が表示 */
    }
  }

  const openPicker = () => {
    if (prefs.kind === 'all') return
    const r = rangeBtnRef.current?.getBoundingClientRect()
    // スマホでも触りやすいよう画面幅近くまで広げ、水平は中央寄せ
    const pad = 10
    const width = Math.min(420, window.innerWidth - pad * 2)
    const left = Math.round((window.innerWidth - width) / 2)
    if (r) {
      // 日付ボタンを覆い隠す（古い期間表記が見えないよう上端で揃える）
      const maxTop = window.innerHeight - 120
      const top = Math.min(r.top, maxTop)
      setSheetPos({ top, left, width })
    } else {
      setSheetPos({ top: 80, left, width })
    }
    setPickerOpen(true)
  }

  const setKind = (kind: LogKind) => {
    const next = { ...prefs, kind }
    void persist(next)
    setDetailOpen(false)
  }

  // ←→ 期間送り
  const stepRange = (dir: 1 | -1) => {
    const k = prefs.kind
    if (k === 'day') {
      const d = addDaysKey(prefs.day, dir)
      if (ymParts(d).y > ty) return
      void persist({ ...prefs, day: d })
    } else if (k === 'week') {
      const d = addDaysKey(prefs.weekStart, dir * 7)
      if (ymParts(d).y > ty) return
      void persist({ ...prefs, weekStart: d })
    } else if (k === 'month') {
      const d = addMonthsKey(prefs.monthStart, dir)
      if (ymParts(d).y > ty) return
      void persist({ ...prefs, monthStart: d })
    } else if (k === 'year') {
      const d = addMonthsKey(prefs.yearStart, dir * 12)
      const y = ymParts(d).y
      if (y > ty || y < 1970) return
      void persist({ ...prefs, yearStart: d })
    }
  }

  const {
    taskSlices,
    folderSlices,
    pieTaskSlices,
    pieFolderSlices,
    totalSec,
    columns,
    totalColumns,
    chartMode,
    dayEvents,
  } = useMemo(
    () =>
      aggregateLogData({
        applied,
        events,
        tasks,
        folders,
        now,
        sumMode,
      }),
    [applied, events, tasks, folders, now, sumMode],
  )

  const hasSumModes =
    prefs.kind === 'week' || prefs.kind === 'month' || prefs.kind === 'year'

  if (loading || !prefsReady) {
    return <p className={chrome.status}>Loading...</p>
  }

  return (
    <section className={styles.root}>
      {error && (
        <div className={chrome.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={clearError}>
            閉じる
          </button>
        </div>
      )}

      <div className={styles.kindTabs} ref={kindTabsRef}>
        {(
          [
            ['all', 'All'],
            ['day', 'Day'],
            ['week', 'Week'],
            ['month', 'Month'],
            ['year', 'Year'],
            ['custom', 'Custom'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            data-tab={k}
            data-text={label}
            className={prefs.kind === k ? styles.kindActive : undefined}
            onClick={() => setKind(k)}
          >
            {label}
          </button>
        ))}
        {kindInd && (
          <span
            className={styles.kindInd}
            style={{ left: kindInd.left, width: kindInd.width }}
            aria-hidden
          />
        )}
      </div>

      {prefs.kind !== 'all' && (
        <div className={styles.rangeRow}>
          {prefs.kind !== 'custom' && (
            <button
              type="button"
              className={styles.stepBtn}
              aria-label="前へ"
              onClick={() => stepRange(-1)}
            >
              ←
            </button>
          )}
          <button
            type="button"
            ref={rangeBtnRef}
            className={styles.rangeBtn}
            onClick={openPicker}
          >
            <span className={styles.rangeLabel}>{applied.label}</span>
            <span className={styles.chevron} aria-hidden>
              ▾
            </span>
          </button>
          {prefs.kind !== 'custom' && (
            <button
              type="button"
              className={styles.stepBtn}
              aria-label="次へ"
              onClick={() => stepRange(1)}
            >
              →
            </button>
          )}
        </div>
      )}

      <div className={styles.totalLine}>
        <span className={styles.sectionTitle}>Tracked Time</span>
        <span className={styles.totalValue}>{formatDurationHms(totalSec)}</span>
      </div>

      <hr className={styles.rule} />

      {prefs.kind !== 'all' && prefs.kind !== 'custom' && (
        <>
          <h2 className={styles.sectionTitle}>Summary</h2>
          <div className={styles.panel}>
            {totalSec === 0 ? (
              <p className={chrome.status}>No Data</p>
            ) : hasSumModes && sumMode === 'genres' ? (
              <TotalsChart
                key={`${prefs.kind}-${applied.start}-${sumMode}`}
                columns={totalColumns}
                draw={drawStage >= 1}
              />
            ) : (
              <IndividualChart
                key={`${prefs.kind}-${applied.start}`}
                columns={columns}
                chartMode={chartMode}
                onSeg={setEditId}
                tapName={prefs.kind === 'year'}
                draw={drawStage >= 1}
              />
            )}
          </div>
          {hasSumModes && totalSec > 0 && (
            <div className={styles.modeBtns}>
              <button
                type="button"
                data-text="Tasks"
                className={sumMode === 'tasks' ? styles.modeOn : styles.modeBtn}
                onClick={() => setSumMode('tasks')}
              >
                Tasks
              </button>
              <button
                type="button"
                data-text="Genres"
                className={sumMode === 'genres' ? styles.modeOn : styles.modeBtn}
                onClick={() => setSumMode('genres')}
              >
                Genres
              </button>
            </div>
          )}
          {prefs.kind === 'day' && totalSec > 0 && (
            <>
              <button
                type="button"
                className={styles.detailBtn}
                onClick={() => setDetailOpen((v) => !v)}
              >
                {detailOpen ? 'Close' : 'Detail'}
              </button>
              {detailOpen && (
                <ul className={styles.detailList}>
                  {dayEvents.length === 0 ? (
                    <li className={chrome.status}>記録なし</li>
                  ) : (
                    dayEvents.map((ev) => {
                      const d = resolveDisplay(ev, tasks, folders)
                      return (
                        <li key={ev.id}>
                          <button
                            type="button"
                            className={styles.detailRow}
                            onClick={() => setEditId(ev.id)}
                          >
                            <div className={styles.detailMain}>
                              <div className={styles.detailTitle}>
                                <span
                                  className={styles.dot}
                                  style={{ background: d.taskColor }}
                                />
                                <span>{d.taskName}</span>
                                <FolderIcon color={d.folderColor} size={12} />
                                <span className={styles.detailFolder}>
                                  {d.folderName}
                                </span>
                              </div>
                              <div className={styles.detailMeta}>
                                {formatEventRange(ev.startedAt, ev.endedAt)}
                              </div>
                            </div>
                            <span className={styles.detailDur}>
                              {durationLabel(ev.startedAt, ev.endedAt, now)}
                            </span>
                          </button>
                        </li>
                      )
                    })
                  )}
                </ul>
              )}
            </>
          )}
          <hr className={styles.rule} />
        </>
      )}

      <SliceBreakdown
        title="Tasks"
        tableSlices={taskSlices}
        pieSlices={pieTaskSlices}
        totalSec={totalSec}
        draw={drawStage >= 2}
        chartKey={`${prefs.kind}-${applied.start}`}
      />

      <hr className={styles.rule} />

      <SliceBreakdown
        title="Genres"
        tableSlices={folderSlices}
        pieSlices={pieFolderSlices}
        totalSec={totalSec}
        draw={drawStage >= 3}
        chartKey={`${prefs.kind}-${applied.start}`}
      />

      {pickerOpen && prefs.kind !== 'all' && sheetPos && (
        <RangePicker
          sheetPos={sheetPos}
          prefs={prefs}
          today={today}
          maxYear={ty}
          onClose={() => setPickerOpen(false)}
          onPersist={(next) => void persist(next)}
        />
      )}

      {editId && (
        <EventEditModal eventId={editId} onClose={() => setEditId(null)} />
      )}
    </section>
  )
}
