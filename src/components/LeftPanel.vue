<script setup lang="ts">
import { inject, computed, reactive, watch, ref } from 'vue'
import gsap from 'gsap'
import { apiService, type SimulationConfig, type CustomSimulationParams } from '../services/apiService'
import ConfigDetailModal from './ConfigDetailModal.vue'
import { currentFormation, formationLabels } from '../composables/useFormation'
import { activeScene, missionWaypoints, interactionState, simulationStrategy, geojsonMapName, sceneMode } from '../composables/useScene'
import { useAppMode } from '../composables/useAppMode'
import { useWorkspaceStore } from '../composables/workspaceStore'
import type { FormationType } from '../data/mockData'

const { currentAppMode, backendSceneType, backendOperationMode } = useAppMode()
const { loadFromFrontendResponse, setTaskStatus, workspaceData, runMeta } = useWorkspaceStore()

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)

const qos = computed(() => frame.value?.QoS || { total_pdr: 0, p99_latency_ms: 0, throughput_mbps: 0, algo_compute_time_ms: 0 })

const healthScore = computed(() => Math.round((qos.value.total_pdr) * 100))

// Animated values (Vue reactive proxy for template binding)
const display = reactive({
  pdr: 0,
  latency: 0,
  throughput: 0,
  health: 0
})

// Plain JS tween targets (GSAP animates these, then we sync to Vue reactive)
const _tweenQos = { pdr: 0, latency: 0, throughput: 0 }
const _tweenHealth = { health: 0 }

watch(qos, (n) => {
  if (!n) return
  gsap.to(_tweenQos, {
    pdr: (n.total_pdr || 0) * 100,
    latency: n.p99_latency_ms || 0,
    throughput: n.throughput_mbps || 0,
    duration: 0.3,
    ease: 'power2.out',
    onUpdate() {
      display.pdr = _tweenQos.pdr
      display.latency = _tweenQos.latency
      display.throughput = _tweenQos.throughput
    },
    onComplete() {
      display.pdr = _tweenQos.pdr
      display.latency = _tweenQos.latency
      display.throughput = _tweenQos.throughput
    }
  })
}, { deep: true, immediate: true })

watch(healthScore, (n) => {
  gsap.to(_tweenHealth, {
    health: n || 0,
    duration: 0.3,
    ease: 'power2.out',
    onUpdate() {
      display.health = _tweenHealth.health
    },
    onComplete() {
      display.health = _tweenHealth.health
    }
  })
}, { immediate: true })

const pdrPct = computed(() => display.pdr.toFixed(1))
const latencyDisplay = computed(() => display.latency.toFixed(1))
const throughput = computed(() => display.throughput.toFixed(1))
const displayHealth = computed(() => Math.round(display.health))

