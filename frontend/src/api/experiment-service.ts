import {
  clearJournalRaw,
  cloneState,
  consumeFaultMode,
  readFaultMode,
  readJournalRaw,
  readStateRaw,
  seedState,
  setFaultMode,
  writeJournalRaw,
  writeStateRaw,
} from '@/data/experiment-store'
import type { FaultMode } from '@/data/experiment-store'
import { seedUsers } from '@/data/experiment-seed'
import type {
  AbScheme,
  AttemptStatus,
  AuditItem,
  AuditResult,
  BatchView,
  DiagnosticKind,
  EligibilityCode,
  ExperimentDiagnostic,
  ExperimentState,
  HitBatch,
  HitRecord,
  HitView,
  LinkageEvent,
  ProfileBoardRow,
  ProfileDetail,
  ProfileMutationResult,
  ProfileVersion,
  RefreshResult,
  RunAttempt,
  SchemeBoardRow,
  SchemeDetail,
  SchemeEligibility,
  SkipCode,
  SkipRecord,
  WhitelistMember,
  WhitelistView,
} from '@/data/experiment-types'

// 历史边界口径：以画像版本的「作废时间」为准。
// 作废时间之前已提交的历史批次原样保留；作废后该版本不再进入任何新命中计算。
// 若未记录作废时间，则作废状态本身即视为退出新命中，历史批次全部保留。

const MAX_DIAGNOSTICS = 30
const HISTORY_POLICY = '作废时间'

function isoNow(): string {
  return new Date().toISOString()
}

function shortDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '')
}

function profileLabel(version: ProfileVersion): string {
  return `${version.profileCode} · ${version.version}`
}

function versionById(state: ExperimentState, id: string | null): ProfileVersion | null {
  if (!id) {
    return null
  }
  return state.profiles.find((profile) => profile.id === id) ?? null
}

function isVersionVoided(version: ProfileVersion | null): boolean {
  return !!version && (version.status === '已作废' || !!version.voidedAt)
}

function targetLayerNames(scheme: AbScheme): string[] {
  return scheme.targetLayers.filter((name) => name.trim() !== '')
}

function layerOf(version: ProfileVersion | null, scheme: AbScheme, userId: string): string | null {
  if (!version) {
    return null
  }
  for (const layer of version.layers) {
    if (targetLayerNames(scheme).includes(layer.name) && layer.userIds.includes(userId)) {
      return layer.name
    }
  }
  return null
}

function layerExists(version: ProfileVersion | null, scheme: AbScheme): boolean {
  if (!version) {
    return false
  }
  const targets = targetLayerNames(scheme)
  if (targets.length === 0) {
    return false
  }
  return targets.every((name) => version.layers.some((layer) => layer.name === name))
}

function userById(state: ExperimentState, id: string) {
  return state.users.find((user) => user.id === id) ?? null
}

function latestBatchOf(state: ExperimentState, schemeCode?: string): HitBatch | null {
  const batches = state.batches.filter((batch) => !schemeCode || batch.schemeCode === schemeCode)
  return batches.length > 0 ? batches[batches.length - 1] : null
}

function hitBatchesOf(state: ExperimentState, schemeCode: string, versionId?: string): HitBatch[] {
  return state.batches.filter(
    (batch) =>
      batch.schemeCode === schemeCode && (!versionId || batch.profileVersionId === versionId),
  )
}

function cumulativeHits(state: ExperimentState, schemeCode: string): number {
  const users = new Set<string>()
  for (const batch of hitBatchesOf(state, schemeCode)) {
    for (const hit of batch.hits) {
      users.add(hit.userId)
    }
  }
  return users.size
}

function currentVersionHits(state: ExperimentState, scheme: AbScheme): number {
  const version = versionById(state, scheme.linkedProfileVersionId)
  if (!version) {
    return 0
  }
  const users = new Set<string>()
  for (const batch of hitBatchesOf(state, scheme.code, version.id)) {
    for (const hit of batch.hits) {
      users.add(hit.userId)
    }
  }
  return users.size
}

/** 方案的实验资格：已生效 + 绑定画像已发布 + 目标分层存在。作废画像立即失去资格。 */
export function schemeEligibility(state: ExperimentState, scheme: AbScheme): SchemeEligibility {
  if (scheme.status !== '已生效') {
    return {
      eligible: false,
      code: 'scheme-inactive',
      label: `方案「${scheme.status}」`,
      detail: `分流方案当前状态是「${scheme.status}」，只有已生效方案参与命中计算。`,
    }
  }
  const version = versionById(state, scheme.linkedProfileVersionId)
  if (!version) {
    return {
      eligible: false,
      code: 'profile-missing',
      label: '画像版本缺失',
      detail: '方案绑定的画像版本不存在，无法计算命中；需要重新绑定一个已发布版本。',
    }
  }
  if (isVersionVoided(version)) {
    return {
      eligible: false,
      code: 'profile-voided',
      label: '画像已作废',
      detail: `画像 ${profileLabel(version)} 已于 ${version.voidedAt ?? '未知时间'} 作废，已退出新命中计算；作废前的历史批次保留可查。`,
    }
  }
  if (version.status !== '已发布') {
    return {
      eligible: false,
      code: 'profile-unpublished',
      label: `画像「${version.status}」`,
      detail: `画像 ${profileLabel(version)} 当前状态是「${version.status}」，未发布版本不参与命中计算。`,
    }
  }
  if (!layerExists(version, scheme)) {
    return {
      eligible: false,
      code: 'layer-missing',
      label: '目标分层缺失',
      detail: `画像版本 ${profileLabel(version)} 中找不到方案目标分层（${targetLayerNames(scheme).join('、') || '未配置'}）。`,
    }
  }
  return {
    eligible: true,
    code: 'eligible',
    label: '具备实验资格',
    detail: `方案已生效，绑定画像 ${profileLabel(version)} 已发布且目标分层存在。`,
  }
}

function eligibilityToSkipCode(code: EligibilityCode): SkipCode {
  if (code === 'profile-voided') return 'profile-voided'
  if (code === 'profile-missing') return 'profile-missing'
  if (code === 'profile-unpublished') return 'profile-unpublished'
  if (code === 'layer-missing') return 'layer-missing'
  return 'scheme-ineligible'
}

/**
 * 一个用户在同一方案里只进入实验人群一次。
 * 查重跨画像版本进行：画像更新后旧版本的命中仍计入累计人数，
 * 否则累计人数与按版本拆分的人数会对不上，重复提交也可能再次扩大人群。
 */
function alreadyHit(
  state: ExperimentState,
  schemeCode: string,
  versionId: string,
  userId: string,
): { batchId: string; versionLabel: string; sameVersion: boolean } | null {
  for (const batch of hitBatchesOf(state, schemeCode)) {
    if (batch.hits.some((item) => item.userId === userId)) {
      return {
        batchId: batch.id,
        versionLabel: batch.profileVersionLabel,
        sameVersion: batch.profileVersionId === versionId,
      }
    }
  }
  return null
}

type Evaluation = {
  hits: HitRecord[]
  skips: SkipRecord[]
  uniqueCount: number
}

/**
 * 命中预演/计算：
 * - 白名单是实验受众，重复登记只算一次；
 * - 只保留目标分层内的用户；
 * - 同方案 + 同画像版本已命中的用户不再计入，保证重复提交不扩大人群。
 */
