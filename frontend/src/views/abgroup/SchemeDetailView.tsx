import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  addWhitelistUser,
  experimentUsers,
  getSchemeDetail,
  loadExperimentState,
  removeWhitelistUser,
} from '@/api/experiment-service'
import type { ExperimentDiagnostic, SchemeDetail } from '@/data/experiment-types'
import {
  AttemptStatusBadge,
  Badge,
  DiagnosticList,
  EligibilityBadge,
  EmptyState,
  HistoricalBadge,
  KeyValue,
  SKIP_LABELS,
  SchemeStatusBadge,
  SectionHead,
  fmtDate,
} from '@/views/experiment/shared'

type Feedback = { tone: 'ok' | 'error' | 'info'; text: string; detail?: string } | null

export default function SchemeDetailView({ schemeCode }: { schemeCode: string }) {
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState(() => loadExperimentState())
  const [message, setMessage] = useState<Feedback>(null)
  const [userId, setUserId] = useState('')
  const [tab, setTab] = useState<'preview' | 'whitelist' | 'batches' | 'hits' | 'attempts'>('preview')

  const reload = useCallback(() => setSnapshot(loadExperimentState()), [])
  const state = snapshot.state
  const detail = getSchemeDetail(schemeCode)
  const users = experimentUsers(state)
  const diagnostics: ExperimentDiagnostic[] = state.diagnostics

  if (!detail) {
    return (
      <section className="page" data-module="abgroup-detail">
        <header className="page-head">
          <div>
            <h2>分流方案详情</h2>
            <p className="page-desc">没有找到分流方案 {schemeCode}</p>
          </div>
        </header>
        <EmptyState title={`没有找到分流方案 ${schemeCode}`} hint="该方案可能不存在或已被清理。" />
        <div className="inline-actions">
          <button className="btn" type="button" onClick={() => navigate('/abgroup')}>
            返回分流列表
          </button>
        </div>
      </section>
    )
  }

  function handleAdd() {
    if (userId.trim() === '') {
      setMessage({ tone: 'error', text: '请选择或输入要加入白名单的用户' })
      return
    }
    const result = addWhitelistUser(schemeCode, userId.trim())
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.message, detail: result.diagnostic?.reason })
      return
    }
    setMessage({ tone: 'ok', text: result.message })
    setUserId('')
    reload()
  }

  function handleRemove(target: string) {
    const result = removeWhitelistUser(schemeCode, target)
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.message, detail: result.diagnostic?.reason })
      return
    }
    setMessage({ tone: 'ok', text: result.message })
    reload()
  }

  return (
    <SchemeDetailBody
      detail={detail}
      diagnostics={diagnostics}
      users={users}
      message={message}
      userId={userId}
      tab={tab}
      onTab={setTab}
      onUserInput={setUserId}
      onAdd={handleAdd}
      onRemove={handleRemove}
      onMessage={setMessage}
      onReload={reload}
      onBack={() => navigate('/abgroup')}
    />
  )
}

