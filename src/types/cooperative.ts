/* ── 合作模式数据类型 ── */

/** cooperative.mode_summary */
export interface CooperativeModeSummary {
  operationMode: string
  communicationMode: string
  recoveryPolicy: string
  recoveryObjective: string
  sceneType: string
  difficulty: string
  formation: string
  leaderNodeId: number
  backupLeaderList: number[]
  distributedHopLimit: number
  failureType: string
  failureTargetId: number
  failureStartTime: number
  failureDuration: number
  recoveryCooldown: number
  actionFlags: Record<string, boolean>
}

/** cooperative.dashboard_snapshot */
export interface CooperativeDashboardSnapshot {
  phase: string
  operationMode: string
  communicationMode: string
  leaderNodeId: number
  backupLeaderId: number
  isLeaderAlive: boolean
  failureActive: boolean
  failureType: string
  failureTargetId: number
  responseTimeSec: number
  recoveryTimeSec: number
  stabilizationTimeSec: number
  recoveryStatus: string
  latestActionType: string
}

/** cooperative.failure_timeline 中的单个事件 */
export interface CooperativeFailureEvent {
  time: number
  failureType: string
  targetNodeId: number
  targetRole: string
  isLeaderTarget: boolean
  failureState: string
  affectedNeighborCount: number
  affectedLinkCount: number
  effectSummary: string
  source: string
}

/** cooperative.failure_timeline 完整结构 */
export interface CooperativeFailureTimeline {
  events: CooperativeFailureEvent[]
}

/** cooperative.recovery_timeline 中的单个动作 */
export interface CooperativeRecoveryAction {
  time: number
  phase: string
  communicationMode: string
  recoveryPolicy: string
  effectiveRecoveryPolicy: string
  triggerReason: string
  executorNodeId: number
  targetNodeIds: number[]
  actionType: string
  oldValue: string
  newValue: string
  scope: string
  expectedEffect: string
  resultState: string
}

/** cooperative.recovery_timeline 完整结构 */
export interface CooperativeRecoveryTimeline {
  actions: CooperativeRecoveryAction[]
}

/** cooperative.metrics_timeseries 中的一个样本 */
export interface CooperativeMetricsSample {
  time: number
  phase: string
  connectivity: number
  avgDegree: number
  pdr: number
  throughputMbps: number
  delayMs: number
  p99DelayMs: number
  activeNodeCount: number
  leaderNodeId: number
  isLeaderAlive: boolean
  responseTimeSec: number
  recoveryTimeSec: number
  stabilizationTimeSec: number
}

/** cooperative.metrics_timeseries 完整结构 */
export interface CooperativeMetricsTimeseries {
  samples: CooperativeMetricsSample[]
}

/** 合作模式完整数据层 */
export interface CooperativeData {
  mode_summary?: CooperativeModeSummary
  dashboard_snapshot?: CooperativeDashboardSnapshot
  failure_timeline?: CooperativeFailureTimeline
  recovery_timeline?: CooperativeRecoveryTimeline
  metrics_timeseries?: CooperativeMetricsTimeseries
  // CSV 明细（可选）
  failure_events?: any[]
  recovery_actions?: any[]
  recovery_metrics?: any[]
  decision_trace?: any[]
}