function evaluateAudience(state: ExperimentState, scheme: AbScheme, version: ProfileVersion): Evaluation {
  const seen = new Set<string>()
  const unique: WhitelistMember[] = []
  const skips: SkipRecord[] = []
  const hits: HitRecord[] = []
  const hitAt = isoNow()
  const targetLabel = targetLayerNames(scheme).join('、') || '未配置'

  for (const entry of state.whitelist.filter((item) => item.schemeCode === scheme.code)) {
    if (seen.has(entry.userId)) {
      const user = userById(state, entry.userId)
      skips.push({
        userId: entry.userId,
        userName: user ? user.name : entry.userId,
        code: 'duplicate-whitelist',
        reason: `${user ? user.name : entry.userId}（${entry.userId}）在方案白名单登记了多次，已合并为 1 次，不会重复扩大人群`,
        profileVersionId: version.id,
        profileVersionLabel: profileLabel(version),
      })
      continue
    }
    seen.add(entry.userId)
    unique.push(entry)
  }

  for (const entry of unique) {
    const user = userById(state, entry.userId)
    if (!user) {
      skips.push({
        userId: entry.userId,
        userName: entry.userId,
        code: 'unknown-user',
        reason: `${entry.userId} 不在用户名单中，无法校验分层`,
        profileVersionId: version.id,
        profileVersionLabel: profileLabel(version),
      })
      continue
    }
    const layerName = layerOf(version, scheme, entry.userId)
    if (!layerName) {
      skips.push({
        userId: entry.userId,
        userName: user.name,
        code: 'not-in-layer',
        reason: `${user.name}（${entry.userId}）不在 ${profileLabel(version)} 的目标分层（${targetLabel}）内`,
        profileVersionId: version.id,
        profileVersionLabel: profileLabel(version),
      })
      continue
    }
    const previous = alreadyHit(state, scheme.code, version.id, entry.userId)
    if (previous) {
      skips.push({
        userId: entry.userId,
        userName: user.name,
        code: previous.sameVersion ? 'already-hit' : 'already-hit-other-version',
        reason: previous.sameVersion
          ? `${user.name}（${entry.userId}）已在批次 ${previous.batchId} 命中 ${previous.versionLabel}，本批不重复计入`
          : `${user.name}（${entry.userId}）已按旧画像版本 ${previous.versionLabel} 进入实验（批次 ${previous.batchId}），同一方案只计 1 次，不随版本更新重复扩大人群`,
        profileVersionId: version.id,
        profileVersionLabel: profileLabel(version),
        relatedBatchId: previous.batchId,
      })
      continue
    }
    hits.push({
      userId: entry.userId,
      userName: user.name,
      schemeCode: scheme.code,
      batchId: 'preview',
      profileVersionId: version.id,
      profileVersionLabel: profileLabel(version),
      layerName,
      hitAt,
    })
  }

  return { hits, skips, uniqueCount: unique.length }
}

function blockedEvaluation(state: ExperimentState, scheme: AbScheme, eligibility: SchemeEligibility) {
  const version = versionById(state, scheme.linkedProfileVersionId)
  const seen = new Set<string>()
  const hits: HitRecord[] = []
  const skips: SkipRecord[] = []
  for (const entry of state.whitelist.filter((item) => item.schemeCode === scheme.code)) {
    if (seen.has(entry.userId)) {
      const user = userById(state, entry.userId)
      skips.push({
        userId: entry.userId,
        userName: user ? user.name : entry.userId,
        code: 'duplicate-whitelist',
        reason: `${user ? user.name : entry.userId}（${entry.userId}）在方案白名单登记了多次，已合并为 1 次`,
        profileVersionId: version?.id ?? null,
        profileVersionLabel: version ? profileLabel(version) : '未绑定画像',
      })
      continue
    }
    seen.add(entry.userId)
    const user = userById(state, entry.userId)
    skips.push({
      userId: entry.userId,
      userName: user ? user.name : entry.userId,
      code: eligibilityToSkipCode(eligibility.code),
      reason: eligibility.detail,
      profileVersionId: version?.id ?? null,
      profileVersionLabel: version ? profileLabel(version) : '未绑定画像',
    })
  }
  return { hits, skips, uniqueCount: seen.size }
}

function buildAttempt(
  state: ExperimentState,
  schemeCode: string,
  entrances: string[],
  windowKey: string,
  version: ProfileVersion | null,
  status: AttemptStatus,
  message: string,
  newHitCount: number,
  batchId?: string,
  reasonCode?: string,
): RunAttempt {
  const attempt: RunAttempt = {
    id: `AT-${String(state.nextAttemptSeq).padStart(4, '0')}`,
    schemeCode,
    entrances: [...new Set(entrances)],
    windowKey,
    profileVersionId: version?.id ?? null,
    profileVersionLabel: version ? profileLabel(version) : '未绑定画像',
    at: isoNow(),
    status,
    batchId,
    newHitCount,
    message,
    reasonCode,
  }
  state.nextAttemptSeq += 1
  state.attempts = [attempt, ...state.attempts].slice(0, 80)
  state.updatedAt = attempt.at
  return attempt
}

function idempotencyKeyOf(scheme: AbScheme, version: ProfileVersion): string {
  return [
    scheme.code,
    version.id,
    scheme.scheduleWindow || '未设置排期',
    targetLayerNames(scheme).slice().sort().join('+'),
  ].join('|')
}

type RefreshOutcome = {
  status: AttemptStatus
  attempt: RunAttempt
  batchId?: string
  newHitCount: number
  message: string
}

/** 在给定的 state 副本上执行一次命中计算，成功返回时 state 已经包含新批次。 */
function applyRefresh(
  draft: ExperimentState,
  scheme: AbScheme,
  entrances: string[],
): RefreshOutcome {
  const eligibility = schemeEligibility(draft, scheme)
  const version = versionById(draft, scheme.linkedProfileVersionId)
  const windowKey = scheme.scheduleWindow || '未设置排期'
  const entranceList = [...new Set(entrances.filter((item) => item.trim() !== ''))]
  if (entranceList.length === 0) {
    entranceList.push('手动刷新')
  }

  if (!eligibility.eligible) {
    const attempt = buildAttempt(
      draft,
      scheme.code,
      entranceList,
      windowKey,
      version,
      'blocked',
      `${entranceList.join('、')} 触发被拦截：${eligibility.detail}`,
      0,
      undefined,
      eligibility.code,
    )
    return {
      status: 'blocked',
      attempt,
      newHitCount: 0,
      message: `未新增命中：${eligibility.detail}`,
    }
  }

  const targetVersion = version as ProfileVersion
  const idempotencyKey = idempotencyKeyOf(scheme, targetVersion)
  const existing = [...hitBatchesOf(draft, scheme.code, targetVersion.id)]
    .reverse()
    .find((batch) => batch.idempotencyKey === idempotencyKey)
  const evaluation = evaluateAudience(draft, scheme, targetVersion)

  if (evaluation.hits.length === 0) {
    const attempt = buildAttempt(
      draft,
      scheme.code,
      entranceList,
      windowKey,
      targetVersion,
      'unchanged',
      existing
        ? `重复提交：窗口、画像版本与目标层均未变化，沿用批次 ${existing.id}，未扩大人群`
        : `没有新的可命中用户（${evaluation.skips.length} 条未命中记录），未生成新批次`,
      0,
      existing?.id,
      'no-new-user',
    )
    return {
      status: 'unchanged',
      attempt,
      batchId: existing?.id,
      newHitCount: 0,
      message: existing
        ? `重复提交已合并：沿用上一完整批次 ${existing.id}，累计命中 ${cumulativeHits(draft, scheme.code)} 人不变`
        : '没有新的可命中用户，未生成新批次',
    }
  }

  const batchId = `HB-${shortDate(isoNow())}-${String(draft.nextBatchSeq).padStart(3, '0')}`
  draft.nextBatchSeq += 1
  const previousBatch = existing ?? latestBatchOf(draft, scheme.code)
  const committedAt = isoNow()
  const hits = evaluation.hits.map((hit) => ({ ...hit, batchId }))
  const batch: HitBatch = {
    id: batchId,
    schemeCode: scheme.code,
    profileVersionId: targetVersion.id,
    profileVersionLabel: profileLabel(targetVersion),
    profilePublishedAt: targetVersion.publishedAt,
    windowKey,
    idempotencyKey,
    entrances: entranceList,
    createdAt: committedAt,
    committedAt,
    status: 'complete',
    hits,
    skips: evaluation.skips,
    previousBatchId: previousBatch?.id ?? null,
    revision: draft.revision,
    note: existing
      ? `同一排期窗口的增量批次：仅写入 ${hits.length} 名尚未命中的用户。`
      : `新生成批次：写入 ${hits.length} 名命中用户。`,
  }
  draft.batches = [...draft.batches, batch]
  const attempt = buildAttempt(
    draft,
    scheme.code,
    entranceList,
    windowKey,
    targetVersion,
    'complete',
    `${entranceList.join('、')} 生成批次 ${batchId}，新增 ${hits.length} 人；累计命中 ${cumulativeHits(draft, scheme.code)} 人`,
    hits.length,
    batchId,
  )
  return {
    status: 'complete',
    attempt,
    batchId,
    newHitCount: hits.length,
    message: `已生成批次 ${batchId}：新增 ${hits.length} 人，画像版本 ${batch.profileVersionLabel}`,
  }
}

