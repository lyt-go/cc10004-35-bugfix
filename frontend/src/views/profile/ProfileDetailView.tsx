import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { getProfileDetail, loadExperimentState } from '@/api/experiment-service'
import type { ExperimentDiagnostic, ProfileDetail } from '@/data/experiment-types'
import {
  Badge,
  DiagnosticList,
  EligibilityBadge,
  EmptyState,
  KeyValue,
  ProfileStatusBadge,
  SectionHead,
  fmtDate,
} from '@/views/experiment/shared'

type Feedback = { tone: 'ok' | 'error' | 'info'; text: string; detail?: string } | null

export default function ProfileDetailView({ versionId }: { versionId: string }) {
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState(() => loadExperimentState())
  const [feedback, setFeedback] = useState<Feedback>(null)
  const reload = useCallback(() => setSnapshot(loadExperimentState()), [])
  const detail = getProfileDetail(versionId)
  const diagnostics: ExperimentDiagnostic[] = snapshot.state.diagnostics

  if (!detail) {
    return (
      <section className="page" data-module="profile-detail">
        <header className="page-head">
          <div>
            <h2>画像版本详情</h2>
            <p className="page-desc">没有找到画像版本 {versionId}</p>
          </div>
        </header>
        <EmptyState title={`没有找到画像版本 ${versionId}`} hint="该版本可能不存在或已被清理。" />
        <div className="inline-actions">
          <button className="btn" type="button" onClick={() => navigate('/profile')}>
            返回画像列表
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="page" data-module="profile-detail">
      <header className="page-head">
        <div>
          <h2>
            画像版本详情：{detail.profile.profileCode} · {detail.profile.version}
          </h2>
          <p className="page-desc">
            {detail.profile.profileName} · 当前状态{' '}
            <ProfileStatusBadge status={detail.profile.status} /> · 历史边界口径：
            {detail.historyPolicy}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" type="button" onClick={() => navigate('/profile')}>
            返回画像列表
          </button>
        </div>
      </header>

      <DiagnosticList diagnostics={diagnostics} onRecover={reload} />

      {feedback && (
        <div className={`feedback feedback-${feedback.tone}`}>
          <span>{feedback.text}</span>
          {feedback.detail && <span className="feedback-detail">{feedback.detail}</span>}
          <button className="link" type="button" onClick={() => setFeedback(null)}>
            收起
          </button>
        </div>
      )}

      <ProfileDetailBody detail={detail} />

      <footer className="page-foot">
        <span>
          {detail.row.status === '已作废'
            ? '该版本已作废：不再进入新命中计算，作废前批次已冻结。'
            : '该版本仍可作为方案的命中依据。'}
        </span>
        <button
          className="btn small ghost"
          type="button"
          onClick={() => {
            reload()
            setFeedback({ tone: 'info', text: '已重新读取画像与命中数据。' })
          }}
        >
          重新读取
        </button>
      </footer>
    </section>
  )
}

function ProfileDetailBody({ detail }: { detail: ProfileDetail }) {
  const { row, profile } = detail
  return (
    <>
      <div className="detail-grid">
        <section className="detail-card">
          <SectionHead title="版本信息" />
          <KeyValue label="画像编号">{profile.profileCode}</KeyValue>
          <KeyValue label="版本">{profile.version}</KeyValue>
          <KeyValue label="统计维度">{profile.dimensions}</KeyValue>
          <KeyValue label="聚合指标">{profile.aggregateMetric}</KeyValue>
          <KeyValue label="分层区间">{profile.layerRange}</KeyValue>
          <KeyValue label="更新周期">{profile.updateCycle}</KeyValue>
          <KeyValue label="发布时间">{fmtDate(profile.publishedAt)}</KeyValue>
          <KeyValue label="作废时间">{fmtDate(profile.voidedAt)}</KeyValue>
          <KeyValue label="覆盖用户">{row.coverage}</KeyValue>
          <KeyValue label="累计命中人数">{row.hitCount}</KeyValue>
          {profile.note && <p className="muted small-text">{profile.note}</p>}
        </section>

        <section className="detail-card">
          <SectionHead title="分层人群（版本快照）" />
          {profile.layers.length === 0 && <p className="muted">该版本没有分层人群。</p>}
          {profile.layers.map((layer) => (
            <div key={layer.name} className="layer-item">
              <strong>{layer.name}</strong>
              <span className="muted">{layer.userIds.length} 人</span>
              <span className="mono muted small-text">{layer.userIds.join('、') || '空层'}</span>
            </div>
          ))}
        </section>

        <section className="detail-card">
          <SectionHead title="关联分流方案与实验资格" />
          {detail.linkedSchemes.length === 0 && <p className="muted">暂无方案绑定此版本。</p>}
          {detail.linkedSchemes.map((scheme) => (
            <div key={scheme.code} className="layer-item">
              <Link className="link" to={`/abgroup/${encodeURIComponent(scheme.code)}`}>
                {scheme.code} {scheme.name}
              </Link>
              <span className="muted">{scheme.status}</span>
              <EligibilityBadge code={scheme.eligibility.code} />
              <span className="muted small-text">{scheme.eligibility.detail}</span>
            </div>
          ))}
        </section>

        <section className="detail-card">
          <SectionHead title="同画像的其他版本" />
          {detail.siblings.map((sibling) => (
            <div key={sibling.versionId} className="layer-item">
              <Link className="link mono" to={`/profile/${encodeURIComponent(sibling.versionId)}`}>
                {sibling.version}
              </Link>
              <ProfileStatusBadge status={sibling.status} />
              <span className="muted">发布 {fmtDate(sibling.publishedAt)}</span>
              {sibling.voidedAt && <span className="muted">作废 {fmtDate(sibling.voidedAt)}</span>}
            </div>
          ))}
        </section>
      </div>

      <SectionHead
        title={`历史命中批次（${detail.totals.batchCount} 个批次 / ${detail.totals.cumulativeHitCount} 人）`}
        extra={<span className="muted">历史冻结批次 {detail.totals.historicalBatchCount} 个</span>}
      />
      {detail.batches.length === 0 ? (
        <EmptyState title="该版本暂无命中批次" hint="发布并接入方案、命中后在这里查看批次。" />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>批次号</th>
              <th>方案</th>
              <th>排期窗口</th>
              <th>触发入口</th>
              <th>提交时间</th>
              <th>本批人数</th>
              <th>批次性质</th>
              <th>命中用户</th>
            </tr>
          </thead>
          <tbody>
            {detail.batches.map((batch) => (
              <tr key={batch.id}>
                <td className="mono">{batch.id}</td>
                <td className="mono">{batch.schemeCode}</td>
                <td>{batch.windowKey}</td>
                <td>{batch.entrances.join(' / ')}</td>
                <td>{fmtDate(batch.committedAt)}</td>
                <td>{batch.hits.length}</td>
                <td>
                  {batch.isHistorical ? (
                    <Badge tone="purple">历史批次 · 冻结</Badge>
                  ) : (
                    <Badge tone="blue">当前版本批次</Badge>
                  )}
                </td>
                <td className="mono small-text">
                  {batch.hits.map((hit) => hit.userId).join('、') || '无'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
