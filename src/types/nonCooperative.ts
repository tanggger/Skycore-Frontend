/* ── 非合作模式数据类型 ── */

/** non_cooperative.observed_signal_events 中的单条记录 */
export interface ObservedSignalEvent {
  time: number
  nodeId: number
  signalType: string
  frequency: number
  power: number
  duration: number
  confidence: number
  [key: string]: any
}

/** non_cooperative.observed_comm_windows 中的单条记录 */
export interface ObservedCommWindow {
  windowStart: number
  windowEnd: number
  activeNodes: number[]
  observedPackets: number
  snr: number
  [key: string]: any
}

/** non_cooperative.observed_link_evidence 中的单条记录 */
export interface ObservedLinkEvidence {
  srcNode: number
  dstNode: number
  evidenceType: string
  confidence: number
  observedTime: number
  [key: string]: any
}

/** non_cooperative.inferred_topology_edges 中的单条记录 */
export interface InferredTopologyEdge {
  srcNode: number
  dstNode: number
  probability: number
  inferenceMethod: string
  [key: string]: any
}

/** non_cooperative.inferred_graph_nodes 中的单条记录 */
export interface InferredGraphNode {
  nodeId: number
  weight: number
  degree: number
  centrality: number
  [key: string]: any
}

/** non_cooperative.key_node_candidates 中的单条记录 */
export interface KeyNodeCandidate {
  nodeId: number
  score: number
  rank: number
  role: string
  [key: string]: any
}

/** non_cooperative.attack.recommendations 中的单条记录 */
export interface NonCooperativeAttackRecommendation {
  windowStart: number
  windowEnd: number
  recommendedObservedNodeId: number
  recommendedScore: number
  recommendationRank: number
  recommendationReason: string
  inferenceMethod: string
  [key: string]: any
}

/** non_cooperative.attack.plan */
export interface NonCooperativeAttackPlan {
  recommendedObservedNodeId: number
  confirmedObservedNodeId: number
  attackExecuteTime: number
  targetBindingStatus: string
  strikeExecuteTime?: number
  executedObservedNodeId?: number
  executedEntityNodeId?: number
  targetNeighborhoodSize?: number
  evaluationWindowStart?: number
  evaluationWindowEnd?: number
  [key: string]: any
}

/** non_cooperative.attack.events 中的单条记录 */
export interface NonCooperativeAttackEvent {
  eventTime: number
  attackType: string
  recommendedObservedNodeId: number
  confirmedObservedNodeId: number
  executedObservedNodeId: number
  targetBindingStatus: string
  isTrueTargetHit: boolean
  targetMismatchType: string
  nodeRemoved: boolean
  [key: string]: any
}

/** non_cooperative.attack.target_binding 中的单条记录 */
export interface NonCooperativeTargetBinding {
  eventTime: number
  observedNodeId: number
  bindingStatus: string
  bindingConfidence: number
  isTrackStable: boolean
  isTrackActive: boolean
  boundTargetObjectKey: string
  executedEntityNodeId: number
  isTrueCriticalTarget: boolean
  mismatchType: string
  [key: string]: any
}

/** non_cooperative.attack.effect_metrics 中的单条记录 */
export interface NonCooperativeAttackEffectMetric {
  time: number
  phase: 'pre_attack' | 'immediate_post_attack' | 'recovery' | 'final'
  targetScope: 'global' | 'target_neighborhood'
  connectivityRatio: number
  pdr: number
  throughputMbps: number
  delayMs: number
  damageDuration?: number
  recoveryProgress?: number
  [key: string]: any
}

/** non_cooperative.attack.summary 完整结构 */
export interface NonCooperativeAttackSummary {
  phaseMetrics: any
  finalMetrics: any
  recoverySummary: any
  [key: string]: any
}

/** 非合作模式完整数据层 */
export interface NonCooperativeData {
  observation_inference?: {
    observed_signal_events?: ObservedSignalEvent[]
    observed_comm_windows?: ObservedCommWindow[]
    observed_link_evidence?: ObservedLinkEvidence[]
    inferred_topology_edges?: InferredTopologyEdge[]
    inferred_graph_nodes?: InferredGraphNode[]
    key_node_candidates?: KeyNodeCandidate[]
  }
  attack?: {
    recommendations?: NonCooperativeAttackRecommendation[]
    plan?: NonCooperativeAttackPlan
    events?: NonCooperativeAttackEvent[]
    target_binding?: NonCooperativeTargetBinding[]
    effect_metrics?: NonCooperativeAttackEffectMetric[]
    summary?: NonCooperativeAttackSummary
  }
}
