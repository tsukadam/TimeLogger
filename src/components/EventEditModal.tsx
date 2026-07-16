import { useEffect, useMemo, useState } from 'react'
import { DateField } from './DateField'
import { FolderSelect } from './FolderSelect'
import { Modal } from './Modal'
import { Spinner } from './Spinner'
import spinnerStyles from './Spinner.module.css'
import { TaskSelect } from './TaskSelect'
import { TimeField } from './TimeField'
import form from './form.module.css'
import {
  addDaysKey,
  dateKey,
  dateTimeInputToIso,
  isoToTimeInput,
} from '../lib/time'
import { useStore } from '../state/Store'
import type { Event, Task } from '../types'

/** Activity / Log 共通の記録編集モーダル */
export function EventEditModal({
  eventId,
  onClose,
}: {
  eventId: string
  onClose: () => void
}) {
  const { events, tasks } = useStore()

  const editing = useMemo(
    () => events.find((e) => e.id === eventId) ?? null,
    [events, eventId],
  )

  // 削除などで対象が消えたら親へ（Save 後の閉じは Modal の requestClose）
  useEffect(() => {
    if (!editing) onClose()
  }, [editing, onClose])

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      aria-label="記録を編集"
    >
      {({ requestClose }) =>
        editing ? (
          <EventEditForm
            eventId={eventId}
            editing={editing}
            tasks={tasks}
            requestClose={requestClose}
          />
        ) : null
      }
    </Modal>
  )
}

function EventEditForm({
  eventId,
  editing,
  tasks,
  requestClose,
}: {
  eventId: string
  editing: Event
  tasks: Task[]
  requestClose: () => void
}) {
  const { busy, folders, updateEvent, deleteEvent } = useStore()

  const [formFolderId, setFormFolderId] = useState('')
  const [formTaskId, setFormTaskId] = useState('')
  const [formStartDate, setFormStartDate] = useState('')
  const [formStartTime, setFormStartTime] = useState('')
  const [formEndDate, setFormEndDate] = useState('')
  const [formEndTime, setFormEndTime] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingSheet, setPendingSheet] = useState<'save' | 'delete' | null>(
    null,
  )

  useEffect(() => {
    const task = tasks.find((t) => t.id === editing.taskId)
    setFormFolderId(task?.folderId ?? editing.folderId)
    setFormTaskId(editing.taskId)
    setFormStartDate(dateKey(editing.startedAt))
    setFormStartTime(isoToTimeInput(editing.startedAt))
    setFormEndDate(editing.endedAt ? dateKey(editing.endedAt) : '')
    setFormEndTime(editing.endedAt ? isoToTimeInput(editing.endedAt) : '')
    setFormError(null)
  }, [editing, tasks])

  const folderTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.folderId === formFolderId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [tasks, formFolderId],
  )

  const isRecording = editing.endedAt === null
  const taskMissing =
    formTaskId !== '' && !folderTasks.some((t) => t.id === formTaskId)

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
      requestClose()
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
      // 対象消失で親がアンマウントする（閉じアニメは対象が残る Save 側で効く）
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '削除に失敗しました')
    } finally {
      setPendingSheet(null)
    }
  }

  return (
    <>
      <h2 className={form.sheetTitle}>記録を編集</h2>

      <div className={form.field}>
        <span>フォルダ</span>
        <FolderSelect
          folders={folders}
          value={formFolderId}
          disabled={busy}
          onChange={changeFolder}
        />
      </div>

      <div className={form.field}>
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

      <div className={form.field}>
        <span>開始</span>
        <div className={form.dateTimeRow}>
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
        <div className={form.field}>
          <span>終了</span>
          <div className={form.dateTimeRow}>
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

      {formError && <p className={form.formError}>{formError}</p>}

      <div className={form.sheetActions}>
        <button
          type="button"
          className={`${form.danger}${
            pendingSheet === 'delete' ? ` ${spinnerStyles.busyBtn}` : ''
          }`}
          disabled={busy}
          aria-busy={pendingSheet === 'delete'}
          onClick={() => void submitDelete()}
        >
          {pendingSheet === 'delete' ? <Spinner size={14} /> : '削除'}
        </button>
        <div className={form.sheetActionsRight}>
          <button
            type="button"
            className={`${form.primary}${
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
    </>
  )
}
