import type { LogKind } from '../../types'

export type AppliedRange = {
  kind: LogKind
  start: number
  end: number
  label: string
}

export type Slice = {
  id: string
  name: string
  color: string
  sec: number
}

export type Seg = {
  eventId: string
  color: string
  name: string
  start: number
  end: number
}

export type Column = {
  key: string
  label: string
  start: number
  end: number
  segs: Seg[]
}

export type TotalCol = {
  key: string
  label: string
  spanSec: number
  parts: Slice[]
}
