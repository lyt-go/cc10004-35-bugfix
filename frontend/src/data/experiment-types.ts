/** 画像生命周期 + 分流命中的领域类型。 */

export type ProfileLifecycleStatus = '草稿' | '画像评审中' | '已发布' | '已作废'
export type SchemeLifecycleStatus = '草稿' | '方案评审中' | '已生效' | '已下线'

export type ProfileLayer = {
  name: string
  userIds: string[]
}

export type ProfileVersion = {
  /** 版本唯一标识，例如 PROF-0002@v1，命中批次永远引用这个快照标识。 */
  id: string
  profileCode: string
  profileName: string
  version: string
  status: ProfileLifecycleStatus
  dimensions: string
  aggregateMetric: string
  layerRange: string
  updateCycle: string
  layers: ProfileLayer[]
  publishedAt: string | null
  /** 作废时间即历史命中边界：早于该时间的批次保留，之后不再参与新命中。 */
  voidedAt: string | null
  updatedAt: string
  note?: string
}

export type ExperimentUser = {
  id: string
  name: string
  source: string
}

export type WhitelistMember = {
  schemeCode: string
  userId: string
  addedAt: string
  note?: string
}

export type AbScheme = {
  code: string
  name: string
  type: string
  ratio: string
  groupTag: string
  mutexRule: string
  page: string
  status: SchemeLifecycleStatus
  /** 绑定的是画像版本快照，而不是「画像编号」这类可漂移的引用。 */
  linkedProfileVersionId: string | null
  targetLayers: string[]
  /** 排期窗口：同一窗口内重复提交、多个入口同时命中都合并为同一批。 */
  scheduleWindow: string
  scheduleEntrances: string[]
  createdAt: string
  updatedAt: string
}

export type HitRecord = {
  userId: string
  userName: string
  schemeCode: string
  batchId: string
  profileVersionId: string
  profileVersionLabel: string
  layerName: string
  hitAt: string
}

export type SkipCode =
  | 'scheme-ineligible'
  | 'already-hit-other-version'
  | 'profile-missing'
  | 'profile-unpublished'
  | 'profile-voided'
  | 'layer-missing'
  | 'not-in-layer'
  | 'already-hit'
  | 'unknown-user'
  | 'duplicate-whitelist'

export type SkipRecord = {
  userId: string
  userName: string
  code: SkipCode
  reason: string
  profileVersionId: string | null
  profileVersionLabel: string
  relatedBatchId?: string
}

export type HitBatch = {
  id: string
  schemeCode: string
  /** 写批次时冻结的画像版本，后续画像生命周期变化不会改写这里。 */
  profileVersionId: string
  profileVersionLabel: string
  profilePublishedAt: string | null
  windowKey: string
  idempotencyKey: string
  entrances: string[]
  createdAt: string
  committedAt: string
  status: 'complete'
  hits: HitRecord[]
  skips: SkipRecord[]
  previousBatchId: string | null
  revision: number
  note?: string
}

export type AttemptStatus = 'complete' | 'unchanged' | 'blocked'

export type RunAttempt = {
  id: string
  schemeCode: string
  entrances: string[]
  windowKey: string
  profileVersionId: string | null
  profileVersionLabel: string
  at: string
  status: AttemptStatus
  batchId?: string
  newHitCount: number
  message: string
  reasonCode?: string
}

export type LinkageEvent = {
  id: string
  at: string
  kind: 'void-profile' | 'publish-profile' | 'update-profile'
  profileVersionId: string
  affectedSchemeCodes: string[]
  affectedBatchIds: string[]
  note: string
}

export type ExperimentState = {
  schemaVersion: number
  revision: number
  updatedAt: string
  profiles: ProfileVersion[]
  users: ExperimentUser[]
  schemes: AbScheme[]
  whitelist: WhitelistMember[]
  batches: HitBatch[]
  attempts: RunAttempt[]
  linkageEvents: LinkageEvent[]
  diagnostics: ExperimentDiagnostic[]
  nextBatchSeq: number
  nextAttemptSeq: number
  nextLinkageSeq: number
  nextDiagnosticSeq: number
}

export type DiagnosticKind =
  | 'commit-failed'
  | 'interrupted-rollback'
  | 'interrupted-forward'
  | 'storage-error'

export type ExperimentDiagnostic = {
  id: string
  at: string
  kind: DiagnosticKind
  reason: string
  schemeCode?: string
  profileVersionId?: string
  preservedBatchId?: string
  retryable: boolean
}