// ★ 新增：全网平均干扰
const avgInterference = computed(() => {
  if (!frame.value) return '-90.0'
  const vals = frame.value.uav_nodes
    .filter((u: any) => u.node_type !== 1)
    .map((u: any) => u.interference ?? -95) // Default to -95 dBm (noise floor)
  if (vals.length === 0) return '-90.0'
  return (vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(1)
})

// ★ 新增：平均邻居数
const avgNeighbors = computed(() => {
  if (!frame.value) return '0'
  const vals = frame.value.uav_nodes
    .filter((u: any) => u.node_type !== 1)
    .map((u: any) => u.neighbors ?? 0)
  if (vals.length === 0) return '0'
  return (vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(1)
})

const avgPower = computed(() => {
  if (!frame.value) return '0.0'
  const vals = frame.value.uav_nodes
    .filter((u: any) => u.node_type !== 1)
    .map((u: any) => u.power !== undefined ? u.power : 20)
  if (vals.length === 0) return '0.0'
  return (vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(1)
})

const healthColor = computed(() => {
  const s = healthScore.value
  if (s >= 90) return '#00ff88'
  if (s >= 75) return '#00f2ff'
  if (s >= 60) return '#ffaa00'
  return '#ff3b3b'
})

// UAV list
const uavList = computed(() => {
  if (!frame.value) return []
  return frame.value.uav_nodes.slice(0, 15)
})

const channelLabels = ['CH1', 'CH2', 'CH3']
const channelColors = ['#00f2ff', '#a855f7', '#00ff88']

const simConfig = reactive({
  swarm_size: 15,
  difficulty: 'Hard' as SimulationConfig['difficulty'],
  strategy: simulationStrategy,
  formation_spacing: 12  // 默认间距 12m
})

// -------- 合作模式专用配置 --------
const coopConfig = reactive({
  communicationMode: 'hybrid' as 'centralized' | 'distributed' | 'hybrid',
  leaderNodeId: 0,
  backupLeaderList: '2,3,4',
  distributedHopLimit: 1,
  // 故障注入
  cooperativeFailureType: 'node_failure' as 'node_failure' | 'environment_degradation' | 'external_interference' | 'link_degradation',
  failureTargetId: 7,
  failureStartTime: 80.0,
  failureDuration: 40.0,
  // 恢复策略
  recoveryPolicy: 'global_recovery' as 'global_recovery' | 'local_recovery',
  recoveryObjective: 'connectivity' as 'connectivity' | 'delay' | 'throughput' | 'pdr',
  recoveryCooldown: 1.0,
  // 动作开关
  allowChannelReallocation: true,
  allowPowerAdjustment: true,
  allowRateAdjustment: true,
  allowRelayReselection: true,
  allowSlotReallocation: true,
  allowRouteRebuild: true,
})

// -------- Custom Config Logic --------
const showConfigModal = ref(false)
const configMode = ref<'view' | 'edit'>('view')
const customParams = ref<CustomSimulationParams>({})

// Watch for difficulty change to 'Custom'
watch(() => simConfig.difficulty, (newVal) => {
  if (newVal === 'Custom') {
    configMode.value = 'edit'
    showConfigModal.value = true
  }
})

function openConfigModal() {
  if (simConfig.difficulty === 'Custom') {
    configMode.value = 'edit'
  } else {
    configMode.value = 'view'
  }
  showConfigModal.value = true
}

function onSaveCustom(params: CustomSimulationParams) {
  customParams.value = params
  if (simConfig.difficulty !== 'Custom') {
    simConfig.difficulty = 'Custom'
  }
}
// -------------------------------------

const isSimulating = ref(false)

// -------- Non-Cooperative State --------
const nonCoopConfig = reactive({
  // 打击闭环参数 (§4.3.4)
  enableNonCooperativeAttack: false,
  attackType: 'node_strike',
  manualStrikeTarget: null as number | null,
  attackExecuteTime: 80.0,
  attackEvaluationDuration: 60.0,
  attackNeighborhoodHop: 1,
})

/** 构建完整仿真配置 */
function buildSimConfig(mode: 'cooperative' | 'non_cooperative'): SimulationConfig {
  const base: SimulationConfig = {
    operationMode: mode,
    sceneType: backendSceneType.value,
    buildings: activeScene.buildings,
    swarm_size: simConfig.swarm_size,
    formation_spacing: simConfig.formation_spacing,
    difficulty: simConfig.difficulty,
    strategy: simConfig.strategy,
    formation: currentFormation.value,
    start: missionWaypoints.start,
    target: missionWaypoints.target,
    // Custom params merge
    ...(simConfig.difficulty === 'Custom' ? customParams.value : {}),
    // GeoJSON 模式
    ...(sceneMode.value === 'geojson' && geojsonMapName.value
      ? { map_name: geojsonMapName.value, buildings: [] }
      : {})
  }

  // 合作模式注入额外字段
  if (mode === 'cooperative') {
    Object.assign(base, {
      communicationMode: coopConfig.communicationMode,
      leaderNodeId: coopConfig.leaderNodeId,
      backupLeaderList: coopConfig.backupLeaderList,
      distributedHopLimit: coopConfig.distributedHopLimit,
      cooperativeFailureType: coopConfig.cooperativeFailureType,
      failureTargetId: coopConfig.failureTargetId,
      failureStartTime: coopConfig.failureStartTime,
      failureDuration: coopConfig.failureDuration,
      recoveryPolicy: coopConfig.recoveryPolicy,
      recoveryObjective: coopConfig.recoveryObjective,
      recoveryCooldown: coopConfig.recoveryCooldown,
      allowChannelReallocation: coopConfig.allowChannelReallocation,
      allowPowerAdjustment: coopConfig.allowPowerAdjustment,
      allowRateAdjustment: coopConfig.allowRateAdjustment,
      allowRelayReselection: coopConfig.allowRelayReselection,
      allowSlotReallocation: coopConfig.allowSlotReallocation,
      allowRouteRebuild: coopConfig.allowRouteRebuild,
    })
  }

  // 非合作模式注入打击字段
  if (mode === 'non_cooperative' && nonCoopConfig.enableNonCooperativeAttack) {
    Object.assign(base, {
      enableNonCooperativeAttack: true,
      attackType: nonCoopConfig.attackType,
      manualStrikeTarget: nonCoopConfig.manualStrikeTarget,
      attackExecuteTime: nonCoopConfig.attackExecuteTime,
      attackEvaluationDuration: nonCoopConfig.attackEvaluationDuration,
      attackNeighborhoodHop: nonCoopConfig.attackNeighborhoodHop,
    })
  }

  return base
}

async function handleStartSim() {
  if (isSimulating.value) return
  isSimulating.value = true
  setTaskStatus('RUNNING')
  try {
    const config = buildSimConfig(backendOperationMode.value)
    const { frames, frontendData } = await apiService.runSimulationAndPoll(config)

    // 将 frontendData 存入 workspaceStore
    if (frontendData) {
      loadFromFrontendResponse(frontendData)
    }

    engine.loadFrames(frames)
    engine.play()
    setTaskStatus('SUCCESS')
  } catch(e: any) {
    console.error('仿真启动失败', e)
    setTaskStatus('FAILED')
    alert('推演运算失败：\n' + (e.message || '无法连接到仿真引擎或内部错误'))
  } finally {
    isSimulating.value = false
  }
}

async function handleStartInference() {
  if (isSimulating.value) return
  await handleStartSim()
}

function handleExecuteAttack() {
  // 强制开启打击闭环并触发仿真
  nonCoopConfig.enableNonCooperativeAttack = true
  handleStartSim()
}
</script>

<template>
  <ConfigDetailModal 
    :visible="showConfigModal"
    :mode="configMode"
    :current-difficulty="simConfig.difficulty"
    :initial-params="customParams"
    @close="showConfigModal = false"
    @save="onSaveCustom"
  />

  <aside class="left-panel">
    <!-- 智能推演控制 -->
    <div class="glass-panel sim-control-card">
      <div class="section-title">{{ currentAppMode === 'cooperative' ? '我方网络规划与路由' : '观测态势与推断打击' }}</div>
      
      <!-- 合作模式控制面板 -->
      <div v-if="currentAppMode === 'cooperative'" class="control-form compact">
        <div class="form-row-multi">
          <div class="form-group">
            <label>规模</label>
            <select v-model="simConfig.swarm_size" class="glass-select">
              <option :value="5">5 架</option>
              <option :value="10">10 架</option>
              <option :value="15">15 架</option>
              <option :value="20">20 架</option>
            </select>
          </div>
          <div class="form-group">
            <label>难度 <a href="#" class="config-link" @click.prevent="openConfigModal" title="查看/配置详细参数">⚙️</a></label>
            <select v-model="simConfig.difficulty" class="glass-select">
              <option value="Easy">Easy</option>
              <option value="Moderate">Mid</option>
              <option value="Hard">Hard</option>
              <option value="Custom">Custom</option>
            </select>
          </div>
          <div class="form-group" style="flex: 1.5;">
            <label>策略</label>
            <select v-model="simConfig.strategy" class="glass-select">
              <option value="static">Static</option>
              <option value="dynamic">AI Dynamic</option>
            </select>
          </div>
        </div>

        <!-- 阵型选择 (从TopBar迁移) -->
        <div class="form-row-multi" style="margin-top: 4px;">
          <div class="form-group" style="flex: 1.5;">
            <label>初始阵型</label>
            <select v-model="currentFormation" class="glass-select">
              <option v-for="(label, key) in formationLabels" :key="key" :value="key">
                {{ label }}
              </option>
            </select>
          </div>
          <div class="form-group" style="flex: 1;">
            <label>编队间距 (m)</label>
            <input v-model.number="simConfig.formation_spacing" type="number" class="glass-select" min="5" max="100" />
          </div>
        </div>
        <div class="form-row-multi" style="margin-top: 4px;">
          <div class="form-group">
            <label class="waypoint-label">
              起点 
              <span class="picker-btn" :class="{ active: interactionState.mode === 'setStart' }" @click="interactionState.mode = interactionState.mode === 'setStart' ? 'none' : 'setStart'" title="在地图上点击选择">📍选点</span>
            </label>
            <input v-model="missionWaypoints.start" type="text" class="glass-select" placeholder="0,0,30" />
          </div>
          <div class="form-group">
            <label class="waypoint-label">
              终点 
              <span class="picker-btn" :class="{ active: interactionState.mode === 'setTarget' }" @click="interactionState.mode = interactionState.mode === 'setTarget' ? 'none' : 'setTarget'" title="在地图上点击选择">🎯选点</span>
            </label>
            <input v-model="missionWaypoints.target" type="text" class="glass-select" placeholder="500,500,30" />
          </div>
        </div>

        <!-- ★ 通信模式 & 领队配置 -->
        <div class="form-section-label">通信模式 & 领队</div>
        <div class="form-row-multi" style="margin-top: 4px;">
          <div class="form-group" style="flex: 1.5;">
            <label>通信模式</label>
            <select v-model="coopConfig.communicationMode" class="glass-select">
              <option value="centralized">集中式</option>
              <option value="distributed">分布式</option>
              <option value="hybrid">混合</option>
            </select>
          </div>
          <div class="form-group">
            <label>领队 ID</label>
            <input v-model.number="coopConfig.leaderNodeId" type="number" class="glass-select" min="0" />
          </div>
        </div>
        <div class="form-row-multi" style="margin-top: 4px;">
          <div class="form-group" style="flex: 1.5;">
            <label>备份领队</label>
            <input v-model="coopConfig.backupLeaderList" type="text" class="glass-select" placeholder="2,3,4" />
          </div>
          <div class="form-group">
            <label>跳数限制</label>
            <select v-model.number="coopConfig.distributedHopLimit" class="glass-select">
              <option :value="1">1 跳</option>
              <option :value="2">2 跳</option>
            </select>
          </div>
        </div>

        <!-- ★ 故障注入 -->
        <div class="form-section-label">故障注入</div>
        <div class="form-row-multi" style="margin-top: 4px;">
          <div class="form-group" style="flex: 2;">
            <label>故障类型</label>
            <select v-model="coopConfig.cooperativeFailureType" class="glass-select">
              <option value="node_failure">节点失效</option>
              <option value="environment_degradation">环境恶化</option>
              <option value="external_interference">外部干扰</option>
              <option value="link_degradation">链路退化</option>
            </select>
          </div>
          <div class="form-group">
            <label>目标 ID</label>
            <input v-model.number="coopConfig.failureTargetId" type="number" class="glass-select" min="0" />
          </div>
        </div>
        <div class="form-row-multi" style="margin-top: 4px;">
          <div class="form-group">
            <label>触发时间 (s)</label>
            <input v-model.number="coopConfig.failureStartTime" type="number" class="glass-select" min="0" step="10" />
          </div>
          <div class="form-group">
            <label>持续时间 (s)</label>
            <input v-model.number="coopConfig.failureDuration" type="number" class="glass-select" min="1" step="5" />
          </div>
        </div>

        <!-- ★ 恢复策略 -->
        <div class="form-section-label">恢复策略</div>
        <div class="form-row-multi" style="margin-top: 4px;">
          <div class="form-group">
            <label>恢复策略</label>
            <select v-model="coopConfig.recoveryPolicy" class="glass-select">
              <option value="global_recovery">全局恢复</option>
              <option value="local_recovery">局部恢复</option>
            </select>
          </div>
          <div class="form-group">
            <label>恢复目标</label>
            <select v-model="coopConfig.recoveryObjective" class="glass-select">
              <option value="connectivity">连通性</option>
              <option value="delay">时延</option>
              <option value="throughput">吞吐量</option>
              <option value="pdr">投递率</option>
            </select>
          </div>
          <div class="form-group" style="flex:0.7;">
            <label>冷却 (s)</label>
            <input v-model.number="coopConfig.recoveryCooldown" type="number" class="glass-select" min="0" step="0.5" />
          </div>
        </div>

        <!-- ★ 动作开关 -->
        <div class="form-section-label">恢复动作开关</div>
        <div class="action-toggles" style="margin-top: 4px;">
          <label class="toggle-item"><input type="checkbox" v-model="coopConfig.allowChannelReallocation" /><span>信道重分配</span></label>
          <label class="toggle-item"><input type="checkbox" v-model="coopConfig.allowPowerAdjustment" /><span>功率调整</span></label>
          <label class="toggle-item"><input type="checkbox" v-model="coopConfig.allowRateAdjustment" /><span>速率调整</span></label>
          <label class="toggle-item"><input type="checkbox" v-model="coopConfig.allowRelayReselection" /><span>中继重选</span></label>
          <label class="toggle-item"><input type="checkbox" v-model="coopConfig.allowSlotReallocation" /><span>时隙重分配</span></label>
          <label class="toggle-item"><input type="checkbox" v-model="coopConfig.allowRouteRebuild" /><span>路由重建</span></label>
        </div>

        <button
          class="glass-btn primary sim-btn"
          :class="{ loading: isSimulating }"
          @click="handleStartSim"
          :disabled="isSimulating"
        >
          <span v-if="!isSimulating" class="btn-content">
            <span class="btn-icon">🚀</span>
            <span>开始环境仿真演练</span>
          </span>
          <span v-else class="btn-content">
            <span class="loading-spinner"></span>
            <span>引擎计算中...</span>
          </span>
          <span class="btn-sweep"></span>
        </button>
      </div>

      <!-- 非合作模式控制面板 -->
      <div v-else class="control-form compact">
        <div class="form-row-multi">
          <div class="form-group">
            <label>规模</label>
            <select v-model="simConfig.swarm_size" class="glass-select">
              <option :value="5">5 架</option>
              <option :value="10">10 架</option>
              <option :value="15">15 架</option>
              <option :value="20">20 架</option>
            </select>
          </div>
          <div class="form-group">
            <label>难度 <a href="#" class="config-link" @click.prevent="openConfigModal" title="查看/配置详细参数">⚙️</a></label>
            <select v-model="simConfig.difficulty" class="glass-select">
              <option value="Easy">Easy</option>
              <option value="Moderate">Mid</option>
              <option value="Hard">Hard</option>
              <option value="Custom">Custom</option>
            </select>
          </div>
        </div>

        <button class="glass-btn primary sim-btn" :class="{ loading: isSimulating }" :disabled="isSimulating" @click="handleStartInference">
          <span v-if="!isSimulating" class="btn-content">
            <span class="btn-icon">👁️</span>
            <span>启动观测与推断</span>
          </span>
          <span v-else class="btn-content">
            <span class="loading-spinner"></span>
            <span>引擎计算中...</span>
          </span>
          <span class="btn-sweep"></span>
        </button>

        <div class="divider" style="margin: 8px 0; border-bottom: 1px dashed rgba(255,255,255,0.1);"></div>

        <!-- ★ 非合作打击闭环 -->
        <div class="form-section-label" style="color: #ff3c3c;">对抗打击闭环</div>

        <div class="form-row-multi" style="margin-top: 4px;">
          <div class="form-group" style="flex: 2;">
            <label class="toggle-item" style="margin: 0;">
              <input type="checkbox" v-model="nonCoopConfig.enableNonCooperativeAttack" />
              <span style="color: #ff6b6b;">启用打击闭环</span>
            </label>
          </div>
        </div>

        <template v-if="nonCoopConfig.enableNonCooperativeAttack">
          <div class="form-row-multi" style="margin-top: 4px;">
            <div class="form-group">
              <label>打击类型</label>
              <select v-model="nonCoopConfig.attackType" class="glass-select" style="color: #ff3c3c; border-color: rgba(255,60,60,0.3)">
                <option value="node_strike">关键节点摧毁</option>
              </select>
            </div>
            <div class="form-group">
              <label>目标节点 ID</label>
              <input v-model.number="nonCoopConfig.manualStrikeTarget" type="number" class="glass-select" placeholder="自动推荐" min="0" />
            </div>
          </div>
          <div class="form-row-multi" style="margin-top: 4px;">
            <div class="form-group">
              <label>打击时间 (s)</label>
              <input v-model.number="nonCoopConfig.attackExecuteTime" type="number" class="glass-select" min="0" step="10" />
            </div>
            <div class="form-group">
              <label>评估窗口 (s)</label>
              <input v-model.number="nonCoopConfig.attackEvaluationDuration" type="number" class="glass-select" min="10" step="10" />
            </div>
          </div>
          <div class="form-row-multi" style="margin-top: 4px;">
            <div class="form-group">
              <label>邻域跳数</label>
              <select v-model.number="nonCoopConfig.attackNeighborhoodHop" class="glass-select">
                <option :value="1">1 跳</option>
                <option :value="2">2 跳</option>
              </select>
            </div>
          </div>

          <button class="glass-btn danger sim-btn attack-btn" :class="{ loading: isSimulating }" :disabled="isSimulating" @click="handleExecuteAttack">
            <span v-if="!isSimulating" class="btn-content">
              <span class="btn-icon">🎯</span>
              <span>执行对抗打击仿真</span>
            </span>
            <span v-else class="btn-content">
              <span class="loading-spinner"></span>
              <span>打击计算中...</span>
            </span>
          </button>
        </template>
      </div>
    </div>

    <!-- 监控总览 (Ring + Metrics) -->
    <div class="glass-panel combined-qos-card" v-if="currentAppMode === 'cooperative'">
      <div class="section-title">我方网络效能总览</div>
      <div class="combined-qos-content">
        <!-- 核心指标 -->
        <div class="metrics-grid dense-grid">
          <div class="metric-item">
            <span class="stat-label">PDR</span>
            <span class="stat-value green" id="m-pdr">{{ pdrPct }}%</span>
          </div>
          <div class="metric-item">
            <span class="stat-label">P99时延</span>
            <span class="stat-value" id="m-delay">{{ latencyDisplay }}ms</span>
          </div>
          <div class="metric-item">
            <span class="stat-label">总吞吐</span>
            <span class="stat-value" id="m-tp">{{ throughput }}</span>
          </div>
          <!-- ★ 新增指标 -->
          <div class="metric-item">
            <span class="stat-label">均功率</span>
            <span class="stat-value">{{ avgPower }}<small style="font-size:10px;opacity:0.6">dBm</small></span>
          </div>
          <div class="metric-item">
            <span class="stat-label">邻居</span>
            <span class="stat-value">{{ avgNeighbors }}</span>
          </div>
          <div class="metric-item">
            <span class="stat-label" :style="{ color: parseFloat(avgInterference) > -60 ? '#ff3b3b' : '' }">干扰</span>
            <span class="stat-value" :style="{ color: parseFloat(avgInterference) > -60 ? '#ff3b3b' : '#00ff88' }">{{ avgInterference }}<small>dBm</small></span>
          </div>
        </div>
      </div>
    </div>



    <!-- 无人机实时状态 -->
    <div class="glass-panel uav-list-card">
      <div class="section-title">无人机实时状态</div>
      <div class="uav-scroll" id="uav-list">
        <!-- 空状态提示 -->
        <div v-if="uavList.length === 0" class="uav-empty-state">
          <div class="uav-empty-icon">🚁</div>
          <div class="uav-empty-text">请先启动仿真演练</div>
          <div class="uav-empty-sub">运行结束后将实时显示各无人机遥测数据</div>
        </div>
        <div
          v-for="(uav, idx) in uavList"
          :key="uav.id"
          class="uav-row"
          :class="{ conflict: uav.is_conflict, nlos: uav.is_nlos }"
          :style="{ animationDelay: `${Number(idx) * 0.03}s` }"
        >
          <div class="uav-id" :style="{ color: uav.is_conflict ? '#ff3b3b' : uav.is_nlos ? '#ffaa00' : '#e2e8f0' }">
            UAV-{{ String(uav.id).padStart(2, '0') }}
          </div>
          <div class="uav-ch-tag" :style="{ color: channelColors[uav.channel] }">
            CH{{ uav.channel + 1 }}
          </div>
          <div class="uav-pos">
            <span class="pos-xy">{{ uav.x.toFixed(0) }},{{ uav.y.toFixed(0) }},{{ (uav.z || 30).toFixed(0) }}</span>
          </div>
          <div class="uav-health-bar">
            <div class="health-fill" :style="{ 
              width: `${(uav.pdr || 0) * 100}%`, 
              backgroundColor: (uav.pdr || 0) > 0.8 ? '#00ff88' : (uav.pdr || 0) > 0.5 ? '#facc15' : '#ff3b3b' 
            }"></div>
          </div>
          <div class="uav-rate-status">
            <span class="pdr-val" :style="{ color: (uav.pdr || 0) > 0.8 ? '#00ff88' : (uav.pdr || 0) > 0.5 ? '#facc15' : '#ff3b3b' }">{{ ((uav.pdr || 0) * 100).toFixed(0) }}%</span>
            <span class="delay-val">{{ (uav.delay || 0).toFixed(0) }}<small>ms</small></span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.left-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  overflow-y: auto;
  padding-right: 4px;
}

.sim-control-card {
  padding: 12px;
  flex-shrink: 0;
  max-height: 42vh;
  overflow-y: auto;
}

.control-form.compact {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row-multi {
  display: flex;
  gap: 6px;
  justify-content: space-between;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.form-group label {
  font-size: 10px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* ── 表单控件战术化重构 ── */
.glass-select {
  background: rgba(10, 14, 39, 0.6); /* 更深沉的底色 */
  border: 1px solid rgba(0, 242, 255, 0.15);
  color: var(--cyan); /* 亮色文字更具科幻感 */
  padding: 6px 8px;
  border-radius: 2px; /* 抛弃大圆角，采用军工切角感 */
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  outline: none;
  cursor: pointer;
  transition: all var(--transition-fast);
  width: 100%;
}

/* 仅对 select 标签生效的下拉箭头样式 */
select.glass-select {
  appearance: none;
  -webkit-appearance: none;
  /* 替换默认下拉箭头为自定义青色战术箭头 */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2300f2ff'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 24px;
}

/* 隐藏 number input 的原生上下箭头（太丑且不符合设计） */
input[type=number].glass-select::-webkit-inner-spin-button,
input[type=number].glass-select::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type=number].glass-select {
  -moz-appearance: textfield;
  /* 添加数字输入专属的视觉提示（可选） */
  padding-right: 8px; 
}

.glass-select:hover, .glass-select:focus {
  border-color: var(--cyan);
  background-color: rgba(0, 242, 255, 0.08);
  box-shadow: 0 0 8px rgba(0, 242, 255, 0.2), inset 0 0 12px rgba(0, 242, 255, 0.05);
}

.glass-select option {
  background: #040714;
  color: var(--cyan);
}

.waypoint-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.picker-btn {
  font-size: 10px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 2px;
  background: rgba(0,0,0,0.3);
  border: 1px solid transparent;
  transition: all 0.2s;
  color: var(--text-secondary);
}

.picker-btn:hover {
  background: rgba(0, 242, 255, 0.08);
  border-color: var(--cyan);
  color: var(--cyan);
}

.picker-btn.active {
  background: rgba(0, 242, 255, 0.15);
  color: var(--cyan);
  border-color: var(--cyan);
  box-shadow: 0 0 8px rgba(0, 242, 255, 0.6);
}

.sim-btn {
  margin-top: 8px;
  width: 100%;
  padding: 12px 16px;        /* ★ 加高 */
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 1px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg,
    rgba(0, 242, 255, 0.12),
    rgba(168, 85, 247, 0.08));
  border: 1px solid rgba(0, 242, 255, 0.3);
  position: relative;
  overflow: hidden;
}

.sim-btn:not(:disabled):hover {
  background: linear-gradient(135deg,
    rgba(0, 242, 255, 0.22),
    rgba(168, 85, 247, 0.15));
  border-color: var(--cyan);
  box-shadow:
    0 0 24px rgba(0, 242, 255, 0.15),
    0 4px 16px rgba(0, 0, 0, 0.3);
  transform: translateY(-1px);
}

.sim-btn.danger.attack-btn {
  background: linear-gradient(135deg, rgba(255, 60, 60, 0.2), transparent);
  border-color: rgba(255, 60, 60, 0.5);
  color: #ff3c3c;
}

.sim-btn.danger.attack-btn:hover {
  background: linear-gradient(135deg, rgba(255, 60, 60, 0.4), transparent);
  box-shadow: 0 0 15px rgba(255, 60, 60, 0.3);
  color: #fff;
}

.sim-btn:active {
  transform: translateY(0) !important;
}

.btn-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  position: relative;
  z-index: 1;
}

.btn-icon {
  font-size: 16px;
  filter: drop-shadow(0 0 4px rgba(0, 242, 255, 0.5));
}

.btn-sweep {
  position: absolute;
  top: 0; left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg,
    transparent,
    rgba(0, 242, 255, 0.08),
    transparent);
  animation: sweep 3s ease-in-out infinite;
  pointer-events: none;
}

