import { FOLDER_PALETTE, TASK_BASE_CELL } from '../lib/color'
import { FolderIcon } from './FolderIcon'
import styles from './TaskColorPicker.module.css'

export type PalettePos =
  | { kind: 'task'; row: number; col: number }
  | { kind: 'folder'; index: number }

function ColorPickerButton({
  fill,
  selected,
  onPick,
}: {
  fill: string | null
  selected: boolean
  onPick: (c: string) => void
}) {
  const filled = fill !== null && /^#[0-9a-fA-F]{6}$/.test(fill)
  return (
    <label
      className={[
        styles.pickerWrap,
        filled ? styles.pickerFilled : styles.pickerEmpty,
        selected ? styles.colorActive : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title="自由に選ぶ"
      style={filled ? { background: fill } : undefined}
      onPointerDown={() => {
        if (fill) onPick(fill)
      }}
    >
      <span
        className={filled ? styles.pickerFaceOnColor : styles.pickerFace}
        aria-hidden
      >
        ＋
      </span>
      <input
        type="color"
        className={styles.pickerInput}
        value={filled ? fill : '#e08a3c'}
        onChange={(e) => onPick(e.target.value)}
        aria-label="カラーピッカー"
      />
    </label>
  )
}

type Props = {
  mode: 'folder' | 'task'
  colorFrom: 'palette' | 'picker'
  palettePos: PalettePos | null
  pickerFill: string | null
  taskGrid: string[][] | null
  onSelectPalette: (color: string, pos: PalettePos) => void
  onPickCustom: (color: string) => void
}

export function TaskColorPicker({
  mode,
  colorFrom,
  palettePos,
  pickerFill,
  taskGrid,
  onSelectPalette,
  onPickCustom,
}: Props) {
  if (mode === 'folder') {
    return (
      <div className={styles.colors}>
        {FOLDER_PALETTE.map((c, index) => {
          const selected =
            colorFrom === 'palette' &&
            palettePos?.kind === 'folder' &&
            palettePos.index === index
          return (
            <button
              key={c}
              type="button"
              className={selected ? styles.colorActive : styles.color}
              style={{ background: c }}
              aria-label={c}
              onClick={() => onSelectPalette(c, { kind: 'folder', index })}
            />
          )
        })}
        <ColorPickerButton
          fill={pickerFill}
          selected={colorFrom === 'picker'}
          onPick={onPickCustom}
        />
      </div>
    )
  }

  if (!taskGrid) return null

  return (
    <div className={styles.colorGridWrap}>
      <div className={styles.colorGrid} role="listbox" aria-label="タスク色">
        {taskGrid.flatMap((row, ri) =>
          row.map((c, ci) => {
            const isBase =
              ri === TASK_BASE_CELL.row && ci === TASK_BASE_CELL.col
            const selected =
              colorFrom === 'palette' &&
              palettePos?.kind === 'task' &&
              palettePos.row === ri &&
              palettePos.col === ci
            return (
              <button
                key={`${ri}-${ci}-${c}`}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={isBase ? `フォルダ色 ${c}` : c}
                className={
                  selected
                    ? `${styles.colorActive} ${styles.colorSwatch}`
                    : styles.colorSwatch
                }
                style={{ background: c }}
                onClick={() =>
                  onSelectPalette(c, { kind: 'task', row: ri, col: ci })
                }
              >
                {isBase && (
                  <FolderIcon
                    color="#fff"
                    size={14}
                    className={styles.baseFolderMark}
                  />
                )}
              </button>
            )
          }),
        )}
      </div>
      <ColorPickerButton
        fill={pickerFill}
        selected={colorFrom === 'picker'}
        onPick={onPickCustom}
      />
    </div>
  )
}
