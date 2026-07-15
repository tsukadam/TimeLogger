import { useEffect, useMemo, useState } from 'react'
import { FolderSelect } from './FolderSelect'
import { TaskSelect } from './TaskSelect'
import { TimeField } from './TimeField'
import {
  dateTimeInputToIso,
  isoToDateInput,
  isoToTimeInput,
} from '../lib/time'
import { useStore } from '../state/Store'
import type { Event } from '../types'
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

  useEffect(() => {
    if (!editing) {
      onClose()
      return
    }
    const task = tasks.find((t) => t.id === editing.taskId)
    setFormFolderId(task?.folderId ?? editing.folderId)
    setFormTaskId(editing.taskId)
    setFormStartDate(isoToDateInput(editing.startedAt))
    setFormStartTime(isoToTimeInput(editing.startedAt))
    setFormEndDate(editing.endedAt ? isoToDateInput(editing.endedAt) : '')
    setFormEndTime(editing.endedAt ? isoToTimeInput(editing.endedAt) : '')
    setFormError(null)
  }, [editing, tasks, onClose])

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
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  const submitDelete = async () => {
    if (!window.confirm('この記録を削除しますか？')) return
    setFormError(null)
    try {
      await deleteEvent(eventId)
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '削除に失敗しました')
    }
  }

  return (
    <div className={styles.modalRoot}>
      <button
        type="button"
        className={styles.modalBackdrop}
        aria-label="閉じる"
        onClick={onClose}
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
            <input
              type="date"
              className={styles.dateInput}
              value={formStartDate}
              disabled={busy}
              onChange={(e) => setFormStartDate(e.target.value)}
            />
            <TimeField
              value={formStartTime}
              disabled={busy}
              onChange={setFormStartTime}
              aria-label="開始時刻"
            />
          </div>
        </div>

        {!isRecording && (
          <div className={styles.field}>
            <span>終了</span>
            <div className={styles.dateTimeRow}>
              <input
                type="date"
                className={styles.dateInput}
                value={formEndDate}
                disabled={busy}
                onChange={(e) => setFormEndDate(e.target.value)}
              />
              <TimeField
                value={formEndTime}
                disabled={busy}
                onChange={setFormEndTime}
                aria-label="終了時刻"
              />
            </div>
          </div>
        )}

        {formError && <p className={styles.formError}>{formError}</p>}

        <div className={styles.sheetActions}>
          <button
            type="button"
            className={styles.danger}
            disabled={busy}
            onClick={() => void submitDelete()}
          >
            削除
          </button>
          <div className={styles.sheetActionsRight}>
            <button
              type="button"
              className={styles.primary}
              disabled={
                busy ||
                !formTaskId ||
                !formStartDate ||
                !formStartTime.trim() ||
                (!isRecording && (!formEndDate || !formEndTime.trim()))
              }
              onClick={() => void submit()}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export type { Event }