// ---- 事务提交 ----

type Journal = {
  id: string
  at: string
  label: string
  phase: 'prepared' | 'committed'
  baseRevision: number
  baseState: ExperimentState
  nextState: ExperimentState
}

type CommitResult =
  | { ok: true; state: ExperimentState }
  | { ok: false; message: string; diagnostic?: ExperimentDiagnostic; state: ExperimentState }

function appendDiagnostic(
  state: ExperimentState,
  input: {
    kind: DiagnosticKind
    reason: string
    schemeCode?: string
    profileVersionId?: string
    preservedBatchId?: string
    retryable: boolean
  },
  at = isoNow(),
): ExperimentDiagnostic {
  const diagnostic: ExperimentDiagnostic = {
    id: `DG-${String(state.nextDiagnosticSeq).padStart(4, '0')}`,
    at,
    kind: input.kind,
    reason: input.reason,
    schemeCode: input.schemeCode,
    profileVersionId: input.profileVersionId,
    preservedBatchId: input.preservedBatchId,
    retryable: input.retryable,
  }
  state.nextDiagnosticSeq += 1
  state.diagnostics = [diagnostic, ...state.diagnostics].slice(0, MAX_DIAGNOSTICS)
  state.updatedAt = at
  return diagnostic
}

/**
 * 同一次提交里同时落画像生命周期变更与命中结果：
 * 先写提交日志，再写状态，最后标记 committed。
 * 任一环节失败都回滚到 baseState（上一完整批次），不会留下半批结果。
 */
function commitState(
  baseState: ExperimentState,
  nextState: ExperimentState,
  label: string,
  failureContext: { schemeCode?: string; profileVersionId?: string },
): CommitResult {
  const journal: Journal = {
    id: `TX-${shortDate(isoNow())}-${baseState.revision + 1}`,
    at: isoNow(),
    label,
    phase: 'prepared',
    baseRevision: baseState.revision,
    baseState: cloneState(baseState),
    nextState: cloneState(nextState),
  }

  const prepared = writeJournalRaw(journal)
  if (!prepared.ok) {
    const failed = cloneState(baseState)
    const diagnostic = appendDiagnostic(failed, {
      kind: 'commit-failed',
      reason: `提交日志写入失败：${prepared.error ?? '未知原因'}`,
      ...failureContext,
      preservedBatchId: latestBatchOf(baseState)?.id,
      retryable: true,
    })
    writeStateRaw(failed)
    return {
      ok: false,
      message: '本次变更未写入：提交日志创建失败，已保留上一完整批次，可重试',
      diagnostic,
      state: failed,
    }
  }

  const rollback = (kind: DiagnosticKind, reason: string, message: string): CommitResult => {
    writeStateRaw(baseState)
    clearJournalRaw()
    const failed = cloneState(baseState)
    const diagnostic = appendDiagnostic(failed, {
      kind,
      reason,
      ...failureContext,
      preservedBatchId: latestBatchOf(baseState)?.id,
      retryable: true,
    })
    writeStateRaw(failed)
    return { ok: false, message, diagnostic, state: failed }
  }

  const fault = consumeFaultMode()
  if (fault === 'interrupt-before-write') {
    // 保留 prepared 日志，模拟「日志已写、状态未落盘」；下一次读取会回滚。
    const failed = cloneState(baseState)
    const diagnostic = appendDiagnostic(failed, {
      kind: 'interrupted-rollback',
      reason: '模拟提交中断：提交日志已写入但状态未落盘，下一次读取将回到上一完整批次',
      ...failureContext,
      preservedBatchId: latestBatchOf(baseState)?.id,
      retryable: true,
    })
    return {
      ok: false,
      message: '提交被中断，状态尚未落盘；重新读取会回到上一完整批次，可重试',
      diagnostic,
      state: failed,
    }
  }

  if (fault === 'commit-fail') {
    return rollback('commit-failed', '模拟提交失败：状态未写入，已回滚到上一完整批次', '命中结果写入失败，已回到上一完整批次；可重试')
  }

  const written = writeStateRaw(nextState)
  if (!written.ok) {
    return rollback(
      'commit-failed',
      `状态写入失败：${written.error ?? '未知原因'}，已回滚`,
      '命中结果写入失败，已回到上一完整批次；可重试',
    )
  }

  if (fault === 'interrupt-after-write') {
    // 状态已写入但完成标记缺失，保留 prepared 日志；下一次读取会回滚。
    const failed = cloneState(baseState)
    const diagnostic = appendDiagnostic(failed, {
      kind: 'interrupted-rollback',
      reason: '模拟写入后中断：完成标记未落盘，下一次读取会回滚到上一完整批次',
      ...failureContext,
      preservedBatchId: latestBatchOf(baseState)?.id,
      retryable: true,
    })
    return {
      ok: false,
      message: '提交在写入后中断，完成标记缺失；下一次读取会回到上一完整批次，可重试',
      diagnostic,
      state: failed,
    }
  }

  const marked = writeJournalRaw({ ...journal, phase: 'committed' })
  if (!marked.ok) {
    return rollback(
      'commit-failed',
      `提交完成标记写入失败：${marked.error ?? '未知原因'}，已回滚`,
      '提交完成标记写入失败，已回到上一完整批次；可重试',
    )
  }

  clearJournalRaw()
  return { ok: true, state: nextState }
}

// ---- 读取与恢复 ----

export type LoadedExperiment = {
  state: ExperimentState
  recovered: ExperimentDiagnostic[]
  storageError: string | null
  historyPolicy: string
}

function makeDiagnostic(state: ExperimentState, input: Parameters<typeof appendDiagnostic>[1]): ExperimentDiagnostic {
  return appendDiagnostic(state, input)
}

/**
 * 读取实验状态并处理上次未完成的提交：
 * - 日志停在 prepared：状态可能只写了一半，回滚到上一完整批次；
 * - 日志已标记 committed：前滚到新批次；
 * - 两种情况都会持久化一条可读的恢复诊断。
 */