function SchemeDetailBody({
  detail,
  diagnostics,
  users,
  message,
  userId,
  tab,
  onTab,
  onUserInput,
  onAdd,
  onRemove,
  onMessage,
  onReload,
  onBack,
}: {
  detail: SchemeDetail
  diagnostics: ExperimentDiagnostic[]
  users: { id: string; name: string; source: string }[]
  message: Feedback
  userId: string
  tab: 'preview' | 'whitelist' | 'batches' | 'hits' | 'attempts'
  onTab: (value: 'preview' | 'whitelist' | 'batches' | 'hits' | 'attempts') => void
  onUserInput: (value: string) => void
  onAdd: () => void
  onRemove: (userId: string) => void
  onMessage: (value: Feedback) => void
  onReload: () => void
  onBack: () => void
}) {
  const { row } = detail
  const targetLayerNames = row.scheme.targetLayers.join('、') || '—'
  const tabs = [
    ['preview', `命中预演（${detail.preview.hits.length} 人可命中）`],
    ['whitelist', `白名单（${detail.whitelist.length}）`],
    ['batches', `批次（${detail.batches.length}）`],
    ['hits', `命中明细（${detail.hits.length}）`],
    ['attempts', `触发记录（${detail.attempts.length}）`],
  ] as const

  return (
    <section className="page" data-module="abgroup-detail">
      <header className="page-head">
        <div>
          <h2>
            分流方案详情：{row.scheme.code} {row.scheme.name}
          </h2>
          <p className="page-desc">
            当前状态 <SchemeStatusBadge status={row.scheme.status} /> · 画像版本{' '}
            <span className="mono">{row.linkedVersionLabel}</span> · 历史边界口径：{detail.historyPolicy}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" type="button" onClick={onBack}>
            返回分流列表
          </button>
        </div>
      </header>

      <DiagnosticList diagnostics={diagnostics} onRecover={onReload} />

      {message && (
        <div className={`feedback feedback-${message.tone}`}>
          <span>{message.text}</span>
          {message.detail && <span className="feedback-detail">{message.detail}</span>}
          <button className="link" type="button" onClick={() => onMessage(null)}>
            收起
          </button>
        </div>
      )}

      <div className="detail-grid">
        <section className="detail-card">
          <SectionHead title="实验资格" />
          <EligibilityBadge code={detail.eligibility.code} />
          <p>{detail.eligibility.detail}</p>
          <KeyValue label="方案状态">{row.scheme.status}</KeyValue>
          <KeyValue label="排期窗口">{row.scheme.scheduleWindow}</KeyValue>
          <KeyValue label="排期入口">{row.scheme.scheduleEntrances.join(' / ')}</KeyValue>
          <KeyValue label="目标分层">{targetLayerNames}</KeyValue>
          <KeyValue label="分流比例">{row.scheme.ratio}</KeyValue>
          <KeyValue label="互斥规则">{row.scheme.mutexRule}</KeyValue>
        </section>

        <section className="detail-card">
          <SectionHead title="命中人数（按画像版本）" />
          <KeyValue label="累计命中人数">{detail.totals.cumulativeHitCount}</KeyValue>
          <KeyValue label="绑定画像版本命中人数">
            {detail.totals.currentVersionHits}
            <span className="muted small-text">（与列表同一口径）</span>
          </KeyValue>
          <KeyValue label="按版本人数之和">
            {detail.totals.byVersion.reduce((sum, item) => sum + item.hitCount, 0)}
            <span className="muted small-text">
              （同一用户只进入实验一次，与累计人数一致）
            </span>
          </KeyValue>
          <KeyValue label="批次数量">{detail.totals.batchCount}</KeyValue>
          {detail.totals.byVersion.length === 0 && <p className="muted">暂无命中批次。</p>}
          {detail.totals.byVersion.map((item) => (
            <div key={item.profileVersionId} className="layer-item">
              <span className="mono">{item.profileVersionLabel}</span>
              <strong>{item.hitCount} 人</strong>
              <span className="muted">{item.batchCount} 个批次</span>
              {item.nowStatus === '已作废' ? (
                <Badge tone="red">已作废 · 历史冻结</Badge>
              ) : (
                <Badge tone="green">{item.nowStatus}</Badge>
              )}
            </div>
          ))}
        </section>

        <section className="detail-card">
          <SectionHead title="最近触发结果" />
          {detail.attempts.length === 0 && <p className="muted">暂无触发记录。</p>}
          {detail.attempts.slice(0, 5).map((attempt) => (
            <div key={attempt.id} className="layer-item">
              <AttemptStatusBadge status={attempt.status} />
              <span className="mono">{attempt.id}</span>
              <span className="muted">{fmtDate(attempt.at)}</span>
              <span className="muted small-text">{attempt.message}</span>
            </div>
          ))}
        </section>

        <section className="detail-card">
          <SectionHead title="画像生命周期联动记录" />
          {detail.linkageEvents.length === 0 && <p className="muted">暂无联动记录。</p>}
          {detail.linkageEvents.map((event) => (
            <div key={event.id} className="layer-item">
              <Badge tone={event.kind === 'void-profile' ? 'red' : 'blue'}>
                {event.kind === 'void-profile'
                  ? '画像作废'
                  : event.kind === 'publish-profile'
                    ? '画像发布'
                    : '画像更新'}
              </Badge>
              <span className="muted">{fmtDate(event.at)}</span>
              <span className="small-text">{event.note}</span>
            </div>
          ))}
        </section>
      </div>

      <div className="tab-bar">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={`tab ${tab === key ? 'active' : ''}`}
            type="button"
            onClick={() => onTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'preview' && (
        <section className="detail-card">
          <SectionHead
            title="命中预演"
            extra={<span className="muted">解释每个用户为何未命中、来自哪个画像版本</span>}
          />
          <p className={detail.preview.eligible ? 'text-ok' : 'text-error'}>
            {detail.preview.eligible
              ? `方案具备实验资格，依据 ${detail.preview.profileVersionLabel} 计算。`
              : `方案当前不具备实验资格：${detail.preview.reason}`}
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>画像版本</th>
                <th>用户</th>
                <th>分层</th>
                <th>结论</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {detail.preview.hits.map((hit) => (
                <tr key={`hit-${hit.userId}`}>
                  <td className="mono">{detail.preview.profileVersionLabel}</td>
                  <td>
                    {hit.userName} <span className="muted mono">{hit.userId}</span>
                  </td>
                  <td>{hit.layerName}</td>
                  <td>
                    <Badge tone="green">可命中</Badge>
                  </td>
                  <td>目标分层内，且尚未在本方案命中</td>
                </tr>
              ))}
              {detail.preview.skips.map((skip, index) => (
                <tr key={`skip-${skip.userId}-${index}`}>
                  <td className="mono">{skip.profileVersionLabel}</td>
                  <td>
                    {skip.userName} <span className="muted mono">{skip.userId}</span>
                  </td>
                  <td>—</td>
                  <td>
                    <Badge tone={skip.code === 'already-hit' ? 'amber' : 'gray'}>
                      {SKIP_LABELS[skip.code]}
                    </Badge>
                  </td>
                  <td>{skip.reason}</td>
                </tr>
              ))}
              {detail.preview.hits.length === 0 && detail.preview.skips.length === 0 && (
                <tr>
                  <td className="empty-state" colSpan={5}>
                    暂无白名单用户，命中预演为空
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'whitelist' && (
        <section className="detail-card">
          <SectionHead title="白名单用户" />
          <div className="inline-actions whitelist-add">
            <input
              value={userId}
              placeholder="输入用户编号，例如 U-0013"
              onChange={(event) => onUserInput(event.target.value)}
              list={`users-${row.scheme.code}`}
            />
            <datalist id={`users-${row.scheme.code}`}>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {user.source}
                </option>
              ))}
            </datalist>
            <button className="btn primary small" type="button" onClick={onAdd}>
              加入白名单
            </button>
            <span className="muted small-text">重复用户会被拒绝，不会重复扩大人群。</span>
          </div>
          {detail.whitelist.length === 0 ? (
            <EmptyState title="暂无白名单用户" hint="白名单为空时命中预演不会产生候选用户。" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>用户编号</th>
                  <th>用户</th>
                  <th>加入时间</th>
                  <th>分层</th>
                  <th>当前结论</th>
                  <th>说明</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {detail.whitelist.map((item, index) => (
                  <tr key={`${item.userId}-${index}`} className={item.duplicated ? 'row-muted' : ''}>
                    <td className="mono">{item.userId}</td>
                    <td>{item.userName}</td>
                    <td>{fmtDate(item.addedAt)}</td>
                    <td>{item.layerName}</td>
                    <td>
                      {item.evaluationCode === 'hit' ? (
                        <Badge tone="green">可命中</Badge>
                      ) : (
                        <Badge tone={item.duplicated ? 'amber' : 'gray'}>
                          {SKIP_LABELS[item.evaluationCode as keyof typeof SKIP_LABELS] ??
                            item.evaluationCode}
                        </Badge>
                      )}
                      {item.alreadyHitBatchId && (
                        <span className="muted block small-text">
                          已命中 {item.alreadyHitBatchId}（{item.alreadyHitVersionLabel}）
                        </span>
                      )}
                    </td>
                    <td className="small-text">{item.evaluationReason}</td>
                    <td>
                      <button className="link danger" type="button" onClick={() => onRemove(item.userId)}>
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'batches' && (
        <section className="detail-card">
          <SectionHead
            title="命中批次"
            extra={<span className="muted">历史批次按当时画像版本冻结，新批次不会改写旧人数</span>}
          />
          {detail.batches.length === 0 ? (
            <EmptyState title="暂无命中批次" hint="方案具备资格时刷新命中即可生成第一个批次。" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>批次号</th>
                  <th>画像版本</th>
                  <th>排期窗口</th>
                  <th>入口</th>
                  <th>提交时间</th>
                  <th>本批人数</th>
                  <th>累计人数</th>
                  <th>批次性质</th>
                  <th>前序批次</th>
                </tr>
              </thead>
              <tbody>
                {detail.batches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="mono">{batch.id}</td>
                    <td>
                      <span className="mono">{batch.profileVersionLabel}</span>
                      <span className="muted block small-text">
                        当前状态：{batch.profileVersionNowStatus}
                      </span>
                    </td>
                    <td>{batch.windowKey}</td>
                    <td>{batch.entrances.join(' / ')}</td>
                    <td>{fmtDate(batch.committedAt)}</td>
                    <td>{batch.hits.length}</td>
                    <td>{batch.cumulativeHitCount}</td>
                    <td>
                      <HistoricalBadge historical={batch.isHistorical} />
                    </td>
                    <td className="mono small-text">{batch.previousBatchId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'hits' && (
        <section className="detail-card">
          <SectionHead
            title="命中明细"
            extra={
              <span className="muted">
                不同画像版本的命中分开列示，合计 {detail.totals.cumulativeHitCount} 人
              </span>
            }
          />
          {detail.hits.length === 0 ? (
            <EmptyState title="暂无命中记录" hint="刷新命中生成批次后，这里会按批次展示用户。" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>用户编号</th>
                  <th>用户</th>
                  <th>画像版本</th>
                  <th>分层</th>
                  <th>批次</th>
                  <th>入口</th>
                  <th>命中时间</th>
                  <th>批次性质</th>
                </tr>
              </thead>
              <tbody>
                {detail.hits.map((hit) => (
                  <tr key={`${hit.batchId}-${hit.userId}`}>
                    <td className="mono">{hit.userId}</td>
                    <td>{hit.userName}</td>
                    <td className="mono">{hit.profileVersionLabel}</td>
                    <td>{hit.layerName}</td>
                    <td className="mono">{hit.batchId}</td>
                    <td>{hit.batchEntrances.join(' / ')}</td>
                    <td>{fmtDate(hit.hitAt)}</td>
                    <td>
                      <HistoricalBadge historical={hit.isHistorical} />
                      <span className="muted block small-text">
                        版本当前状态：{hit.profileVersionNowStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'attempts' && (
        <section className="detail-card">
          <SectionHead title="触发记录" />
          {detail.attempts.length === 0 ? (
            <EmptyState title="暂无触发记录" hint="每次刷新命中都会留下一条结果说明。" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>记录号</th>
                  <th>时间</th>
                  <th>入口</th>
                  <th>画像版本</th>
                  <th>结果</th>
                  <th>新增人数</th>
                  <th>批次</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {detail.attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td className="mono">{attempt.id}</td>
                    <td>{fmtDate(attempt.at)}</td>
                    <td>{attempt.entrances.join(' / ')}</td>
                    <td className="mono">{attempt.profileVersionLabel}</td>
                    <td>
                      <AttemptStatusBadge status={attempt.status} />
                    </td>
                    <td>{attempt.newHitCount}</td>
                    <td className="mono small-text">{attempt.batchId ?? '—'}</td>
                    <td className="small-text">{attempt.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <footer className="page-foot">
        <span>
          {row.eligibility.eligible
            ? '该方案仍具备实验资格，可继续生成新命中批次。'
            : `该方案当前不具备实验资格：${row.eligibility.label}；历史批次仍可查。`}
        </span>
        <button
          className="btn small ghost"
          type="button"
          onClick={() => {
            onReload()
            onMessage({ tone: 'info', text: '已重新读取方案、白名单与命中数据。' })
          }}
        >
          重新读取
        </button>
      </footer>
    </section>
  )
}
