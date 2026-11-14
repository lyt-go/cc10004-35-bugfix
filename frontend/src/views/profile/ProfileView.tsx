import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  clearExperiment,
  experimentAudit,
  experimentFault,
  experimentSummary,
  loadExperimentState,
  profileRows,
  publishProfile,
  resetExperiment,
  reviseAndPublish,
  reviseProfile,
  setExperimentFault,
  voidProfile,
} from '@/api/experiment-service'
import type { FaultMode } from '@/data/experiment-store'
import type { AuditResult, ProfileLifecycleStatus } from '@/data/experiment-types'
import {
  Badge,
  DiagnosticList,
  EmptyState,
  ProfileStatusBadge,
  SectionHead,
  downloadCsv,
  fmtDate,
} from '@/views/experiment/shared'

const STATUS_FILTERS: (ProfileLifecycleStatus | '全部')[] = ['全部', '草稿', '画像评审中', '已发布', '已作废']

type Feedback = { tone: 'ok' | 'error' | 'info'; text: string; detail?: string } | null

function useExperimentSnapshot() {
  const [snapshot, setSnapshot] = useState(() => loadExperimentState())
  const reload = useCallback(() => setSnapshot(loadExperimentState()), [])
  return { snapshot, reload }
}

export default function ProfileView() {
  const { snapshot, reload } = useExperimentSnapshot()
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('全部')
  const [fault, setFault] = useState<FaultMode>(() => experimentFault())

  const state = snapshot.state
  const rows = useMemo(() => profileRows(state), [state])
  const summary = useMemo(() => experimentSummary(state), [state])
  const empty = state.profiles.length === 0
  const diagnostics = state.diagnostics

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const matchStatus = statusFilter === '全部' || row.status === statusFilter
        const matchKeyword =
          keyword.trim() === '' ||
          `${row.profileCode} ${row.profileName} ${row.version} ${row.dimensions}`
            .toLowerCase()
            .includes(keyword.trim().toLowerCase())
        return matchStatus && matchKeyword
      }),
    [rows, statusFilter, keyword],
  )

  function refreshAfter(message: Feedback) {
    setFeedback(message)
    reload()
    setFault(experimentFault())
  }

  function handlePublish(versionId: string, recompute: boolean) {
    const result = publishProfile(versionId, { recompute, entrances: ['画像发布'] })
    if (!result.ok) {
      refreshAfter({ tone: 'error', text: result.message, detail: result.diagnostic?.reason })
      return
    }
    refreshAfter({
      tone: 'ok',
      text: result.data.message,
      detail: recompute ? '画像更新与命中结果已在同一批提交中写入。' : undefined,
    })
  }

  function handleVoid(versionId: string) {
    const result = voidProfile(versionId)
    if (!result.ok) {
      refreshAfter({ tone: 'error', text: result.message, detail: result.diagnostic?.reason })
      return
    }
    refreshAfter({ tone: 'ok', text: result.data.message })
  }

  function handleUpdate(versionId: string) {
    const result = reviseAndPublish(versionId)
    if (!result.ok) {
      refreshAfter({ tone: 'error', text: result.message, detail: result.diagnostic?.reason })
      return
    }
    refreshAfter({ tone: 'ok', text: result.data.message, detail: '旧版本与历史批次保持原样。' })
  }

  function handleDraftOnly(versionId: string) {
    const result = reviseProfile(versionId)
    if (!result.ok) {
      refreshAfter({ tone: 'error', text: result.message, detail: result.diagnostic?.reason })
      return
    }
    refreshAfter({ tone: 'info', text: result.data.message })
  }

  function handleAudit() {
    setAudit(experimentAudit())
  }

  function handleClearEmpty() {
    const result = clearExperiment()
    if (!result.ok) {
      setFeedback({ tone: 'error', text: result.message })
      return
    }
    refreshAfter({ tone: 'info', text: '已清空实验域，页面进入空态；可随时恢复示例数据。' })
  }

  function handleReset() {
    const result = resetExperiment()
    if (!result.ok) {
      refreshAfter({ tone: 'error', text: result.message, detail: result.diagnostic?.reason })
      return
    }
    refreshAfter({ tone: 'ok', text: '已恢复示例数据。' })
  }

  function handleFault(mode: FaultMode) {
    setExperimentFault(mode)
    setFault(mode)
    setFeedback({
      tone: 'info',
      text:
        mode === 'none'
          ? '已关闭故障演练，后续提交正常落盘。'
          : '已开启一次性故障演练：下一次提交会失败/中断，可按提示重试或恢复。',
    })
  }

  function handleExport() {
    downloadCsv(
      '画像版本清单.csv',
      ['画像版本', '画像编号', '画像名称', '版本状态', '发布时间', '作废时间', '覆盖用户', '累计命中人数', '关联方案'],
      rows.map((row) => [
        `${row.profileCode} · ${row.version}`,
        row.profileCode,
        row.profileName,
        row.status,
        fmtDate(row.publishedAt),
        fmtDate(row.voidedAt),
        row.coverage,
        row.hitCount,
        row.linkedSchemes.join(' / ') || '无',
      ]),
    )
  }

  return (
    <section className="page" data-module="profile">
      <header className="page-head">
        <div>
          <h2>用户画像管理</h2>
          <p className="page-desc">
            画像按版本管理：作废版本退出新命中计算，历史命中批次按当时版本冻结保留。
            历史边界口径：{summary.historyPolicy}。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => handleAudit()}>
            核查画像 / 方案 / 白名单
          </button>
          <button className="btn" type="button" onClick={handleExport} disabled={empty}>
            导出画像版本清单
          </button>
          <button className="btn" type="button" onClick={handleReset}>
            恢复示例数据
          </button>
        </div>
      </header>

      {feedback && (
        <div className={`feedback feedback-${feedback.tone}`}>
          <span>{feedback.text}</span>
          {feedback.detail && <span className="feedback-detail">{feedback.detail}</span>}
          <button className="link" type="button" onClick={() => setFeedback(null)}>
            收起
          </button>
        </div>
      )}

      <div className="stat-row">
        <article className="stat-card">
          <span className="stat-label">画像版本总数</span>
          <strong className="stat-value">{summary.profileVersions}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">已发布版本</span>
          <strong className="stat-value">{summary.publishedVersions}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">已作废版本</span>
          <strong className="stat-value">{summary.voidedVersions}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">历史冻结命中人数</span>
          <strong className="stat-value">{summary.historicalHits}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">正常命中方案</span>
          <strong className="stat-value">
            {summary.eligibleSchemes} / {summary.schemeCount}
          </strong>
        </article>
      </div>

      <p className="status-legend">
        {STATUS_FILTERS.map((status) => (
          <span key={status} className="legend-item">
            {status}：
            {status === '全部'
              ? rows.length
              : rows.filter((row) => row.status === status).length}
          </span>
        ))}
        <span className="legend-item">
          白名单重复记录：{summary.duplicateWhitelist}
        </span>
      </p>

      <form
        className="filter-bar"
        onSubmit={(event) => {
          event.preventDefault()
        }}
      >
        <label className="filter-item">
          <span>画像编号 / 名称 / 版本 / 维度</span>
          <input
            value={keyword}
            placeholder="例如 PROF-0002 或 活跃"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <label className="filter-item">
          <span>版本状态</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <button className="btn ghost" type="button" onClick={() => { setKeyword(''); setStatusFilter('全部') }}>
          重置条件
        </button>
      </form>

      <DiagnosticList
        diagnostics={diagnostics}
        onRecover={() => {
          reload()
          setFault(experimentFault())
          setFeedback({ tone: 'info', text: '已重新读取本地状态。' })
        }}
      />

      {empty ? (
        <EmptyState
          title="暂无画像版本"
          hint="画像定义为空时不会参与任何分流命中。可恢复示例数据或先登记画像定义。"
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>画像编号</th>
              <th>画像名称</th>
              <th>当前版本</th>
              <th>版本状态</th>
              <th>生效 / 作废</th>
              <th>覆盖用户</th>
              <th>命中人数（累计）</th>
              <th>关联分流方案</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.versionId} className={row.status === '已作废' ? 'row-muted' : ''}>
                <td className="mono">{row.profileCode}</td>
                <td>
                  <Link className="link" to={`/profile/${encodeURIComponent(row.versionId)}`}>
                    {row.profileName}
                  </Link>
                  {row.currentVersionOfProfile && <Badge tone="blue">最新已发布</Badge>}
                </td>
                <td className="mono">{row.version}</td>
                <td>
                  <ProfileStatusBadge status={row.status} />
                  {row.status === '已作废' && row.voidedAt && (
                    <span className="muted block">作废于 {fmtDate(row.voidedAt)}</span>
                  )}
                </td>
                <td>
                  <span className="muted">发布 {fmtDate(row.publishedAt)}</span>
                  {row.voidedAt && <span className="muted block">作废 {fmtDate(row.voidedAt)}</span>}
                </td>
                <td>{row.coverage}</td>
                <td>
                  <strong>{row.hitCount}</strong>
                  {row.status === '已作废' && <span className="muted block">历史冻结</span>}
                </td>
                <td>
                  {row.linkedSchemes.length > 0
                    ? row.linkedSchemes.map((code) => (
                        <Link key={code} className="link chip" to={`/abgroup/${encodeURIComponent(code)}`}>
                          {code}
                        </Link>
                      ))
                    : <span className="muted">未接入方案</span>}
                </td>
                <td className="row-actions">
                  {row.canVoid && (
                    <button className="link danger" type="button" onClick={() => handleVoid(row.versionId)}>
                      作废画像
                    </button>
                  )}
                  {row.canUpdate && row.status === '已发布' && (
                    <button className="link" type="button" onClick={() => handleUpdate(row.versionId)}>
                      更新并重算命中
                    </button>
                  )}
                  {row.canUpdate && (
                    <button className="link" type="button" onClick={() => handleDraftOnly(row.versionId)}>
                      {row.status === '已作废' ? '基于此快照新建草稿' : '另存新版本草稿'}
                    </button>
                  )}
                  {row.canPublish && (
                    <button className="link" type="button" onClick={() => handlePublish(row.versionId, false)}>
                      发布画像
                    </button>
                  )}
                  {row.canPublish && (
                    <button className="link" type="button" onClick={() => handlePublish(row.versionId, true)}>
                      发布并重算命中
                    </button>
                  )}
                  {row.status === '已作废' && (
                    <span className="muted">历史批次只读保留</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="empty-state" colSpan={9}>
                  没有符合筛选条件的画像版本，可重置条件后重试
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
          选择一次性故障后执行任意提交，可观察「失败可重试、中断后恢复、异常原因可读」。
          故障只影响下一次提交；页面会给出重试与恢复入口。
        </p>
        <div className="inline-actions">
          <label className="radio-item">
            <input
              type="radio"
              name="fault"
              checked={fault === 'none'}
              onChange={() => handleFault('none')}
            />
            无故障
          </label>
          <label className="radio-item">
            <input
              type="radio"
              name="fault"
              checked={fault === 'commit-fail'}
              onChange={() => handleFault('commit-fail')}
            />
            提交失败（回滚到上一完整批次）
          </label>
          <label className="radio-item">
            <input
              type="radio"
              name="fault"
              checked={fault === 'interrupt-before-write'}
              onChange={() => handleFault('interrupt-before-write')}
            />
            写入前中断（下次读取回滚）
          </label>
          <label className="radio-item">
            <input
              type="radio"
              name="fault"
              checked={fault === 'interrupt-after-write'}
              onChange={() => handleFault('interrupt-after-write')}
            />
            写入后中断（完成标记缺失）
          </label>
        </div>
      </section>

      <footer className="page-foot">
        <span>共 {filtered.length} 个画像版本 · 历史边界按「{summary.historyPolicy}」</span>
        <div className="inline-actions">
          <button className="btn small ghost" type="button" onClick={handleClearEmpty}>
            清空实验域（空态演练）
          </button>
        </div>
      </footer>
    </section>
  )
}