export function loadExperimentState(): LoadedExperiment {
  const recovered: ExperimentDiagnostic[] = []
  const { journal, error: journalError } = readJournalRaw()
  let state: ExperimentState | null = null
  let storageError: string | null = journalError

  if (journal) {
    if (journal.phase === 'committed') {
      const write = writeStateRaw(journal.nextState)
      if (write.ok) {
        state = cloneState(journal.nextState)
        recovered.push(
          makeDiagnostic(state, {
            kind: 'interrupted-forward',
            reason: '上次提交已完成但日志尚未清理，已前滚到完整批次',
            schemeCode: latestBatchOf(journal.nextState)?.schemeCode,
            preservedBatchId: latestBatchOf(journal.nextState)?.id,
            retryable: true,
          }),
        )
      }
    } else {
      const write = writeStateRaw(journal.baseState)
      if (write.ok) {
        state = cloneState(journal.baseState)
        recovered.push(
          makeDiagnostic(state, {
            kind: 'interrupted-rollback',
            reason: '上次提交在写入过程中中断，已回到上一完整批次',
            schemeCode: latestBatchOf(journal.baseState)?.schemeCode,
            preservedBatchId: latestBatchOf(journal.baseState)?.id,
            retryable: true,
          }),
        )
      }
    }
    clearJournalRaw()
  }

  if (!state) {
    const read = readStateRaw()
    if (read.state) {
      state = read.state
    } else {
      state = seedState()
      state.users = seedUsers()
      if (read.error) {
        storageError = read.error
        recovered.push(
          makeDiagnostic(state, {
            kind: 'storage-error',
            reason: `${read.error}，已用示例数据展示；刷新重试可重新读取`,
            retryable: true,
          }),
        )
      }
      writeStateRaw(state)
    }
  }

  if (recovered.length > 0) {
    state.updatedAt = isoNow()
    writeStateRaw(state)
  }

  return { state, recovered, storageError, historyPolicy: HISTORY_POLICY }
}

function buildDraft(base: ExperimentState): ExperimentState {
  const draft = cloneState(base)
  draft.revision = base.revision + 1
  draft.updatedAt = isoNow()
  return draft
}

function failureResult(
  result: CommitResult,
): { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  if (result.ok) {
    return { ok: false, message: '提交状态异常' }
  }
  return { ok: false, message: result.message, diagnostic: result.diagnostic }
}

// ---- 命中操作 ----

/**
 * 触发一次命中计算。两个排期入口可以同时传入：
 * 同窗口 + 同版本 + 同分层只生成一个批次，已命中的用户不会再次计入。
 */
export function refreshScheme(
  schemeCode: string,
  entrances: string[] = ['手动刷新'],
): { ok: true; data: RefreshResult; state: ExperimentState } | { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  const base = loadExperimentState().state
  const scheme = base.schemes.find((item) => item.code === schemeCode)
  if (!scheme) {
    return { ok: false, message: `没有找到分流方案 ${schemeCode}` }
  }
  const draft = buildDraft(base)
  const target = draft.schemes.find((item) => item.code === schemeCode) as AbScheme
  const outcome = applyRefresh(draft, target, entrances)
  const version = versionById(draft, target.linkedProfileVersionId)
  const committed = commitState(base, draft, `refresh:${schemeCode}:${outcome.status}`, {
    schemeCode,
    profileVersionId: version?.id,
  })
  if (!committed.ok) {
    return failureResult(committed)
  }
  return {
    ok: true,
    state: committed.state,
    data: {
      schemeCode,
      status: outcome.status,
      attempt: outcome.attempt,
      batchId: outcome.batchId,
      preservedBatchId: latestBatchOf(base, schemeCode)?.id,
      newHitCount: outcome.newHitCount,
      message: outcome.message,
    },
  }
}

function latestPublishedOfProfile(state: ExperimentState, profileCode: string): ProfileVersion | null {
  const candidates = state.profiles
    .filter(
      (profile) =>
        profile.profileCode === profileCode && profile.status === '已发布' && !profile.voidedAt,
    )
    .sort((a, b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''))
  return candidates.length > 0 ? candidates[candidates.length - 1] : null
}

/**
 * 发布画像并把「画像版本切换 + 关联方案命中结果」作为同一批提交：
 * 发布失败则画像状态、方案绑定、命中批次全部回到上一完整批次。
 * recompute=true 时，同一次事务里为每个关联方案生成新的命中结果。
 */
export function publishProfile(
  versionId: string,
  options: { recompute?: boolean; entrances?: string[] } = {},
): { ok: true; data: ProfileMutationResult; state: ExperimentState } | { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  const base = loadExperimentState().state
  const version = versionById(base, versionId)
  if (!version) {
    return { ok: false, message: `没有找到画像版本 ${versionId}` }
  }
  if (version.status === '已作废' || version.voidedAt) {
    return { ok: false, message: `画像版本 ${profileLabel(version)} 已作废，不能重新发布；请先创建新版本` }
  }
  if (version.status === '已发布') {
    return { ok: false, message: `画像版本 ${profileLabel(version)} 已经是已发布状态，不用重复操作` }
  }
  const draft = buildDraft(base)
  const at = isoNow()
  const target = draft.profiles.find((item) => item.id === versionId) as ProfileVersion
  if (target.layers.length === 0) {
    return { ok: false, message: `画像版本 ${profileLabel(target)} 没有分层人群，无法发布` }
  }
  target.status = '已发布'
  target.publishedAt = at
  target.voidedAt = null
  target.updatedAt = at

  const affectedSchemes: string[] = []
  for (const scheme of draft.schemes) {
    const linked = versionById(draft, scheme.linkedProfileVersionId)
    if (linked && linked.profileCode === target.profileCode && linked.id !== target.id) {
      scheme.linkedProfileVersionId = target.id
      scheme.updatedAt = at
      affectedSchemes.push(scheme.code)
    }
  }

  const refreshMessages: string[] = []
  if (options.recompute) {
    const entrances = options.entrances && options.entrances.length > 0 ? options.entrances : ['发布画像']
    for (const code of affectedSchemes) {
      const scheme = draft.schemes.find((item) => item.code === code) as AbScheme
      if (scheme.status !== '已生效') {
        continue
      }
      const outcome = applyRefresh(draft, scheme, entrances)
      refreshMessages.push(`${code}：${outcome.message}`)
    }
  }

  const affectedBatches = draft.batches
    .filter((batch) => batch.profileVersionId === versionId)
    .map((batch) => batch.id)
  recordLinkage(
    draft,
    'publish-profile',
    versionId,
    affectedSchemes,
    affectedBatches,
    `${profileLabel(target)} 发布；${affectedSchemes.length > 0 ? `${affectedSchemes.join('、')} 已切换到新版本快照` : '暂无方案需要切换'}；${
      options.recompute ? '命中结果与画像发布在同一批提交中写入' : '历史批次仍按原版本保留'
    }。`,
  )

  const committed = commitState(base, draft, `publish:${versionId}`, {
    profileVersionId: versionId,
  })
  if (!committed.ok) {
    return failureResult(committed)
  }
  return {
    ok: true,
    state: committed.state,
    data: {
      profileVersionId: versionId,
      affectedSchemeCodes: affectedSchemes,
      affectedBatchIds: affectedBatches,
      message: `画像 ${profileLabel(target)} 已发布${
        affectedSchemes.length > 0 ? `，${affectedSchemes.join('、')} 已接入新版本` : ''
      }${refreshMessages.length > 0 ? `；同批命中结果：${refreshMessages.join('；')}` : ''}；历史命中批次未改写。`,
    },
  }
}