@keyframes sweep {
  0%   { left: -100%; }
  50%  { left: 100%; }
  100% { left: 100%; }
}

.loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 242, 255, 0.2);
  border-top-color: var(--cyan);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.sim-btn.loading {
  opacity: 0.8;
  cursor: wait;
  color: rgba(255, 255, 255, 0.8);
}

/* QoS 总览卡片 */
.combined-qos-card {
  padding: 12px;
  flex-shrink: 0;
}

.combined-qos-content {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
}

/* 缩放版圆环 */
.ring-container.small-ring {
  width: 90px;
  height: 90px;
  margin: 0;
}

.health-ring {
  width: 100%;
  height: 100%;
}

.ring-value.small-val {
  font-family: var(--font-display);
  font-size: 24px;
  transform: translate(-50%, -60%);
}

.ring-label.small-label {
  font-family: var(--font-mono);
  font-size: 8px;
  transform: translate(-50%, 70%);
}

/* 密集核心指标排列 */
.metrics-grid.dense-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  row-gap: 8px;
  column-gap: 12px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 10px;
  color: var(--text-dim);
}

.stat-value {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 700;
}

.stat-value.green {
  color: #00ff88;
  text-shadow: 0 0 8px rgba(0, 255, 136, 0.4);
}

.metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-item.full-width {
  grid-column: 1 / -1;
}

