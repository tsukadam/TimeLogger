import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { DateField } from './DateField'
import { FolderSelect } from './FolderSelect'
import { Spinner } from './Spinner'
import spinnerStyles from './Spinner.module.css'
import { TaskSelect } from './TaskSelect'
import { TimeField } from './TimeField'
import {
  addDaysKey,
  dateKey,
  dateTimeInputToIso,
  isoToTimeInput,
} from '../lib/time'
import { useScrollLock } from '../lib/useScrollLock'
import { useStore } from '../state/Store'
import styles from './EventEditModal.module.css'

/** Activity / Log 共通の記録編集モーダル */
export function EventEditModal({
  eventId,
  onClose,
}: {
  eventId: string
  onClose: () => void
}) {
  const {
    busy,
    events,
    tasks,
    folders,
    updateEvent,
    deleteEvent,
  } = useStore()

  const editing = useMemo(
    () => events.find((e) => e.id === eventId) ?? null,
    [events, eventId],
  )

  const [formFolderId, setFormFolderId] = useState('')
  const [formTaskId, setFormTaskId] = useState('')
  const [formStartDate, setFormStartDate] = useState('')
  const [formStartTime, setFormStartTime] = useState('')
  const [formEndDate, setFormEndDate] = useState('')
  const [formEndTime, setFormEndTime] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [pendingSheet, setPendingSheet] = useState<'save' | 'delete' | null>(
    null,
  )
  useScrollLock(true)

  // 閉じアニメーションを流してからアンマウント
  const close = () => {
    if (closing) return
    setClosing(true)
    window.setTimeout(onClose, 160)
  }

  useEffect(() => {
    if (!editing) {
      // 閉じアニメーション中は timeout 側の onClose に任せる
      if (!closing) onClose()
      return
    }
    const task = tasks.find((t) => t.id === editing.taskId)
    setFormFolderId(task?.folderId ?? editing.folderId)
    setFormTaskId(editing.taskId)
    setFormStartDate(dateKey(editing.startedAt))
    setFormStartTime(isoToTimeInput(editing.startedAt))
    setFormEndDate(editing.endedAt ? dateKey(editing.endedAt) : '')
    setFormEndTime(editing.endedAt ? isoToTimeInput(editing.endedAt) : '')
    setFormError(null)
  }, [editing, tasks, onClose, closing])

  const folderTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.folderId === formFolderId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [tasks, formFolderId],
  )

  const isRecording = editing?.endedAt === null
  const taskMissing =
    formTaskId !== '' && !folderTasks.some((t) => t.id === formTaskId)

  if (!editing) return null

  const changeFolder = (folderId: string) => {
    setFormFolderId(folderId)
    const first = tasks
      .filter((t) => t.folderId === folderId)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0]
    setFormTaskId(first?.id ?? '')
  }

  const submit = async () => {
    setFormError(null)
    setPendingSheet('save')
    try {
      const startedAt = dateTimeInputToIso(formStartDate, formStartTime)
      const endedAt =
        editing.endedAt === null
          ? null
          : dateTimeInputToIso(formEndDate, formEndTime)
      await updateEvent(eventId, {
        taskId: formTaskId,
        startedAt,
        endedAt,
      })
      close()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setPendingSheet(null)
    }
  }

  const submitDelete = async () => {
    if (!window.confirm('この記録を削除しますか？')) return
    setFormError(null)
    setPendingSheet('delete')
    try {
      await deleteEvent(eventId)
      close()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '削除に失敗しました')
    } finally {
      setPendingSheet(null)
    }
  }

  // スクロールコンテナ内の fixed は実機で上端まで覆えないことがあるため body に出す
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
        onClick={close}
      />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="記録を編集"
      >
        <h2 className={styles.sheetTitle}>記録を編集</h2>

        <div className={styles.field}>
          <span>フォルダ</span>
          <FolderSelect
            folders={folders}
            value={formFolderId}
            disabled={busy}
            onChange={changeFolder}
          />
        </div>

        <div className={styles.field}>
          <span>タスク</span>
          <TaskSelect
            tasks={folderTasks}
            value={formTaskId}
            disabled={busy}
            onChange={setFormTaskId}
            extraOption={
              taskMissing
                ? {
                    id: formTaskId,
                    name: `${editing.taskName}（削除済み）`,
                    color: editing.taskColor,
                  }
                : null
            }
          />
        </div>

        <div className={styles.field}>
          <span>開始</span>
          <div className={styles.dateTimeRow}>
            <DateField
              value={formStartDate}
              disabled={busy}
              onChange={setFormStartDate}
              aria-label="開始日"
            />
            <TimeField
              value={formStartTime}
              disabled={busy}
              onChange={setFormStartTime}
              onDayChange={(d) =>
                setFormStartDate((cur) => (cur ? addDaysKey(cur, d) : cur))
              }
              aria-label="開始時刻"
            />
          </div>
        </div>

        {!isRecording && (
          <div className={styles.field}>
            <span>終了</span>
            <div className={styles.dateTimeRow}>
              <DateField
                value={formEndDate}
                disabled={busy}
                onChange={setFormEndDate}
                aria-label="終了日"
              />
              <TimeField
                value={formEndTime}
                disabled={busy}
                onChange={setFormEndTime}
                onDayChange={(d) =>
                  setFormEndDate((cur) => (cur ? addDaysKey(cur, d) : cur))
                }
                aria-label="終了時刻"
              />
            </div>
          </div>
        )}

        {formError && <p className={styles.formError}>{formError}</p>}

        <div className={styles.sheetActions}>
          <button
            type="button"
            className={`${styles.danger}${
              pendingSheet === 'delete' ? ` ${spinnerStyles.busyBtn}` : ''
            }`}
            disabled={busy}
            aria-busy={pendingSheet === 'delete'}
            onClick={() => void submitDelete()}
          >
            {pendingSheet === 'delete' ? <Spinner size={14} /> : '削除'}
          </button>
          <div className={styles.sheetActionsRight}>
            <button
              type="button"
              className={`${styles.primary}${
                pendingSheet === 'save' ? ` ${spinnerStyles.busyBtn}` : ''
              }`}
              disabled={
                busy ||
                !formTaskId ||
                !formStartDate ||
                !formStartTime.trim() ||
                (!isRecording && (!formEndDate || !formEndTime.trim()))
              }
              aria-busy={pendingSheet === 'save'}
              onClick={() => void submit()}
            >
              {pendingSheet === 'save' ? <Spinner size={14} /> : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