/** 作废画像：作废时间作为历史边界，之前的批次冻结保留，之后不再进入新命中计算。 */
export function voidProfile(
  versionId: string,
): { ok: true; data: ProfileMutationResult; state: ExperimentState } | { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  const base = loadExperimentState().state
  const version = versionById(base, versionId)
  if (!version) {
    return { ok: false, message: `没有找到画像版本 ${versionId}` }
  }
  if (isVersionVoided(version)) {
    return { ok: false, message: `画像版本 ${profileLabel(version)} 已作废，不用重复操作` }
  }
  if (version.status !== '已发布') {
    return { ok: false, message: `只有已发布画像可以作废，${profileLabel(version)} 当前是「${version.status}」` }
  }
  const draft = buildDraft(base)
  const target = draft.profiles.find((item) => item.id === versionId) as ProfileVersion
  const at = isoNow()
  target.status = '已作废'
  target.voidedAt = at
  target.updatedAt = at
  const affectedSchemes = draft.schemes
    .filter((scheme) => scheme.linkedProfileVersionId === versionId)
    .map((scheme) => scheme.code)
  const affectedBatches = draft.batches
    .filter((batch) => batch.profileVersionId === versionId)
    .map((batch) => batch.id)
  recordLinkage(
    draft,
    'void-profile',
    versionId,
    affectedSchemes,
    affectedBatches,
    `${profileLabel(target)} 于 ${at} 作废：以作废时间为历史边界，${
      affectedBatches.length > 0 ? affectedBatches.join('、') : '无'
    } 等 ${affectedBatches.length} 个历史批次保留原人数；${
      affectedSchemes.join('、') || '无方案'
    } 退出新命中计算。`,
  )
  const committed = commitState(base, draft, `void:${versionId}`, {
    profileVersionId: versionId,
  })
  if (!committed.ok) {
    return failureResult(committed)
  }
  return {
    ok: true,
    state: committed.state,
    data: {
      profileVersionId: versionId,
      affectedSchemeCodes: affectedSchemes,
      affectedBatchIds: affectedBatches,
      message: `画像 ${profileLabel(target)} 已作废；历史批次 ${
        affectedBatches.join('、') || '无'
      } 保留，方案 ${affectedSchemes.join('、') || '无'} 退出新命中计算。`,
    },
  }
}

/** 基于现有版本创建新版本草稿；发布后才会接管方案命中。 */
export function reviseProfile(
  versionId: string,
  patch: {
    profileName?: string
    dimensions?: string
    aggregateMetric?: string
    layerRange?: string
    updateCycle?: string
    layers?: { name: string; userIds: string[] }[]
  } = {},
): { ok: true; data: ProfileMutationResult & { newVersionId: string }; state: ExperimentState } | { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  return reviseAndPublishInternal(versionId, patch, false)
}

/**
 * 画像更新 + 新版本发布 + 关联方案命中结果，全部放进同一次提交：
 * 任一步失败都回到上一完整批次，不会出现「画像已更新但命中仍是旧版本」的半批状态。
 */
export function reviseAndPublish(
  versionId: string,
  patch: {
    profileName?: string
    dimensions?: string
    aggregateMetric?: string
    layerRange?: string
    updateCycle?: string
    layers?: { name: string; userIds: string[] }[]
  } = {},
): { ok: true; data: ProfileMutationResult & { newVersionId: string }; state: ExperimentState } | { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  return reviseAndPublishInternal(versionId, patch, true)
}

function reviseAndPublishInternal(
  versionId: string,
  patch: {
    profileName?: string
    dimensions?: string
    aggregateMetric?: string
    layerRange?: string
    updateCycle?: string
    layers?: { name: string; userIds: string[] }[]
  },
  publishNow: boolean,
): { ok: true; data: ProfileMutationResult & { newVersionId: string }; state: ExperimentState } | { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  const base = loadExperimentState().state
  const version = versionById(base, versionId)
  if (!version) {
    return { ok: false, message: `没有找到画像版本 ${versionId}` }
  }
  if (publishNow && isVersionVoided(version)) {
    return {
      ok: false,
      message: `画像版本 ${profileLabel(version)} 已作废，不能直接作废后重算；请先在其基础上生成新版本再发布`,
    }
  }
  if (publishNow && version.status !== '已发布') {
    return { ok: false, message: `只有已发布画像可以更新并重算，${profileLabel(version)} 当前是「${version.status}」` }
  }
  const draft = buildDraft(base)
  const at = isoNow()
  const codeVersions = draft.profiles.filter((item) => item.profileCode === version.profileCode)
  const match = /^v(\d+)$/.exec(version.version)
  let index = (match ? Number(match[1]) : 1) + 1
  while (codeVersions.some((item) => item.version === `v${index}`)) {
    index += 1
  }
  const newVersionId = `${version.profileCode}@v${index}`
  const created: ProfileVersion = {
    ...cloneState(version),
    id: newVersionId,
    version: `v${index}`,
    status: publishNow ? '已发布' : '草稿',
    publishedAt: publishNow ? at : null,
    voidedAt: null,
    updatedAt: at,
    note: publishNow
      ? `由 ${profileLabel(version)} 更新并在同一批提交中发布，接管关联方案命中。`
      : `由 ${profileLabel(version)} 更新生成的草稿版本，发布后接管方案命中。`,
    profileName: patch.profileName ?? version.profileName,
    dimensions: patch.dimensions ?? version.dimensions,
    aggregateMetric: patch.aggregateMetric ?? version.aggregateMetric,
    layerRange: patch.layerRange ?? version.layerRange,
    updateCycle: patch.updateCycle ?? version.updateCycle,
    layers: patch.layers ? cloneState(patch.layers) : cloneState(version.layers),
  }
  draft.profiles = [...draft.profiles, created]

  const affectedSchemes: string[] = []
  const refreshMessages: string[] = []
  if (publishNow) {
    for (const scheme of draft.schemes) {
      const linked = versionById(draft, scheme.linkedProfileVersionId)
      if (linked && linked.profileCode === created.profileCode && linked.id !== created.id) {
        scheme.linkedProfileVersionId = created.id
        scheme.updatedAt = at
        affectedSchemes.push(scheme.code)
      }
    }
    for (const code of affectedSchemes) {
      const scheme = draft.schemes.find((item) => item.code === code) as AbScheme
      if (scheme.status !== '已生效') {
        continue
      }
      const outcome = applyRefresh(draft, scheme, ['更新画像'])
      refreshMessages.push(`${code}：${outcome.message}`)
    }
  }

  const affectedBatches = draft.batches
    .filter((batch) => batch.profileVersionId === newVersionId)
    .map((batch) => batch.id)
  recordLinkage(
    draft,
    publishNow ? 'publish-profile' : 'update-profile',
    newVersionId,
    affectedSchemes,
    affectedBatches,
    publishNow
      ? `${profileLabel(version)} 更新生成 ${profileLabel(created)} 并在同一批提交中发布；${
          affectedSchemes.join('、') || '无方案'
        } 切换到新版本并重新计算命中；旧版本历史批次保留。`
      : `${profileLabel(version)} 更新生成新版本 ${profileLabel(created)}（草稿）；旧版本与已有命中批次不动，发布后再切换。`,
  )

  const committed = commitState(base, draft, `${publishNow ? 'revise-publish' : 'revise'}:${versionId}`, {
    profileVersionId: versionId,
  })
  if (!committed.ok) {
    return failureResult(committed)
  }
  return {
    ok: true,
    state: committed.state,
    data: {
      profileVersionId: newVersionId,
      newVersionId,
      affectedSchemeCodes: affectedSchemes,
      affectedBatchIds: affectedBatches,
      message: publishNow
        ? `画像更新与命中结果已同批写入：${profileLabel(created)} 已发布${
            refreshMessages.length > 0 ? `；${refreshMessages.join('；')}` : ''
          }。`
        : `已生成草稿版本 ${profileLabel(created)}；发布后才会接管方案命中。`,
    },
  }
}