.uav-list-card {
  padding: 14px;
  flex: 1;
  min-height: 160px;
  display: flex;
  flex-direction: column;
}

.uav-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}

/* 空状态提示 */
.uav-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 20px 0;
  opacity: 0.45;
}

.uav-empty-icon {
  font-size: 28px;
  filter: grayscale(0.5);
}

.uav-empty-text {
  font-size: 11px;
  color: var(--cyan);
  font-family: var(--font-mono);
  font-weight: 600;
}

.uav-empty-sub {
  font-size: 9px;
  color: var(--text-dim);
  text-align: center;
  line-height: 1.5;
  max-width: 160px;
}

/* ── 无人机遥测列表 ── */
.uav-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 2px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.02), transparent);
  border-left: 2px solid rgba(255, 255, 255, 0.1); /* 默认左侧弱边框 */
  transition: all var(--transition-fast);
  cursor: crosshair; /* 换成瞄准星光标 */
}

.uav-row:hover {
  background: linear-gradient(90deg, rgba(0, 242, 255, 0.12), transparent);
  border-left-color: var(--cyan);
  box-shadow: inset 0 0 12px rgba(0, 242, 255, 0.05);
  transform: translateX(4px); /* 悬浮时向右微移，增强互动感 */
}

.uav-row.conflict {
  background: linear-gradient(90deg, rgba(255, 59, 59, 0.15), transparent);
  border-left: 2px solid var(--red);
}

