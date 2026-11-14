import type { ReactNode } from 'react'

import type {
  DiagnosticKind,
  EligibilityCode,
  ExperimentDiagnostic,
  ProfileLifecycleStatus,
  SchemeLifecycleStatus,
  SkipCode,
} from '@/data/experiment-types'

export const SKIP_LABELS: Record<SkipCode, string> = {
  'scheme-ineligible': '方案未生效',
  'profile-missing': '画像版本缺失',
  'profile-unpublished': '画像未发布',
  'profile-voided': '画像已作废',
  'layer-missing': '目标分层缺失',
  'not-in-layer': '不在目标分层',
  'already-hit': '已命中过',
  'already-hit-other-version': '旧版本已命中',
  'unknown-user': '用户名单缺失',
  'duplicate-whitelist': '白名单重复',
}

export const ELIGIBILITY_LABELS: Record<EligibilityCode, string> = {
  eligible: '具备实验资格',
  'scheme-inactive': '方案未生效',
  'profile-missing': '画像版本缺失',
  'profile-unpublished': '画像未发布',
  'profile-voided': '画像已作废',
  'layer-missing': '目标分层缺失',
}

export const DIAGNOSTIC_LABELS: Record<DiagnosticKind, string> = {
  'commit-failed': '提交失败',
  'interrupted-rollback': '中断已回滚',
  'interrupted-forward': '中断已前滚',
  'storage-error': '存储异常',
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export type Tone = 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'purple'

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function ProfileStatusBadge({ status }: { status: ProfileLifecycleStatus | '缺失' }) {
  const tone: Tone =
    status === '已发布'
      ? 'green'
      : status === '已作废'
        ? 'red'
        : status === '画像评审中'
          ? 'amber'
          : 'gray'
  return <Badge tone={tone}>{status}</Badge>
}

export function SchemeStatusBadge({ status }: { status: SchemeLifecycleStatus }) {
  const tone: Tone =
    status === '已生效' ? 'green' : status === '已下线' ? 'gray' : status === '方案评审中' ? 'amber' : 'blue'
  return <Badge tone={tone}>{status}</Badge>
}

export function EligibilityBadge({ code, label }: { code: EligibilityCode; label?: string }) {
  const tone: Tone = code === 'eligible' ? 'green' : code === 'profile-voided' ? 'red' : 'amber'
  return <Badge tone={tone}>{label ?? ELIGIBILITY_LABELS[code]}</Badge>
}

export function HistoricalBadge({ historical }: { historical: boolean }) {
  return historical ? <Badge tone="purple">历史批次 · 冻结</Badge> : <Badge tone="blue">当前版本批次</Badge>
}

export function AttemptStatusBadge({ status }: { status: 'complete' | 'unchanged' | 'blocked' }) {
  const tone: Tone = status === 'complete' ? 'green' : status === 'unchanged' ? 'amber' : 'red'
  const label = status === 'complete' ? '已生成新批次' : status === 'unchanged' ? '未新增命中' : '已拦截'
  return <Badge tone={tone}>{label}</Badge>
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-block">
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  )
}

export function DiagnosticList({
  diagnostics,
  onRetry,
  onRecover,
  retryLabel = '重试上次操作',
}: {
  diagnostics: ExperimentDiagnostic[]
  onRetry?: () => void
  onRecover?: () => void
  retryLabel?: string
}) {
  if (diagnostics.length === 0) {
    return null
  }
  return (
    <section className="diagnostic-panel">
      <header className="diagnostic-head">
        <strong>异常与恢复记录</strong>
        <div className="inline-actions">
          {onRecover && (
            <button className="btn small" type="button" onClick={onRecover}>
              重新读取并恢复
            </button>
          )}
          {onRetry && (
            <button className="btn small primary" type="button" onClick={onRetry}>
              {retryLabel}
            </button>
          )}
        </div>
      </header>
      <ul className="diagnostic-list">
        {diagnostics.map((item) => (
          <li key={item.id} className={`diagnostic-item diagnostic-${item.kind}`}>
            <div className="diagnostic-title">
              <Badge tone={item.kind === 'interrupted-forward' ? 'blue' : 'red'}>
                {DIAGNOSTIC_LABELS[item.kind]}
              </Badge>
              <span className="muted">{fmtDate(item.at)}</span>
              {item.schemeCode && <span className="mono">{item.schemeCode}</span>}
              {item.preservedBatchId && (
                <span className="muted">保留完整批次 {item.preservedBatchId}</span>
              )}
            </div>
            <p>{item.reason}</p>
            {item.retryable && <span className="muted">该异常可重试；重试只会在同一批结果上继续，不会重复扩大人群。</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <span className="kv-label">{label}</span>
      <span className="kv-value">{children}</span>
    </div>
  )
}

export function SectionHead({ title, extra }: { title: string; extra?: ReactNode }) {
  return (
    <div className="section-head">
      <h3>{title}</h3>
      {extra && <div className="inline-actions">{extra}</div>}
    </div>
  )
}

export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [header.map(escape).join(',')]
  for (const row of rows) {
    lines.push(row.map(escape).join(','))
  }
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