function recordLinkage(
  state: ExperimentState,
  kind: LinkageEvent['kind'],
  profileVersionId: string,
  affectedSchemeCodes: string[],
  affectedBatchIds: string[],
  note: string,
): LinkageEvent {
  const event: LinkageEvent = {
    id: `LK-${String(state.nextLinkageSeq).padStart(4, '0')}`,
    at: isoNow(),
    kind,
    profileVersionId,
    affectedSchemeCodes: [...new Set(affectedSchemeCodes)],
    affectedBatchIds: [...new Set(affectedBatchIds)],
    note,
  }
  state.nextLinkageSeq += 1
  state.linkageEvents = [event, ...state.linkageEvents]
  state.updatedAt = event.at
  return event
}

/** 分流方案状态流转走同一事务，失败回到上一完整批次。 */
export function runSchemeAction(
  schemeCode: string,
  action: '提交方案评审' | '生效方案' | '下线方案',
): { ok: true; message: string; state: ExperimentState } | { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  const base = loadExperimentState().state
  const scheme = base.schemes.find((item) => item.code === schemeCode)
  if (!scheme) {
    return { ok: false, message: `没有找到分流方案 ${schemeCode}` }
  }
  const targets: Record<string, '方案评审中' | '已生效' | '已下线'> = {
    提交方案评审: '方案评审中',
    生效方案: '已生效',
    下线方案: '已下线',
  }
  const targetStatus = targets[action]
  if (!targetStatus) {
    return { ok: false, message: `分流方案没有登记「${action}」这个动作` }
  }
  if (scheme.status === targetStatus) {
    return { ok: false, message: `分流方案已经是「${targetStatus}」，不用重复操作` }
  }
  const draft = buildDraft(base)
  const target = draft.schemes.find((item) => item.code === schemeCode) as AbScheme
  target.status = targetStatus
  target.updatedAt = isoNow()
  const committed = commitState(base, draft, `scheme:${schemeCode}:${action}`, { schemeCode })
  if (!committed.ok) {
    return failureResult(committed)
  }
  return { ok: true, message: `分流方案已${action}，当前状态「${targetStatus}」`, state: committed.state }
}

export function addWhitelistUser(
  schemeCode: string,
  userId: string,
  note = '手动补录',
): { ok: true; message: string; state: ExperimentState } | { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  const base = loadExperimentState().state
  const scheme = base.schemes.find((item) => item.code === schemeCode)
  if (!scheme) {
    return { ok: false, message: `没有找到分流方案 ${schemeCode}` }
  }
  if (!userById(base, userId)) {
    return { ok: false, message: `用户名单里没有 ${userId}` }
  }
  if (base.whitelist.some((item) => item.schemeCode === schemeCode && item.userId === userId)) {
    return { ok: false, message: `${userId} 已在 ${schemeCode} 的白名单中，未重复写入` }
  }
  const draft = buildDraft(base)
  draft.whitelist = [...draft.whitelist, { schemeCode, userId, addedAt: isoNow(), note }]
  const committed = commitState(base, draft, `whitelist:add:${schemeCode}:${userId}`, {
    schemeCode,
    profileVersionId: scheme.linkedProfileVersionId ?? undefined,
  })
  if (!committed.ok) {
    return failureResult(committed)
  }
  return { ok: true, message: `已将 ${userId} 加入 ${schemeCode} 白名单`, state: committed.state }
}

export function removeWhitelistUser(
  schemeCode: string,
  userId: string,
): { ok: true; message: string; state: ExperimentState } | { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  const base = loadExperimentState().state
  const scheme = base.schemes.find((item) => item.code === schemeCode)
  if (!scheme) {
    return { ok: false, message: `没有找到分流方案 ${schemeCode}` }
  }
  const draft = buildDraft(base)
  const before = draft.whitelist.length
  draft.whitelist = draft.whitelist.filter(
    (item) => !(item.schemeCode === schemeCode && item.userId === userId),
  )
  if (draft.whitelist.length === before) {
    return { ok: false, message: `${userId} 不在 ${schemeCode} 白名单中` }
  }
  const committed = commitState(base, draft, `whitelist:remove:${schemeCode}:${userId}`, {
    schemeCode,
    profileVersionId: scheme.linkedProfileVersionId ?? undefined,
  })
  if (!committed.ok) {
    return failureResult(committed)
  }
  return { ok: true, message: `已从 ${schemeCode} 白名单移除 ${userId}`, state: committed.state }
}

/** 空数据演练：清空实验域，页面展示空态；同样走事务，失败保留原数据。 */
export function clearExperiment():
  | { ok: true; state: ExperimentState }
  | { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  const base = loadExperimentState().state
  const empty = seedState()
  empty.profiles = []
  empty.schemes = []
  empty.whitelist = []
  empty.batches = []
  empty.attempts = []
  empty.linkageEvents = []
  empty.diagnostics = []
  empty.users = seedUsers()
  empty.nextBatchSeq = 1
  empty.nextAttemptSeq = 1
  empty.nextLinkageSeq = 1
  empty.nextDiagnosticSeq = 1
  empty.revision = 1
  empty.updatedAt = isoNow()
  const committed = commitState(base, empty, 'clear:experiment', {})
  if (!committed.ok) {
    return failureResult(committed)
  }
  return { ok: true, state: committed.state }
}

/** 恢复示例数据；走事务提交，失败时保留原状态。 */
export function resetExperiment(): { ok: true; state: ExperimentState } | { ok: false; message: string; diagnostic?: ExperimentDiagnostic } {
  const base = loadExperimentState().state
  const fresh = seedState()
  const committed = commitState(base, fresh, 'reset:experiment', {})
  if (!committed.ok) {
    return failureResult(committed)
  }
  return { ok: true, state: committed.state }
}

export function setExperimentFault(mode: FaultMode): void {
  setFaultMode(mode)
}

export function experimentFault(): FaultMode {
  return readFaultMode()
}

// ---- 看板聚合 ----

function batchIsHistorical(version: ProfileVersion | null, batch: HitBatch): boolean {
  if (!version) {
    return false
  }
  if (!isVersionVoided(version)) {
    return false
  }
  const boundary = version.voidedAt
  return !boundary || batch.committedAt <= boundary
}

function toBatchView(state: ExperimentState, batch: HitBatch): BatchView {
  const version = versionById(state, batch.profileVersionId)
  const cumulative = new Set<string>()
  for (const item of hitBatchesOf(state, batch.schemeCode, batch.profileVersionId)) {
    if (item.committedAt <= batch.committedAt) {
      for (const hit of item.hits) {
        cumulative.add(hit.userId)
      }
    }
  }
  return {
    ...batch,
    isHistorical: batchIsHistorical(version, batch),
    profileVersionNowStatus: version ? version.status : '缺失',
    profileVoidedAt: version?.voidedAt ?? null,
    cumulativeHitCount: cumulative.size,
  }
}

export function profileRows(state: ExperimentState): ProfileBoardRow[] {
  return state.profiles.map((profile) => {
    const batches = state.batches.filter((batch) => batch.profileVersionId === profile.id)
    const hitUsers = new Set<string>()
    for (const batch of batches) {
      for (const hit of batch.hits) {
        hitUsers.add(hit.userId)
      }
    }
    return {
      versionId: profile.id,
      profileCode: profile.profileCode,
      profileName: profile.profileName,
      version: profile.version,
      status: profile.status,
      publishedAt: profile.publishedAt,
      voidedAt: profile.voidedAt,
      updatedAt: profile.updatedAt,
      coverage: new Set(profile.layers.flatMap((layer) => layer.userIds)).size,
      dimensions: profile.dimensions,
      aggregateMetric: profile.aggregateMetric,
      layerRange: profile.layerRange,
      updateCycle: profile.updateCycle,
      layers: profile.layers,
      linkedSchemes: state.schemes
        .filter((scheme) => scheme.linkedProfileVersionId === profile.id)
        .map((scheme) => scheme.code),
      batchCount: batches.length,
      hitCount: hitUsers.size,
      currentVersionOfProfile: latestPublishedOfProfile(state, profile.profileCode)?.id === profile.id,
      canPublish: profile.status !== '已发布' && profile.status !== '已作废',
      canVoid: profile.status === '已发布' && !profile.voidedAt,
      // 已作废版本不可改写，但可以在其快照基础上派生新版本，再发布接管命中。
      canUpdate: true,
      note: profile.note,
    }
  })
}