.uav-row.nlos {
  background: linear-gradient(90deg, rgba(250, 204, 21, 0.1), transparent);
  border-left: 2px solid var(--orange);
}

.uav-id {
  font-family: var(--font-mono);
  font-size: 10px;
  min-width: 44px;
}

.uav-ch-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: bold;
  min-width: 28px;
}

.uav-pos {
  min-width: 52px;
  text-align: right;
}

/* ★ UAV 列表坐标可读性提升 */
.pos-xy {
  font-family: var(--font-mono);
  font-size: 9px;
  color: #64748b;        /* ★ 从 #475569 提亮 */
  letter-spacing: -0.3px;
}

/* ★ 指标项增加底部分隔感 */
.metrics-grid.dense-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  row-gap: 12px;          /* ★ 从 8px 增大 */
  column-gap: 12px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03); /* ★ 新增 */
}

.sim-control-card {
  padding: 14px;
  flex-shrink: 0;
  border-top: 2px solid var(--cyan);
  box-shadow: 0 -4px 20px rgba(0, 242, 255, 0.05);
}

.uav-health-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
  overflow: hidden;
  margin: 0 4px;
}

.health-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease, background-color 0.3s;
  box-shadow: 0 0 6px currentColor;
}

.uav-rate-status {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 68px;
  justify-content: flex-end;
}