export type EligibilityCode =
  | 'eligible'
  | 'scheme-inactive'
  | 'profile-missing'
  | 'profile-unpublished'
  | 'profile-voided'
  | 'layer-missing'

export type SchemeEligibility = {
  eligible: boolean
  code: EligibilityCode
  label: string
  detail: string
}

export type ProfileBoardRow = {
  versionId: string
  profileCode: string
  profileName: string
  version: string
  status: ProfileLifecycleStatus
  publishedAt: string | null
  voidedAt: string | null
  updatedAt: string
  coverage: number
  dimensions: string
  aggregateMetric: string
  layerRange: string
  updateCycle: string
  layers: ProfileLayer[]
  linkedSchemes: string[]
  batchCount: number
  hitCount: number
  currentVersionOfProfile: boolean
  canPublish: boolean
  canVoid: boolean
  canUpdate: boolean
  note?: string
}

export type SchemeBoardRow = {
  scheme: AbScheme
  eligibility: SchemeEligibility
  linkedVersion: ProfileVersion | null
  linkedVersionLabel: string
  whitelistCount: number
  duplicateWhitelistCount: number
  hitCount: number
  batchCount: number
  latestBatch: HitBatch | null
  currentVersionHits: number
}

export type HitView = HitRecord & {
  batchCommittedAt: string
  batchEntrances: string[]
  isHistorical: boolean
  profileVersionNowStatus: ProfileLifecycleStatus | '缺失'
  profileVoidedAt: string | null
}

export type BatchView = HitBatch & {
  isHistorical: boolean
  profileVersionNowStatus: ProfileLifecycleStatus | '缺失'
  profileVoidedAt: string | null
  cumulativeHitCount: number
}

export type WhitelistView = {
  userId: string
  userName: string
  addedAt: string
  note?: string
  layerName: string
  inTargetLayer: boolean
  duplicated: boolean
  alreadyHitBatchId: string | null
  alreadyHitVersionLabel: string | null
  /** 按当前画像版本与方案资格计算出的白名单诊断结论。 */
  evaluationCode: SkipCode | 'hit'
  evaluationReason: string
}

export type PreviewHit = {
  userId: string
  userName: string
  layerName: string
}

export type EvaluationPreview = {
  eligible: boolean
  profileVersionId: string | null
  profileVersionLabel: string
  hits: PreviewHit[]
  skips: SkipRecord[]
  reason: string
}

export type SchemeDetail = {
  row: SchemeBoardRow
  historyPolicy: string
  eligibility: SchemeEligibility
  linkedVersion: ProfileVersion | null
  whitelist: WhitelistView[]
  preview: EvaluationPreview
  batches: BatchView[]
  hits: HitView[]
  attempts: RunAttempt[]
  linkageEvents: LinkageEvent[]
  totals: {
    cumulativeHitCount: number
    currentVersionHits: number
    batchCount: number
    byVersion: {
      profileVersionId: string
      profileVersionLabel: string
      hitCount: number
      batchCount: number
      nowStatus: ProfileLifecycleStatus | '缺失'
      voidedAt: string | null
    }[]
  }
}

export type ProfileDetail = {
  row: ProfileBoardRow
  profile: ProfileVersion
  siblings: {
    versionId: string
    version: string
    status: ProfileLifecycleStatus
    publishedAt: string | null
    voidedAt: string | null
  }[]
  linkedSchemes: {
    code: string
    name: string
    status: SchemeLifecycleStatus
    eligibility: SchemeEligibility
  }[]
  batches: BatchView[]
  totals: {
    cumulativeHitCount: number
    historyHitRecords: number
    batchCount: number
    historicalBatchCount: number
  }
  historyPolicy: string
}

export type AuditItem = {
  id: string
  object: '画像定义' | '分流方案' | '白名单用户' | '命中批次'
  name: string
  check: string
  ok: boolean
  severity: 'block' | 'warn' | 'info'
  detail: string
}

export type AuditResult = {
  ok: boolean
  total: number
  failed: number
  items: AuditItem[]
}

export type ServiceResult<T> = {
  ok: boolean
  message: string
  data?: T
  diagnostic?: ExperimentDiagnostic
}

export type RefreshResult = {
  schemeCode: string
  status: AttemptStatus
  attempt: RunAttempt
  batchId?: string
  preservedBatchId?: string
  newHitCount: number
  message: string
}

export type ProfileMutationResult = {
  profileVersionId: string
  affectedSchemeCodes: string[]
  affectedBatchIds: string[]
  message: string
}