export function schemeRows(state: ExperimentState): SchemeBoardRow[] {
  return state.schemes.map((scheme) => {
    const version = versionById(state, scheme.linkedProfileVersionId)
    const batches = hitBatchesOf(state, scheme.code)
    const latest = batches.length > 0 ? batches[batches.length - 1] : null
    const whitelist = state.whitelist.filter((item) => item.schemeCode === scheme.code)
    return {
      scheme,
      eligibility: schemeEligibility(state, scheme),
      linkedVersion: version,
      linkedVersionLabel: version ? profileLabel(version) : '未绑定画像',
      whitelistCount: whitelist.length,
      duplicateWhitelistCount:
        whitelist.length - new Set(whitelist.map((item) => item.userId)).size,
      hitCount: cumulativeHits(state, scheme.code),
      batchCount: batches.length,
      latestBatch: latest,
      currentVersionHits: currentVersionHits(state, scheme),
    }
  })
}

function whitelistViews(
  state: ExperimentState,
  scheme: AbScheme,
  version: ProfileVersion | null,
  eligibility: SchemeEligibility,
  preview: Evaluation,
): WhitelistView[] {
  const entries = state.whitelist.filter((item) => item.schemeCode === scheme.code)
  const seen = new Set<string>()
  const previewHitUsers = new Set(preview.hits.map((hit) => hit.userId))
  const skipByUser = new Map<string, SkipRecord>()
  for (const skip of preview.skips) {
    if (!skipByUser.has(skip.userId)) {
      skipByUser.set(skip.userId, skip)
    }
  }
  return entries.map((entry) => {
    const isDuplicate = seen.has(entry.userId)
    seen.add(entry.userId)
    const user = userById(state, entry.userId)
    const layerName = version ? layerOf(version, scheme, entry.userId) : null
    const previous =
      version && !isDuplicate ? alreadyHit(state, scheme.code, version.id, entry.userId) : null
    const skip = skipByUser.get(entry.userId)
    const code: WhitelistView['evaluationCode'] = isDuplicate
      ? 'duplicate-whitelist'
      : previewHitUsers.has(entry.userId)
        ? 'hit'
        : skip?.code ?? eligibilityToSkipCode(eligibility.code)
    const reason = isDuplicate
      ? '白名单重复登记，已合并为 1 次'
      : previewHitUsers.has(entry.userId)
        ? `可命中：目标层「${layerName}」且尚未在本方案命中`
        : skip?.reason ?? eligibility.detail
    return {
      userId: entry.userId,
      userName: user ? user.name : entry.userId,
      addedAt: entry.addedAt,
      note: entry.note,
      layerName: layerName ?? '不在目标层',
      inTargetLayer: !!layerName,
      duplicated: isDuplicate,
      alreadyHitBatchId: previous?.batchId ?? null,
      alreadyHitVersionLabel: previous?.versionLabel ?? null,
      evaluationCode: code,
      evaluationReason: reason,
    }
  })
}

export function getSchemeDetail(schemeCode: string): SchemeDetail | null {
  const state = loadExperimentState().state
  const scheme = state.schemes.find((item) => item.code === schemeCode)
  if (!scheme) {
    return null
  }
  const version = versionById(state, scheme.linkedProfileVersionId)
  const eligibility = schemeEligibility(state, scheme)
  const preview =
    eligibility.eligible && version
      ? evaluateAudience(state, scheme, version)
      : blockedEvaluation(state, scheme, eligibility)

  const batches = hitBatchesOf(state, scheme.code)
    .slice()
    .sort((a, b) => (a.committedAt < b.committedAt ? 1 : -1))
    .map((batch) => toBatchView(state, batch))

  const hits: HitView[] = []
  for (const batch of batches) {
    for (const hit of batch.hits) {
      const hitVersion = versionById(state, hit.profileVersionId)
      hits.push({
        ...hit,
        batchCommittedAt: batch.committedAt,
        batchEntrances: batch.entrances,
        isHistorical: batchIsHistorical(hitVersion, batch),
        profileVersionNowStatus: hitVersion ? hitVersion.status : '缺失',
        profileVoidedAt: hitVersion?.voidedAt ?? null,
      })
    }
  }

  const byVersionMap = new Map<string, { hitUsers: Set<string>; batchCount: number }>()
  for (const batch of batches) {
    const entry = byVersionMap.get(batch.profileVersionId) ?? {
      hitUsers: new Set<string>(),
      batchCount: 0,
    }
    entry.batchCount += 1
    for (const hit of batch.hits) {
      entry.hitUsers.add(hit.userId)
    }
    byVersionMap.set(batch.profileVersionId, entry)
  }
  const byVersion = [...byVersionMap.entries()]
    .map(([profileVersionId, entry]) => {
      const item = versionById(state, profileVersionId)
      return {
        profileVersionId,
        profileVersionLabel: item ? profileLabel(item) : profileVersionId,
        hitCount: entry.hitUsers.size,
        batchCount: entry.batchCount,
        nowStatus: item ? item.status : ('缺失' as const),
        voidedAt: item?.voidedAt ?? null,
      }
    })
    .sort((a, b) => a.profileVersionLabel.localeCompare(b.profileVersionLabel))

  return {
    row: schemeRows(state).find((item) => item.scheme.code === scheme.code) as SchemeBoardRow,
    historyPolicy: HISTORY_POLICY,
    eligibility,
    linkedVersion: version,
    whitelist: whitelistViews(state, scheme, version, eligibility, preview),
    preview: {
      eligible: eligibility.eligible,
      profileVersionId: version?.id ?? null,
      profileVersionLabel: version ? profileLabel(version) : '未绑定画像',
      hits: preview.hits.map((hit) => ({
        userId: hit.userId,
        userName: hit.userName,
        layerName: hit.layerName,
      })),
      skips: preview.skips,
      reason: eligibility.detail,
    },
    batches,
    hits,
    attempts: state.attempts.filter((item) => item.schemeCode === scheme.code),
    linkageEvents: state.linkageEvents.filter((event) =>
      event.affectedSchemeCodes.includes(scheme.code),
    ),
    totals: {
      cumulativeHitCount: cumulativeHits(state, scheme.code),
      currentVersionHits: currentVersionHits(state, scheme),
      batchCount: batches.length,
      byVersion,
    },
  }
}

export function getProfileDetail(versionId: string): ProfileDetail | null {
  const state = loadExperimentState().state
  const profile = versionById(state, versionId)
  if (!profile) {
    return null
  }
  const row = profileRows(state).find((item) => item.versionId === versionId)
  if (!row) {
    return null
  }
  const batches = state.batches
    .filter((batch) => batch.profileVersionId === versionId)
    .slice()
    .sort((a, b) => (a.committedAt < b.committedAt ? 1 : -1))
    .map((batch) => toBatchView(state, batch))
  const linkedSchemes = state.schemes
    .filter((scheme) => scheme.linkedProfileVersionId === versionId)
    .map((scheme) => ({
      code: scheme.code,
      name: scheme.name,
      status: scheme.status,
      eligibility: schemeEligibility(state, scheme),
    }))
  const siblings = state.profiles
    .filter((item) => item.profileCode === profile.profileCode)
    .sort((a, b) => a.version.localeCompare(b.version))
    .map((item) => ({
      versionId: item.id,
      version: item.version,
      status: item.status,
      publishedAt: item.publishedAt,
      voidedAt: item.voidedAt,
    }))
  const historyHits = batches.reduce((sum, batch) => sum + batch.hits.length, 0)
  return {
    row,
    profile,
    siblings,
    linkedSchemes,
    batches,
    totals: {
      cumulativeHitCount: row.hitCount,
      historyHitRecords: historyHits,
      batchCount: batches.length,
      historicalBatchCount: batches.filter((batch) => batch.isHistorical).length,
    },
    historyPolicy: HISTORY_POLICY,
  }
}