.pdr-val {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: bold;
}

.delay-val {
  font-family: var(--font-mono);
  font-size: 10px;
  color: #64748b;
}

.delay-val small {
  font-size: 8px;
  opacity: 0.6;
}

.config-link {
  display: inline-block;
  color: var(--cyan);
  margin-left: 6px;
  cursor: pointer;
  opacity: 0.7;
  font-size: 0.9em;
  text-decoration: none;
  transition: all 0.2s;
}
.config-link:hover {
  opacity: 1;
  text-shadow: 0 0 5px var(--cyan);
  transform: rotate(30deg);
}

/* ── 合作模式配置分区标签 ── */
.form-section-label {
  font-size: 10px;
  color: var(--cyan);
  letter-spacing: 1px;
  margin-top: 10px;
  padding: 4px 0 2px;
  border-top: 1px solid rgba(0, 242, 255, 0.1);
  font-family: var(--font-mono);
  font-weight: 600;
  text-transform: uppercase;
}

/* ── 动作开关网格 ── */
.action-toggles {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px 8px;
}

.toggle-item {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 10px;
  color: var(--text-secondary);
  transition: color 0.2s;
}

.toggle-item:hover {
  color: var(--cyan);
}

.toggle-item input[type="checkbox"] {
  width: 12px;
  height: 12px;
  accent-color: var(--cyan);
  cursor: pointer;
}

</style>
