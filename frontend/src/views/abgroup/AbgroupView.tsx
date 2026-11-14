import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  experimentAudit,
  experimentFault,
  experimentSummary,
  loadExperimentState,
  refreshScheme,
  resetExperiment,
  runSchemeAction,
  schemeRows,
  setExperimentFault,
} from '@/api/experiment-service'
import type { FaultMode } from '@/data/experiment-store'
import type { AuditResult, SchemeBoardRow, SchemeLifecycleStatus } from '@/data/experiment-types'
import {
  Badge,
  DiagnosticList,
  EligibilityBadge,
  EmptyState,
  SchemeStatusBadge,
  SectionHead,
  downloadCsv,
  fmtDate,
} from '@/views/experiment/shared'

type Feedback = { tone: 'ok' | 'error' | 'info'; text: string; detail?: string } | null

const STATUS_FILTERS: (SchemeLifecycleStatus | '全部')[] = ['全部', '草稿', '方案评审中', '已生效', '已下线']

function useExperimentSnapshot() {
  const [snapshot, setSnapshot] = useState(() => loadExperimentState())
  const reload = useCallback(() => setSnapshot(loadExperimentState()), [])
  return { snapshot, reload }
}

export default function AbgroupView() {
  const { snapshot, reload } = useExperimentSnapshot()
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('全部')
  const [fault, setFault] = useState<FaultMode>(() => experimentFault())
  const [lastAction, setLastAction] = useState<{ schemeCode: string; entrances: string[] } | null>(null)

  const state = snapshot.state
  const summary = useMemo(() => experimentSummary(state), [state])
  const rows = useMemo(() => schemeRows(state), [state])

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const matchStatus = statusFilter === '全部' || row.scheme.status === statusFilter
        const text = `${row.scheme.code} ${row.scheme.name} ${row.scheme.groupTag} ${row.scheme.page}`
        return matchStatus && (keyword.trim() === '' || text.toLowerCase().includes(keyword.trim().toLowerCase()))
      }),
    [rows, statusFilter, keyword],
  )

  const empty = state.schemes.length === 0

  function refreshAfter(message: Feedback) {
    setFeedback(message)
    reload()
    setFault(experimentFault())
  }

  function handleRefresh(row: SchemeBoardRow, entrances: string[]) {
    const code = row.scheme.code
    const result = refreshScheme(code, entrances)
    setLastAction({ schemeCode: code, entrances })
    if (!result.ok) {
      refreshAfter({ tone: 'error', text: result.message, detail: result.diagnostic?.reason })
      return
    }
    refreshAfter({
      tone: result.data.status === 'complete' ? 'ok' : result.data.status === 'unchanged' ? 'info' : 'error',
      text: result.data.message,
      detail:
        result.data.status === 'blocked'
          ? `历史批次 ${result.data.preservedBatchId ?? '无'} 仍可查；该方案当前不具备实验资格。`
          : result.data.status === 'unchanged'
            ? `重复提交已合并，累计命中人数 ${row.hitCount} 不变。`
            : undefined,
    })
  }

  function handleAction(code: string, action: '提交方案评审' | '生效方案' | '下线方案') {
    const result = runSchemeAction(code, action)
    if (!result.ok) {
      refreshAfter({ tone: 'error', text: result.message, detail: result.diagnostic?.reason })
      return
    }
    refreshAfter({ tone: 'ok', text: result.message })
  }

  function handleAudit() {
    setAudit(experimentAudit())
  }

  function handleFault(mode: FaultMode) {
    setExperimentFault(mode)
    setFault(mode)
    setFeedback({
      tone: 'info',
      text:
        mode === 'none'
          ? '已关闭故障演练。'
          : `已开启一次性故障演练（${mode}）：下一次提交会失败或中断，可重试或重新读取恢复。`,
    })
  }

  function handleExport() {
    downloadCsv(
      '分流方案清单.csv',
      ['方案编号', '方案名称', '方案状态', '绑定画像版本', '实验资格', '白名单人数', '累计命中人数', '绑定画像版本命中人数', '最近批次'],
      rows.map((row) => [
        row.scheme.code,
        row.scheme.name,
        row.scheme.status,
        row.linkedVersion ? `${row.linkedVersion.profileCode} · ${row.linkedVersion.version}` : '未绑定',
        row.eligibility.label,
        row.whitelistCount,
        row.hitCount,
        row.currentVersionHits,
        row.latestBatch?.id ?? '无',
      ]),
    )
  }

  return (
    <section className="page" data-module="abgroup">
      <header className="page-head">
        <div>
          <h2>分流配置管理</h2>
          <p className="page-desc">
            分流命中只在画像具备实验资格时计算；同一排期窗口重复提交或多个入口同时命中会合并为同一批结果。
            历史边界口径：{summary.historyPolicy}。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={handleAudit}>
            核查画像 / 方案 / 白名单
          </button>
          <button className="btn" type="button" onClick={handleExport} disabled={empty}>
            导出分流配置清单
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              const result = resetExperiment()
              if (!result.ok) {
                refreshAfter({ tone: 'error', text: result.message })
                return
              }
              refreshAfter({ tone: 'ok', text: '已恢复示例数据。' })
            }}
          >
            恢复示例数据
          </button>
        </div>
      </header>

      {feedback && (
        <div className={`feedback feedback-${feedback.tone}`}>
          <span>{feedback.text}</span>
          {feedback.detail && <span className="feedback-detail">{feedback.detail}</span>}
          {lastAction && feedback.tone !== 'ok' && (
            <button
              className="link"
              type="button"
              onClick={() => {
                const row = rows.find((item) => item.scheme.code === lastAction.schemeCode)
                if (row) {
                  handleRefresh(row, lastAction.entrances)
                }
              }}
            >
              重试上次操作
            </button>
          )}
          <button className="link" type="button" onClick={() => setFeedback(null)}>
            收起
          </button>
        </div>
      )}

      <div className="stat-row">
        <article className="stat-card">
          <span className="stat-label">分流方案总数</span>
          <strong className="stat-value">{summary.schemeCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">具备实验资格</span>
          <strong className="stat-value">{summary.eligibleSchemes}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">已失去资格</span>
          <strong className="stat-value">{summary.blockedSchemes}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">累计命中人数</span>
          <strong className="stat-value">{summary.cumulativeHits}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">历史冻结命中</span>
          <strong className="stat-value">{summary.historicalHits}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">命中批次</span>
          <strong className="stat-value">{summary.batchCount}</strong>
        </article>
      </div>

      <p className="status-legend">
        {STATUS_FILTERS.map((status) => (
          <span key={status} className="legend-item">
            {status}：
            {status === '全部'
              ? rows.length
              : rows.filter((row) => row.scheme.status === status).length}
          </span>
        ))}
        <span className="legend-item">白名单重复记录：{summary.duplicateWhitelist}</span>
      </p>

      <form className="filter-bar" onSubmit={(event) => event.preventDefault()}>
        <label className="filter-item">
          <span>方案编号 / 名称 / 分组标识 / 页面</span>
          <input
            value={keyword}
            placeholder="例如 ABGR-0002 或 recall"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <label className="filter-item">
          <span>方案状态</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn ghost"
          type="button"
          onClick={() => {
            setKeyword('')
            setStatusFilter('全部')
          }}
        >
          重置条件
        </button>
      </form>

      <DiagnosticList
        diagnostics={state.diagnostics}
        onRecover={() => {
          reload()
          setFault(experimentFault())
          setFeedback({ tone: 'info', text: '已重新读取本地状态。' })
        }}
        onRetry={
          lastAction
            ? () => {
                const row = rows.find((item) => item.scheme.code === lastAction.schemeCode)
                if (row) {
                  handleRefresh(row, lastAction.entrances)
                }
              }
            : undefined
        }
      />

      {empty ? (
        <EmptyState
          title="暂无分流方案"
          hint="分流方案为空时不会产生命中批次；画像与白名单数据同样为空。可恢复示例数据后再试。"
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>方案编号</th>
              <th>方案名称</th>
              <th>方案状态</th>
              <th>画像版本</th>
              <th>实验资格</th>
              <th>排期窗口</th>
              <th>白名单</th>
              <th>累计命中 / 绑定版本</th>
              <th>最近批次</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.scheme.code} className={!row.eligibility.eligible ? 'row-muted' : ''}>
                <td className="mono">
                  <Link className="link" to={`/abgroup/${encodeURIComponent(row.scheme.code)}`}>
                    {row.scheme.code}
                  </Link>
                </td>
                <td>
                  {row.scheme.name}
                  <span className="muted block small-text">
                    {row.scheme.type} · {row.scheme.page}
                  </span>
                </td>
                <td>
                  <SchemeStatusBadge status={row.scheme.status} />
                </td>
                <td>
                  {row.linkedVersion ? (
                    <Link
                      className="link mono"
                      to={`/profile/${encodeURIComponent(row.linkedVersion.id)}`}
                    >
                      {row.linkedVersion.profileCode} · {row.linkedVersion.version}
                    </Link>
                  ) : (
                    <span className="muted">未绑定</span>
                  )}
                  {row.linkedVersion &&
                    (row.linkedVersion.status === '已作废' || row.linkedVersion.voidedAt) && (
                      <span className="muted block small-text">
                        作废于 {fmtDate(row.linkedVersion.voidedAt)}
                      </span>
                    )}
                </td>
                <td>
                  <EligibilityBadge code={row.eligibility.code} />
                  <span className="muted block small-text">{row.eligibility.detail}</span>
                </td>
                <td className="small-text">{row.scheme.scheduleWindow}</td>
                <td>
                  <Link className="link" to={`/abgroup/${encodeURIComponent(row.scheme.code)}`}>
                    {row.whitelistCount} 人
                  </Link>
                  {row.duplicateWhitelistCount > 0 && (
                    <span className="muted block small-text">含 {row.duplicateWhitelistCount} 条重复</span>
                  )}
                </td>
                <td>
                  <strong>{row.hitCount}</strong>
                  <span className="muted block small-text">
                    绑定版本 {row.currentVersionHits}
                    {row.batchCount > 0 ? ` · ${row.batchCount} 批` : ''}
                  </span>
                </td>
                <td>
                  {row.latestBatch ? (
                    <>
                      <span className="mono small-text">{row.latestBatch.id}</span>
                      <span className="muted block small-text">
                        {fmtDate(row.latestBatch.committedAt)}
                      </span>
                    </>
                  ) : (
                    <span className="muted">未生成</span>
                  )}
                </td>
                <td className="row-actions vertical">
                  <button
                    className="link"
                    type="button"
                    onClick={() => handleRefresh(row, ['定时任务', '运营后台'])}
                  >
                    刷新命中（双入口）
                  </button>
                  <button className="link" type="button" onClick={() => handleRefresh(row, ['运营后台'])}>
                    仅运营后台触发
                  </button>
                  {row.scheme.status !== '已生效' ? (
                    <button className="link" type="button" onClick={() => handleAction(row.scheme.code, '生效方案')}>
                      生效方案
                    </button>
                  ) : (
                    <button className="link danger" type="button" onClick={() => handleAction(row.scheme.code, '下线方案')}>
                      下线方案
                    </button>
                  )}
                  {row.scheme.status === '草稿' && (
                    <button className="link" type="button" onClick={() => handleAction(row.scheme.code, '提交方案评审')}>
                      提交方案评审
                    </button>
                  )}
                  <Link className="link" to={`/abgroup/${encodeURIComponent(row.scheme.code)}`}>
                    查看详情
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="empty-state" colSpan={10}>
                  没有符合筛选条件的分流方案，可重置条件后重试
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {audit && (
        <section className="audit-panel">
          <SectionHead
            title={`核查结果：${audit.total} 项，失败 ${audit.failed} 项`}
            extra={
              <button className="btn small ghost" type="button" onClick={() => setAudit(null)}>
                收起核查
              </button>
            }
          />
          <table className="data-table">
            <thead>
              <tr>
                <th>对象类型</th>
                <th>对象</th>
                <th>核查项</th>
                <th>结论</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {audit.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.object}</td>
                  <td className="mono">{item.name}</td>
                  <td>{item.check}</td>
                  <td>
                    {item.ok ? (
                      <Badge tone="green">通过</Badge>
                    ) : item.severity === 'block' ? (
                      <Badge tone="red">阻断</Badge>
                    ) : (
                      <Badge tone="amber">提示</Badge>
                    )}
                  </td>
                  <td>{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="fault-panel">
        <SectionHead title="异常演练（本地）" />
        <p className="muted">
          一次性故障开关：执行刷新命中或方案动作时触发，可观察失败回滚、中断恢复和异常原因说明。
        </p>
        <div className="inline-actions">
          {(['none', 'commit-fail', 'interrupt-before-write', 'interrupt-after-write'] as FaultMode[]).map(
            (mode) => (
              <label key={mode} className="radio-item">
                <input
                  type="radio"
                  name="ab-fault"
                  checked={fault === mode}
                  onChange={() => handleFault(mode)}
                />
                {mode === 'none'
                  ? '无故障'
                  : mode === 'commit-fail'
                    ? '提交失败（回滚）'
                    : mode === 'interrupt-before-write'
                      ? '写入前中断'
                      : '写入后中断'}
              </label>
            ),
          )}
        </div>
      </section>

      <footer className="page-foot">
        <span>
          共 {filtered.length} 个分流方案 · 历史边界按「{summary.historyPolicy}」
        </span>
      </footer>
    </section>
  )
}