export function experimentAudit(): AuditResult {
  const state = loadExperimentState().state
  const items: AuditItem[] = []

  for (const profile of state.profiles) {
    if (!isVersionVoided(profile)) {
      continue
    }
    const linkedSchemes = state.schemes.filter(
      (scheme) => scheme.linkedProfileVersionId === profile.id,
    )
    const eligibleLinked = linkedSchemes.filter((scheme) => schemeEligibility(state, scheme).eligible)
    const relatedBatches = state.batches.filter((batch) => batch.profileVersionId === profile.id)
    items.push({
      id: `profile-${profile.id}`,
      object: '画像定义',
      name: profileLabel(profile),
      check: '作废画像必须退出新命中计算',
      ok: eligibleLinked.length === 0,
      severity: 'block',
      detail:
        eligibleLinked.length === 0
          ? `已作废（${profile.voidedAt ?? '未知'}），${linkedSchemes.length} 个关联方案均已失去资格；历史批次 ${relatedBatches.length} 个保留。`
          : `仍有 ${eligibleLinked.map((scheme) => scheme.code).join('、')} 依据作废画像参与命中，需停止。`,
    })
    const lateBatches = relatedBatches.filter(
      (batch) => !!profile.voidedAt && batch.committedAt > profile.voidedAt,
    )
    items.push({
      id: `profile-late-${profile.id}`,
      object: '命中批次',
      name: profileLabel(profile),
      check: '作废后不得产生新命中批次',
      ok: lateBatches.length === 0,
      severity: 'block',
      detail:
        lateBatches.length === 0
          ? '未发现作废后的新批次（历史边界按作废时间）。'
          : `发现作废后批次 ${lateBatches.map((batch) => batch.id).join('、')}。`,
    })
  }

  for (const scheme of state.schemes) {
    const eligibility = schemeEligibility(state, scheme)
    items.push({
      id: `scheme-${scheme.code}`,
      object: '分流方案',
      name: `${scheme.code} ${scheme.name}`,
      check: '当前实验资格与画像版本绑定一致',
      ok: scheme.status !== '已生效' || eligibility.eligible || eligibility.code === 'profile-voided',
      severity: eligibility.eligible ? 'info' : eligibility.code === 'profile-voided' ? 'warn' : 'block',
      detail: eligibility.eligible
        ? eligibility.detail
        : scheme.status !== '已生效'
          ? `方案${scheme.status}，不参与命中；画像绑定保留供历史查询。`
          : `${eligibility.label}：${eligibility.detail}`,
    })

    const duplicatedHits = new Map<string, string[]>()
    for (const batch of hitBatchesOf(state, scheme.code)) {
      for (const hit of batch.hits) {
        const key = `${batch.profileVersionId}|${hit.userId}`
        duplicatedHits.set(key, [...(duplicatedHits.get(key) ?? []), batch.id])
      }
    }
    const duplicates = [...duplicatedHits.entries()].filter(([, ids]) => ids.length > 1)
    items.push({
      id: `scheme-dup-${scheme.code}`,
      object: '分流方案',
      name: `${scheme.code} ${scheme.name}`,
      check: '同一画像版本内命中用户不重复',
      ok: duplicates.length === 0,
      severity: 'block',
      detail:
        duplicates.length === 0
          ? '历史批次与增量批次没有重复命中同一用户。'
          : `${duplicates.length} 组重复：${duplicates
              .map(([key, ids]) => `${key.split('|')[1]}（${ids.join('、')}）`)
              .join('；')}`,
    })
  }

  for (const scheme of state.schemes) {
    const whitelist = state.whitelist.filter((item) => item.schemeCode === scheme.code)
    const seen = new Set<string>()
    const duplicated = whitelist.filter((item) => {
      if (seen.has(item.userId)) return true
      seen.add(item.userId)
      return false
    })
    items.push({
      id: `whitelist-dup-${scheme.code}`,
      object: '白名单用户',
      name: `${scheme.code} ${scheme.name}`,
      check: '白名单用户不重复登记',
      ok: duplicated.length === 0,
      severity: 'warn',
      detail:
        duplicated.length === 0
          ? `共 ${whitelist.length} 条白名单记录，无重复用户。`
          : `重复登记：${[
              ...new Set(duplicated.map((item) => `${item.userId}（${item.addedAt.slice(0, 10)}）`)),
            ].join('、')}；计算命中时已合并，只计 1 人。`,
    })
    const version = versionById(state, scheme.linkedProfileVersionId)
    const missing = whitelist.filter((item) => !userById(state, item.userId))
    items.push({
      id: `whitelist-user-${scheme.code}`,
      object: '白名单用户',
      name: `${scheme.code} ${scheme.name}`,
      check: '白名单用户存在于用户名单',
      ok: missing.length === 0,
      severity: 'block',
      detail:
        missing.length === 0
          ? '全部白名单用户都能校验分层。'
          : `用户名单缺失：${missing.map((item) => item.userId).join('、')}。`,
    })
    if (version) {
      const outside = whitelist.filter((item) => !layerOf(version, scheme, item.userId))
      items.push({
        id: `whitelist-layer-${scheme.code}`,
        object: '白名单用户',
        name: `${scheme.code} ${scheme.name}`,
        check: '白名单用户落在当前目标分层',
        ok: outside.length === 0,
        severity: 'info',
        detail:
          outside.length === 0
            ? `全部白名单用户位于 ${profileLabel(version)} 的 ${targetLayerNames(scheme).join('、')}。`
            : `${outside.length} 人不在目标层：${outside
                .map((item) => item.userId)
                .join('、')}；命中预演中会给出未命中原因。`,
      })
    }
  }

  const failed = items.filter((item) => !item.ok).length
  return { ok: failed === 0, total: items.length, failed, items }
}

export function experimentSummary(state: ExperimentState) {
  const rows = schemeRows(state)
  const historicalBatches = state.batches.filter((batch) =>
    batchIsHistorical(versionById(state, batch.profileVersionId), batch),
  )
  return {
    profileVersions: state.profiles.length,
    publishedVersions: state.profiles.filter((profile) => profile.status === '已发布').length,
    voidedVersions: state.profiles.filter((profile) => isVersionVoided(profile)).length,
    schemeCount: state.schemes.length,
    eligibleSchemes: rows.filter((row) => row.eligibility.eligible).length,
    blockedSchemes: rows.filter((row) => !row.eligibility.eligible).length,
    cumulativeHits: rows.reduce((sum, row) => sum + row.hitCount, 0),
    historicalHits: new Set(
      historicalBatches.flatMap((batch) =>
        batch.hits.map((hit) => `${batch.schemeCode}|${hit.userId}`),
      ),
    ).size,
    batchCount: state.batches.length,
    whitelistCount: state.whitelist.length,
    duplicateWhitelist:
      state.whitelist.length -
      new Set(state.whitelist.map((item) => `${item.schemeCode}|${item.userId}`)).size,
    historyPolicy: HISTORY_POLICY,
  }
}

export function experimentUsers(state: ExperimentState) {
  return state.users
}
