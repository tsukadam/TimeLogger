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

/** Activity の追加モード用。openAdd が計算して渡す */
export type EventFormSeed = {
  folderId: string
  taskId: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

export type EventEditModalProps =
  | { mode?: 'edit'; eventId: string; onClose: () => void }
  | { mode: 'add'; initial: EventFormSeed; onClose: () => void }

/** Activity / Log 共通の記録追加・編集モーダル */
export function EventEditModal(props: EventEditModalProps) {
  if (props.mode === 'add') {
    return (
      <Modal open onClose={props.onClose} aria-label="記録を追加">
        {({ requestClose }) => (
          <EventEditForm
            mode="add"
            initial={props.initial}
            requestClose={requestClose}
          />
        )}
      </Modal>
    )
  }

  return <EventEditModalEdit eventId={props.eventId} onClose={props.onClose} />
}

function EventEditModalEdit({
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
            mode="edit"
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

type EventEditFormProps =
  | {
      mode: 'edit'
      eventId: string
      editing: Event
      tasks: Task[]
      requestClose: () => void
    }
  | {
      mode: 'add'
      initial: EventFormSeed
      requestClose: () => void
    }

function EventEditForm(props: EventEditFormProps) {
  const { busy, folders, tasks, updateEvent, addEvent, deleteEvent } =
    useStore()
  const isAdd = props.mode === 'add'
  const editing = props.mode === 'edit' ? props.editing : null
  const eventId = props.mode === 'edit' ? props.eventId : null
  const formTasks = props.mode === 'edit' ? props.tasks : tasks
  const { requestClose } = props

  const [formFolderId, setFormFolderId] = useState(() =>
    isAdd ? props.initial.folderId : '',
  )
  const [formTaskId, setFormTaskId] = useState(() =>
    isAdd ? props.initial.taskId : '',
  )
  const [formStartDate, setFormStartDate] = useState(() =>
    isAdd ? props.initial.startDate : '',
  )
  const [formStartTime, setFormStartTime] = useState(() =>
    isAdd ? props.initial.startTime : '',
  )
  const [formEndDate, setFormEndDate] = useState(() =>
    isAdd ? props.initial.endDate : '',
  )
  const [formEndTime, setFormEndTime] = useState(() =>
    isAdd ? props.initial.endTime : '',
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingSheet, setPendingSheet] = useState<'save' | 'delete' | null>(
    null,
  )

  useEffect(() => {
    if (props.mode !== 'edit') return
    const ev = props.editing
    const taskList = props.tasks
    const task = taskList.find((t) => t.id === ev.taskId)
    setFormFolderId(task?.folderId ?? ev.folderId)
    setFormTaskId(ev.taskId)
    setFormStartDate(dateKey(ev.startedAt))
    setFormStartTime(isoToTimeInput(ev.startedAt))
    setFormEndDate(ev.endedAt ? dateKey(ev.endedAt) : '')
    setFormEndTime(ev.endedAt ? isoToTimeInput(ev.endedAt) : '')
    setFormError(null)
  }, [
    props.mode,
    props.mode === 'edit' ? props.editing : null,
    props.mode === 'edit' ? props.tasks : null,
  ])

  const folderTasks = useMemo(
    () =>
      formTasks
        .filter((t) => t.folderId === formFolderId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [formTasks, formFolderId],
  )

  const isRecording = !isAdd && editing!.endedAt === null
  const taskMissing =
    !isAdd &&
    formTaskId !== '' &&
    !folderTasks.some((t) => t.id === formTaskId)

  const changeFolder = (folderId: string) => {
    setFormFolderId(folderId)
    const first = formTasks
      .filter((t) => t.folderId === folderId)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0]
    setFormTaskId(first?.id ?? '')
  }

  const submit = async () => {
    setFormError(null)
    setPendingSheet('save')
    try {
      const startedAt = dateTimeInputToIso(formStartDate, formStartTime)
      if (isAdd) {
        await addEvent({
          taskId: formTaskId,
          startedAt,
          endedAt: dateTimeInputToIso(formEndDate, formEndTime),
        })
      } else {
        const endedAt =
          editing!.endedAt === null
            ? null
            : dateTimeInputToIso(formEndDate, formEndTime)
        await updateEvent(eventId!, {
          taskId: formTaskId,
          startedAt,
          endedAt,
        })
      }
      requestClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setPendingSheet(null)
    }
  }

  const submitDelete = async () => {
    if (isAdd || !eventId) return
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

  const title = isAdd ? '記録を追加' : '記録を編集'
  const endRequired = !isRecording

  return (
    <>
      <h2 className={form.sheetTitle}>{title}</h2>

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
            taskMissing && editing
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

      {endRequired && (
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
        {!isAdd && (
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
        )}
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
              (endRequired && (!formEndDate || !formEndTime.trim()))
            }
            aria-busy={pendingSheet === 'save'}
            onClick={() => void submit()}
          >
            {pendingSheet === 'save' ? (
              <Spinner size={14} />
            ) : isAdd ? (
              'Add'
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </>
  )
}
