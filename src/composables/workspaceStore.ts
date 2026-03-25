/**
 * 工作区数据仓库
 * 统一管理 runMeta + workspaceData (shared / cooperative / nonCooperative)
 */
import { ref, computed, reactive } from 'vue'
import type {
  RunMeta,
  WorkspaceData,
  SharedData,
  FrontendResponseData,
  FrameData,
  UAVNode
} from '../types'
import type { CooperativeData } from '../types/cooperative'
import type { NonCooperativeData } from '../types/nonCooperative'

// ── 空状态工厂 ──
function emptyShared(): SharedData {
  return {
    environment_summary: {},
    request_metadata: {},
    positions: [],
    transmissions: [],
    topology_links: [],
    topology_evolution: [],
    topology_detailed: [],
    resource_detailed: [],
    qos: [],
    flow_summary: []
  }
}

function emptyCooperative(): CooperativeData {
  return {}
}

function emptyNonCooperative(): NonCooperativeData {
  return {
    observation_inference: {},
    attack: {}
  }
}

// ── 全局唯一状态 ──
const runMeta = reactive<RunMeta>({
  taskId: '',
  operationMode: 'cooperative',
  sceneType: 'urban',
  difficulty: 'Moderate',
  formation: 'v_formation',
  communicationMode: 'hybrid'
})

const workspaceData = reactive<WorkspaceData>({
  shared: emptyShared(),
  cooperative: emptyCooperative(),
  nonCooperative: emptyNonCooperative()
})

const taskStatus = ref<'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED'>('IDLE')

export function useWorkspaceStore() {

  const isCooperative = computed(() => runMeta.operationMode === 'cooperative')
  const isNonCooperative = computed(() => runMeta.operationMode === 'non_cooperative')

  /** 从 /api/results/<task_id>/frontend 响应填充 */
  function loadFromFrontendResponse(data: FrontendResponseData) {
    // meta
    if (data.meta) {
      runMeta.taskId = data.meta.taskId
      runMeta.operationMode = data.meta.operationMode
      runMeta.sceneType = data.meta.sceneType
      runMeta.difficulty = data.meta.difficulty
      runMeta.formation = data.meta.formation
      runMeta.communicationMode = data.meta.communicationMode
    }

    // shared
    if (data.shared) {
      Object.assign(workspaceData.shared, data.shared)
    }

    // cooperative
    if (data.cooperative && Object.keys(data.cooperative).length > 0) {
      Object.assign(workspaceData.cooperative, data.cooperative)
    }

    // non_cooperative
    if (data.non_cooperative && Object.keys(data.non_cooperative).length > 0) {
      Object.assign(workspaceData.nonCooperative, data.non_cooperative)
    }
  }

  /** 清空所有数据 */
  function reset() {
    runMeta.taskId = ''
    runMeta.operationMode = 'cooperative'
    runMeta.sceneType = 'urban'
    runMeta.difficulty = 'Moderate'
    runMeta.formation = 'v_formation'
    runMeta.communicationMode = 'hybrid'

    Object.assign(workspaceData.shared, emptyShared())
    Object.assign(workspaceData.cooperative, emptyCooperative())
    Object.assign(workspaceData.nonCooperative, emptyNonCooperative())

    taskStatus.value = 'IDLE'
  }

  function setTaskStatus(s: typeof taskStatus.value) {
    taskStatus.value = s
  }

  return {
    runMeta,
    workspaceData,
    taskStatus,
    isCooperative,
    isNonCooperative,
    loadFromFrontendResponse,
    reset,
    setTaskStatus
  }
}
