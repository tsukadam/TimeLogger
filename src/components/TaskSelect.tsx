import { useEffect, useId, useRef, useState } from 'react'
import type { Task } from '../types'
import styles from './FolderSelect.module.css'

/** FolderSelect と同型の ▾ 付きプルダウン（タスク用） */
export function TaskSelect({
  tasks,
  value,
  onChange,
  disabled,
  extraOption,
}: {
  tasks: Task[]
  value: string
  onChange: (taskId: string) => void
  disabled?: boolean
  /** 削除済みなど、一覧に無い現行値の表示 */
  extraOption?: { id: string; name: string; color: string } | null
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const fromList = tasks.find((t) => t.id === value)
  const selected =
    fromList ??
    (extraOption && extraOption.id === value ? extraOption : null) ??
    tasks[0] ??
    null

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const options =
    extraOption && !tasks.some((t) => t.id === extraOption.id)
      ? [extraOption, ...tasks]
      : tasks

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        disabled={disabled || !selected}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        {selected && (
          <>
            <span
              className={styles.swatch}
              style={{ background: selected.color }}
              aria-hidden
            />
            <span className={styles.name}>{selected.name}</span>
          </>
        )}
        <span className={styles.chevron} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className={styles.list} role="listbox" id={listId}>
          {options.map((t) => (
            <li key={t.id} role="option" aria-selected={t.id === value}>
              <button
                type="button"
                className={t.id === value ? styles.optionActive : styles.option}
                onClick={() => {
                  onChange(t.id)
                  setOpen(false)
                }}
              >
                <span
                  className={styles.swatch}
                  style={{ background: t.color }}
                  aria-hidden
                />
                <span className={styles.name}>{t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
