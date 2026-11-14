import { EXPERIMENT_SEED } from './experiment-seed'
import type { ExperimentState } from './experiment-types'

// 实验域的独立持久化：画像版本、方案绑定、白名单、命中批次和诊断都放在这里。
// 与通用模块的 data-product-ops:entries 分开，互不覆盖。
const STATE_KEY = 'data-product-ops:experiment-state'
const JOURNAL_KEY = 'data-product-ops:experiment-journal'
const FAULT_KEY = 'data-product-ops:experiment-fault'

export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const memory = new Map<string, string>()
const memoryStorage: StorageLike = {
  getItem: (key) => (memory.has(key) ? (memory.get(key) as string) : null),
  setItem: (key, value) => {
    memory.set(key, value)
  },
  removeItem: (key) => {
    memory.delete(key)
  },
}

let storageOverride: StorageLike | null = null

export function setExperimentStorage(storage: StorageLike | null): void {
  storageOverride = storage
}

function getStorage(): StorageLike {
  if (storageOverride) {
    return storageOverride
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  return memoryStorage
}

export type JournalPhase = 'prepared' | 'committed'

export type ExperimentJournal = {
  id: string
  at: string
  label: string
  phase: JournalPhase
  baseRevision: number
  baseState: ExperimentState
  nextState: ExperimentState
}

export type FaultMode = 'none' | 'commit-fail' | 'interrupt-before-write' | 'interrupt-after-write'

export function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function seedState(): ExperimentState {
  return cloneState(EXPERIMENT_SEED)
}

export function readStateRaw(): { state: ExperimentState | null; error: string | null } {
  let raw: string | null = null
  try {
    raw = getStorage().getItem(STATE_KEY)
  } catch (error) {
    return { state: null, error: error instanceof Error ? error.message : '浏览器存储不可用' }
  }
  if (!raw) {
    return { state: null, error: null }
  }
  try {
    const parsed = JSON.parse(raw) as ExperimentState
    if (
      !parsed ||
      parsed.schemaVersion !== EXPERIMENT_SEED.schemaVersion ||
      !Array.isArray(parsed.profiles) ||
      !Array.isArray(parsed.schemes) ||
      !Array.isArray(parsed.batches)
    ) {
      return { state: null, error: '本地实验数据版本已变化或结构不完整' }
    }
    return { state: parsed, error: null }
  } catch {
    return { state: null, error: '本地实验数据无法解析' }
  }
}

export function writeStateRaw(state: ExperimentState): { ok: boolean; error: string | null } {
  try {
    getStorage().setItem(STATE_KEY, JSON.stringify(state))
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '写入本地存储失败' }
  }
}

export function clearStateRaw(): void {
  try {
    getStorage().removeItem(STATE_KEY)
  } catch {
    // 清理失败不阻塞恢复流程
  }
}

export function readJournalRaw(): { journal: ExperimentJournal | null; error: string | null } {
  let raw: string | null = null
  try {
    raw = getStorage().getItem(JOURNAL_KEY)
  } catch (error) {
    return { journal: null, error: error instanceof Error ? error.message : '读取提交日志失败' }
  }
  if (!raw) {
    return { journal: null, error: null }
  }
  try {
    return { journal: JSON.parse(raw) as ExperimentJournal, error: null }
  } catch {
    return { journal: null, error: '提交日志无法解析' }
  }
}

export function writeJournalRaw(journal: ExperimentJournal): { ok: boolean; error: string | null } {
  try {
    getStorage().setItem(JOURNAL_KEY, JSON.stringify(journal))
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '写入提交日志失败' }
  }
}

export function clearJournalRaw(): void {
  try {
    getStorage().removeItem(JOURNAL_KEY)
  } catch {
    // 日志清理失败时下次读取会再次尝试恢复
  }
}

export function readFaultMode(): FaultMode {
  try {
    const raw = getStorage().getItem(FAULT_KEY)
    if (
      raw === 'commit-fail' ||
      raw === 'interrupt-before-write' ||
      raw === 'interrupt-after-write'
    ) {
      return raw
    }
  } catch {
    // 读取失败按无故障处理
  }
  return 'none'
}

export function setFaultMode(mode: FaultMode): void {
  try {
    if (mode === 'none') {
      getStorage().removeItem(FAULT_KEY)
    } else {
      getStorage().setItem(FAULT_KEY, mode)
    }
  } catch {
    // 故障开关只用于本地演练，写入失败可以忽略
  }
}

// 故障是一次性的：命中后立即清除，避免下一次正常操作继续被拦截。
export function consumeFaultMode(): FaultMode {
  const mode = readFaultMode()
  if (mode !== 'none') {
    setFaultMode('none')
  }
  return mode
}
