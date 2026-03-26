<script setup lang="ts">
import { inject, computed, ref, reactive, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import gsap from 'gsap'
import { useAppMode } from '../composables/useAppMode'
import { useWorkspaceStore } from '../composables/workspaceStore'

const { currentAppMode } = useAppMode()
const { workspaceData, runMeta } = useWorkspaceStore()

// ── 合作模式数据 ──
const coopDashboard = computed(() => workspaceData.cooperative?.dashboard_snapshot)
const coopMetrics = computed(() => workspaceData.cooperative?.metrics_timeseries?.samples || [])
const coopFailureEvents = computed(() => workspaceData.cooperative?.failure_timeline?.events || [])
const coopRecoveryActions = computed(() => workspaceData.cooperative?.recovery_timeline?.actions || [])

// ── 非合作模式数据 ──
const ncObservedEvents = computed(() => workspaceData.nonCooperative?.observation_inference?.observed_signal_events || [])
const ncInferredEdges = computed(() => workspaceData.nonCooperative?.observation_inference?.inferred_topology_edges || [])
const ncKeyNodes = computed(() => workspaceData.nonCooperative?.observation_inference?.key_node_candidates || [])
const ncLinkEvidence = computed(() => workspaceData.nonCooperative?.observation_inference?.observed_link_evidence || [])

// ── 非合作打击闭环数据 ──
const ncAttackRecommendations = computed(() => workspaceData.nonCooperative?.attack?.recommendations || [])
const ncAttackPlan = computed(() => workspaceData.nonCooperative?.attack?.plan)
const ncAttackEvents = computed(() => workspaceData.nonCooperative?.attack?.events || [])
const ncAttackEffectMetrics = computed(() => workspaceData.nonCooperative?.attack?.effect_metrics || [])
const ncAttackSummary = computed(() => workspaceData.nonCooperative?.attack?.summary)
const hasAttackResults = computed(() => !!(ncAttackPlan.value || ncAttackEvents.value.length > 0 || ncAttackEffectMetrics.value.length > 0))
const ncInferChartData = computed(() => {
  return ncKeyNodes.value
    .slice(0, 5)
    .map((item, index) => ({
      label: `Node ${item.nodeId ?? index + 1}`,
      value: Number(((item.score ?? 0) * 100).toFixed(2))
    }))
})
const ncAttackEffectSeries = computed(() => {
  return ncAttackEffectMetrics.value
    .map(item => ({
      time: Number(item.time),
      connectivity: Number(((item.connectivityRatio ?? 0) * 100).toFixed(2))
    }))
    .filter(item => Number.isFinite(item.time) && Number.isFinite(item.connectivity))
    .sort((a, b) => a.time - b.time)
})

/** 格式化 null 安全的时间值，避免将 null 显示为 0 */
function fmtTime(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return v.toFixed(2) + 's'
}

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)
const qos = computed(() => frame.value?.QoS || { total_pdr: 0, throughput_mbps: 0, p99_latency_ms: 0 })
const topo = computed(() => frame.value?.topology || { num_links: 0, connectivity: 0 })

const pdrHistory = ref<number[]>([])
const tpHistory = ref<number[]>([])
const tickLabels = ref<number[]>([])
const MAX_HISTORY = 60

// 拓扑动画状态
const display = reactive({
  links: 0,
  connectivity: 0
})
const _tweenTopo = { links: 0, connectivity: 0 }

watch(topo, (n) => {
  if (!n) return
  gsap.to(_tweenTopo, {
    links: n.num_links || 0,
    connectivity: (n.connectivity || 0) * 100,
    duration: 0.3,
    ease: 'power2.out',
    onUpdate() {
      display.links = _tweenTopo.links
      display.connectivity = _tweenTopo.connectivity
    },
    onComplete() {
      display.links = _tweenTopo.links
      display.connectivity = _tweenTopo.connectivity
    }
  })
}, { deep: true, immediate: true })

const links = computed(() => Math.round(display.links))
const connectivity = computed(() => display.connectivity.toFixed(1))

const connectivityColor = computed(() => {
  const c = display.connectivity
  if (c >= 80) return '#00ff88'
  if (c >= 50) return '#facc15'
  return '#ff3b3b'
})

const connectivityMsg = computed(() => {
  const c = display.connectivity
  if (c >= 85) return 'MESH STABLE / 强网'
  if (c >= 50) return 'FRAGMENTING / 重连中'
  return 'LINK DROPPED / 孤岛'
})

const maxLinks = computed(() => (frame.value?.uav_nodes?.length || 15) * 2.5)

// 检测播放器循环回起点，清空积累的历史，避免短数据集的人为锯齿
const _currentTick = computed(() => engine?.currentTick?.value ?? 0)
watch(_currentTick, (newTick, oldTick) => {
  if (oldTick !== undefined && (oldTick as number) > 3 && newTick <= 1) {
    pdrHistory.value = []
    tpHistory.value = []
    tickLabels.value = []
  }
})

const pdrChartEl = ref<HTMLDivElement | null>(null)
const tpChartEl = ref<HTMLDivElement | null>(null)
const delayChartEl = ref<HTMLDivElement | null>(null)

// 非合作图表引用
const inferConfChartEl = ref<HTMLDivElement | null>(null)
const attackEffectChartEl = ref<HTMLDivElement | null>(null)

let pdrChart: echarts.ECharts | null = null
let tpChart: echarts.ECharts | null = null
let delayChart: echarts.ECharts | null = null

let inferConfChart: echarts.ECharts | null = null
let attackEffectChart: echarts.ECharts | null = null

const _tweenDelay = { value: 0 }

watch(() => qos.value.p99_latency_ms, (raw) => {
  gsap.to(_tweenDelay, {
    value: raw || 0,
    duration: 0.3,
    ease: 'power2.out',
    onUpdate() {
      updateDelayGauge(Math.max(0, _tweenDelay.value))
    },
    onComplete() {
      updateDelayGauge(Math.max(0, _tweenDelay.value))
    }
  })
}, { immediate: true })

const channelCounts = computed(() => {
  if (!frame.value) return [0, 0, 0]
  const counts = [0, 0, 0]
  for (const uav of frame.value.uav_nodes) {
    if (uav.channel >= 0 && uav.channel < 3) counts[uav.channel]++
  }
  return counts
})

const qAvail = computed(() => (qos.value.total_pdr * 100).toFixed(1))
const qP99 = computed(() => qos.value.p99_latency_ms.toFixed(1))
const qEE = computed(() => {
  if (!frame.value) return '0.0'
  const pwrs = frame.value.uav_nodes
    .filter((u: any) => u.node_type !== 1)  // 排除黑飞节点
    .map((u: any) => u.power !== undefined && u.power !== null ? u.power : 20)
  if (pwrs.length === 0) return '0.0'
  return (pwrs.reduce((a: number, b: number) => a + b, 0) / pwrs.length).toFixed(1)
})

// ★ 图表option函数增加辅助线透明度，使图表在暗色下更易读
function makeLineOption(title: string, color: string, data: number[], labels: number[], unit: string = '', yRange?: [number, number]): echarts.EChartsOption {
  return {
    grid: { top: 30, right: 15, bottom: 20, left: 48 },
    title: {
      text: title,
      textStyle: {
        color: '#94a3b8',
        fontFamily: 'JetBrains Mono, Noto Sans SC, monospace',
        fontSize: 10,          // ★ 微大以增强可读性
        fontWeight: 'normal'
      },
      left: 4, top: 4
    },
    tooltip: {                  // ★ 新增: 悬浮提示
      trigger: 'axis',
      backgroundColor: 'rgba(8, 12, 32, 0.9)',
      borderColor: 'rgba(0, 242, 255, 0.2)',
      textStyle: {
        color: '#e2e8f0',
        fontFamily: 'JetBrains Mono, Noto Sans SC, monospace',
        fontSize: 11
      },
      axisPointer: {
        lineStyle: { color: 'rgba(0, 242, 255, 0.3)' }
      }
    },
    xAxis: {
      type: 'category', data: labels,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisLabel: { show: false }, axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      min: yRange ? yRange[0] : undefined,
      max: yRange ? yRange[1] : undefined,
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      axisLabel: {
        color: '#64748b',
        fontSize: 9,
        fontFamily: 'JetBrains Mono, Noto Sans SC, monospace',
        formatter: (val: number) => `${val}${unit}`
      }
    },
    series: [{
      type: 'line', data, smooth: 0.4, symbol: 'none',  // ★ 定量平滑度
      lineStyle: {
        color,
        width: 2,
        shadowColor: color,
        shadowBlur: 12
      },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: color + '40' },   // ★ 面积渐变更柔和
          { offset: 0.6, color: color + '10' },
          { offset: 1, color: color + '02' }
        ])
      }
    }],
    animation: false
  }
}

function getDelayColor(v: number): string {
  if (v <= 200) return '#00ff88'    // 优秀
  if (v <= 500) return '#00f2ff'    // 正常
  if (v <= 1000) return '#facc15'   // 警告
  return '#ff3b3b'                  // 危险
}

function makeGaugeInitOption(): echarts.EChartsOption {
  const initColor = '#00f2ff'
  return {
    backgroundColor: 'transparent',
    animation: false,
    series: [
      {
        type: 'gauge', center: ['50%', '55%'], radius: '95%',
        startAngle: 220, endAngle: -40, min: 0, max: 2000,
        axisLine: { lineStyle: { width: 1, color: [[1, 'rgba(0,242,255,0.15)']] } },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: false }, pointer: { show: false }, detail: { show: false }
      },
      {
        type: 'gauge', center: ['50%', '55%'], radius: '88%',
        startAngle: 220, endAngle: -40, min: 0, max: 2000,
        axisLine: {
          lineStyle: {
            width: 14,
            color: [[0.10, '#00ff88'], [0.25, '#00f2ff'], [0.50, '#facc15'], [1, '#ff3b3b']],
            shadowColor: 'rgba(0,242,255,0.3)', shadowBlur: 16
          }
        },
        axisTick: { distance: -20, length: 6, lineStyle: { color: 'rgba(255,255,255,0.2)', width: 1 } },
        splitLine: { distance: -24, length: 12, lineStyle: { color: 'rgba(255,255,255,0.4)', width: 2, shadowColor: 'rgba(0,242,255,0.5)', shadowBlur: 6 } },
        axisLabel: { distance: -32, color: '#64748b', fontSize: 8, fontFamily: 'JetBrains Mono, Noto Sans SC, monospace', formatter: (v: number) => v % 500 === 0 ? v + '' : '' },
        pointer: { show: false }, detail: { show: false }
      },
      {
        type: 'gauge', center: ['50%', '55%'], radius: '72%',
        startAngle: 220, endAngle: -40, min: 0, max: 2000,
        axisLine: { lineStyle: { width: 4, color: [[1, 'rgba(255,255,255,0.03)']] } },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: false }, pointer: { show: false }, detail: { show: false },
        progress: {
          show: true, width: 4, roundCap: true,
          itemStyle: { color: initColor, shadowColor: initColor, shadowBlur: 12 }
        },
        data: [{ value: 0 }]
      },
      {
        type: 'gauge', center: ['50%', '55%'], radius: '80%',
        startAngle: 220, endAngle: -40, min: 0, max: 2000,
        itemStyle: { color: initColor, shadowColor: initColor, shadowBlur: 16 },
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: false }, axisLabel: { show: false },
        pointer: {
          icon: 'path://M-0.5,-80 L0.5,-80 L0.5,0 C0.5,0.28,-0.5,0.28,-0.5,0 Z',
          width: 3, length: '65%', offsetCenter: [0, 0],
          itemStyle: { color: initColor, shadowColor: initColor, shadowBlur: 10 }
        },
        anchor: {
          show: true, showAbove: true, size: 12,
          itemStyle: { borderWidth: 2, borderColor: initColor, color: '#0f172a', shadowColor: initColor, shadowBlur: 14 }
        },
        title: { show: true, offsetCenter: [0, '38%'], fontSize: 8, color: '#475569', fontFamily: 'JetBrains Mono, Noto Sans SC, monospace', fontWeight: 'normal' },
        detail: {
          valueAnimation: false,
          fontSize: 14, fontWeight: 'bold',
          fontFamily: "'JetBrains Mono','Noto Sans SC',monospace",
          offsetCenter: [0, '68%'],
          formatter: (v: number) => '{val|' + v.toFixed(1) + '}{unit| ms}',
          rich: {
            val: { fontSize: 14, fontWeight: 'bold', fontFamily: 'JetBrains Mono, Noto Sans SC, monospace', color: initColor, textShadowColor: initColor, textShadowBlur: 14, padding: [0, 2, 0, 0] },
            unit: { fontSize: 9, color: '#64748b', fontFamily: 'JetBrains Mono, Noto Sans SC, monospace', padding: [6, 0, 0, 2] }
          }
        },
        data: [{ value: 0, name: '' }]
      },
      {
        type: 'gauge', center: ['50%', '55%'], radius: '30%',
        startAngle: 0, endAngle: 360, min: 0, max: 1,
        axisLine: { lineStyle: { width: 1, color: [[1, 'rgba(0,242,255,0.08)']] } },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: false }, pointer: { show: false }, detail: { show: false }
      }
    ]
  }
}

function updateDelayGauge(value: number) {
  if (!delayChart) return
  const c = getDelayColor(value)
  delayChart.setOption({
    series: [
      {},
      {},
      {
        progress: { itemStyle: { color: c, shadowColor: c } },
        data: [{ value }]
      },
      {
        itemStyle: { color: c, shadowColor: c },
        pointer: { itemStyle: { color: c, shadowColor: c } },
        anchor: { itemStyle: { borderColor: c, shadowColor: c } },
        detail: { rich: { val: { color: c, textShadowColor: c } } },
        data: [{ value, name: '' }]
      },
      {}
    ]
  })
}

// 非合作模式的简单条形图 mock 渲染
function makeBarOption(title: string, color: string, categories: string[], data: number[]): echarts.EChartsOption {
  return {
    grid: { top: 30, right: 15, bottom: 20, left: 40 },
    title: {
      text: title,
      textStyle: { color: '#94a3b8', fontSize: 10, fontFamily: 'monospace', fontWeight: 'normal' },
      left: 4, top: 4
    },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(8, 12, 32, 0.9)', borderColor: color, textStyle: { color: '#e2e8f0', fontSize: 11 } },
    xAxis: { type: 'category', data: categories, axisLabel: { color: '#64748b', fontSize: 9 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } }, axisLabel: { color: '#64748b', fontSize: 9 } },
    series: [{
      type: 'bar', data: data, barWidth: '40%',
      itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: color },
          { offset: 1, color: color + '40' }
        ]),
        borderRadius: [2, 2, 0, 0]
      }
    }]
  }
}

function updateCharts() {
  if (!frame.value) {
    pdrHistory.value = []
    tpHistory.value = []
    tickLabels.value = []
    if (pdrChart) pdrChart.setOption(makeLineOption('PDR脉搏线 (%)', '#00f2ff', [], []))
    if (tpChart) tpChart.setOption(makeLineOption('吞吐量波浪 (Mbps)', '#a855f7', [], []))
    updateDelayGauge(0)
    return
  }

  pdrHistory.value.push(qos.value.total_pdr * 100)
  tpHistory.value.push(qos.value.throughput_mbps)
  tickLabels.value.push(frame.value.tick)
  if (pdrHistory.value.length > MAX_HISTORY) {
    pdrHistory.value.shift()
    tpHistory.value.shift()
    tickLabels.value.shift()
  }

  if (currentAppMode.value === 'cooperative') {
    if (pdrChart) pdrChart.setOption(makeLineOption('PDR脉搏线 (%)', '#00f2ff', pdrHistory.value, tickLabels.value, '%', [0, 100]))
    if (tpChart) tpChart.setOption(makeLineOption('吞吐量波浪 (Mbps)', '#a855f7', tpHistory.value, tickLabels.value, 'M'))
  } else {
    if (inferConfChart) {
      inferConfChart.setOption(
        makeBarOption(
          '推断核心节点可信度 (%)',
          '#facc15',
          ncInferChartData.value.map(item => item.label),
          ncInferChartData.value.map(item => item.value)
        )
      )
    }
    if (attackEffectChart) {
      attackEffectChart.setOption(
        makeLineOption(
          '打击效能评估 (连通率)',
          '#ff3b3b',
          ncAttackEffectSeries.value.map(item => item.connectivity),
          ncAttackEffectSeries.value.map(item => item.time),
          '%',
          [0, 100]
        )
      )
    }
  }
}

function initCharts() {
  if (pdrChartEl.value) pdrChart = echarts.init(pdrChartEl.value)
  if (tpChartEl.value) tpChart = echarts.init(tpChartEl.value)
  if (delayChartEl.value) {
    delayChart = echarts.init(delayChartEl.value)
    delayChart.setOption(makeGaugeInitOption())
  }
  if (inferConfChartEl.value) inferConfChart = echarts.init(inferConfChartEl.value)
  if (attackEffectChartEl.value) attackEffectChart = echarts.init(attackEffectChartEl.value)
}

let resizeOb: ResizeObserver | null = null
const panelRef = ref<HTMLElement | null>(null)

onMounted(async () => {
  await nextTick()
  setTimeout(() => {
    initCharts()
    updateCharts()
    resizeOb = new ResizeObserver(() => {
      pdrChart?.resize()
      tpChart?.resize()
      delayChart?.resize()
      inferConfChart?.resize()
      attackEffectChart?.resize()
    })
    if (panelRef.value) resizeOb.observe(panelRef.value)
  }, 200)
})

onBeforeUnmount(() => {
  pdrChart?.dispose()
  tpChart?.dispose()
  delayChart?.dispose()
  inferConfChart?.dispose()
  attackEffectChart?.dispose()
  resizeOb?.disconnect()
})

watch(frame, updateCharts, { deep: true })
watch([ncKeyNodes, ncAttackEffectMetrics, currentAppMode], updateCharts, { deep: true })
</script>

<template>
  <aside ref="panelRef" class="right-panel">
    
    <!-- 合作模式专属分析 -->
    <template v-if="currentAppMode === 'cooperative'">
      <!-- PDR 折线图 -->
      <div class="glass-panel chart-card">
        <div ref="pdrChartEl" id="pdr-lines" class="echart-box"></div>
      </div>

      <!-- 吞吐量折线图 -->
      <div class="glass-panel chart-card">
        <div ref="tpChartEl" id="tp-lines" class="echart-box"></div>
      </div>

      <!-- 延时仪表盘 -->
      <div class="glass-panel chart-card delay-gauge-card">
        <div class="gauge-status-bar">
          <span class="status-dot" :class="{
            'dot-green': qos.p99_latency_ms <= 200,
            'dot-cyan': qos.p99_latency_ms > 200 && qos.p99_latency_ms <= 500,
            'dot-yellow': qos.p99_latency_ms > 500 && qos.p99_latency_ms <= 1000,
            'dot-red': qos.p99_latency_ms > 1000
          }"></span>
          <span class="gauge-label">P99 延迟监测</span>
          <span class="gauge-zone" :class="{
            'zone-safe': qos.p99_latency_ms <= 200,
            'zone-normal': qos.p99_latency_ms > 200 && qos.p99_latency_ms <= 500,
            'zone-warn': qos.p99_latency_ms > 500 && qos.p99_latency_ms <= 1000,
            'zone-crit': qos.p99_latency_ms > 1000
          }">
            {{ qos.p99_latency_ms <= 200 ? '安全' : qos.p99_latency_ms <= 500 ? '正常' : qos.p99_latency_ms <= 1000 ? '预警' : '危急' }}
          </span>
        </div>
        <div ref="delayChartEl" id="delay-gauge" class="echart-box gauge-box"></div>
      </div>
      <!-- ★ 合作模式恢复总览卡片 -->
      <div v-if="coopDashboard" class="glass-panel chart-card">
        <div class="section-title">恢复总览</div>
        <div class="coop-dashboard">
          <div class="dash-row">
            <span class="dash-label">恢复状态</span>
            <span class="dash-value" :class="coopDashboard.recoveryStatus === 'recovered' ? 'val-green' : 'val-yellow'">{{ coopDashboard.recoveryStatus || '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">当前阶段</span>
            <span class="dash-value">{{ coopDashboard.phase || '—' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">响应时间</span>
            <span class="dash-value">{{ coopDashboard.responseTimeSec?.toFixed(2) || '—' }} s</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">恢复时间</span>
            <span class="dash-value">{{ coopDashboard.recoveryTimeSec?.toFixed(2) || '—' }} s</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">稳定时间</span>
            <span class="dash-value">{{ coopDashboard.stabilizationTimeSec?.toFixed(2) || '—' }} s</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">领队存活</span>
            <span class="dash-value" :class="coopDashboard.isLeaderAlive ? 'val-green' : 'val-red'">{{ coopDashboard.isLeaderAlive ? '是' : '否' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">故障活跃</span>
            <span class="dash-value" :class="coopDashboard.failureActive ? 'val-red' : 'val-green'">{{ coopDashboard.failureActive ? '是' : '否' }}</span>
          </div>
          <div class="dash-row">
            <span class="dash-label">最新动作</span>
            <span class="dash-value">{{ coopDashboard.latestActionType || '—' }}</span>
          </div>
        </div>
      </div>

      <!-- ★ 故障/恢复事件时间线 -->
      <div v-if="coopFailureEvents.length > 0 || coopRecoveryActions.length > 0" class="glass-panel chart-card">
        <div class="section-title">事件时间线</div>
        <div class="event-timeline">
          <div v-for="(evt, i) in coopFailureEvents.slice(0, 5)" :key="'f'+i" class="timeline-item failure-item">
            <span class="tl-time">{{ evt.time?.toFixed(1) }}s</span>
            <span class="tl-dot red-dot"></span>
            <span class="tl-text">故障: {{ evt.failureType }} → Node {{ evt.targetNodeId }}</span>
          </div>
          <div v-for="(act, i) in coopRecoveryActions.slice(0, 8)" :key="'r'+i" class="timeline-item recovery-item">
            <span class="tl-time">{{ act.time?.toFixed(1) }}s</span>
            <span class="tl-dot green-dot"></span>
            <span class="tl-text">{{ act.actionType }}: {{ act.oldValue }} → {{ act.newValue }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 非合作模式专属分析 -->
    <template v-else>
      <div class="glass-panel chart-card infer-obs-card">
        <div class="section-title">观测质量评测</div>
        <div class="obs-metrics" style="display:flex; justify-content:space-around; padding: 10px 0;">
          <div style="text-align:center;">
             <div style="color:#00f2ff; font-size:18px; font-weight:bold;">{{ ncObservedEvents.length || '—' }}</div>
             <div style="font-size:10px; color:#64748b;">观测事件数</div>
          </div>
          <div style="text-align:center;">
             <div style="color:#facc15; font-size:18px; font-weight:bold;">{{ ncLinkEvidence.length || '—' }}</div>
             <div style="font-size:10px; color:#64748b;">边证据数</div>
          </div>
          <div style="text-align:center;">
             <div style="color:#a855f7; font-size:18px; font-weight:bold;">{{ ncInferredEdges.length || '—' }}</div>
             <div style="font-size:10px; color:#64748b;">推断边数</div>
          </div>
        </div>
      </div>

      <!-- ★ 关键节点候选列表 -->
      <div v-if="ncKeyNodes.length > 0" class="glass-panel chart-card">
        <div class="section-title">关键节点识别 (Top-{{ Math.min(ncKeyNodes.length, 10) }})</div>
        <div class="key-nodes-list">
          <div v-for="(kn, i) in ncKeyNodes.slice(0, 10)" :key="kn.nodeId" class="kn-row" :style="{ borderLeftColor: i < 3 ? '#ff3b3b' : i < 6 ? '#facc15' : '#00f2ff' }">
            <span class="kn-rank">#{{ kn.rank ?? (i+1) }}</span>
            <span class="kn-id">Node {{ kn.nodeId }}</span>
            <span class="kn-score" :style="{ color: i < 3 ? '#ff3b3b' : '#00f2ff' }">{{ (kn.score * 100).toFixed(1) }}%</span>
          </div>
        </div>
      </div>

      <!-- 推断可信度图 -->
      <div class="glass-panel chart-card">
        <div ref="inferConfChartEl" id="infer-conf-chart" class="echart-box"></div>
      </div>

      <!-- 打击效能评估图 -->
      <div class="glass-panel chart-card">
        <div ref="attackEffectChartEl" id="attack-effect-chart" class="echart-box"></div>
      </div>

      <!-- ★ 打击闭环结果区域 -->
      <template v-if="hasAttackResults">
        <!-- 推荐打击目标 -->
        <div v-if="ncAttackRecommendations.length > 0" class="glass-panel chart-card">
          <div class="section-title" style="color:#ff6b6b;">推荐打击目标</div>
          <div class="key-nodes-list">
            <div v-for="(rec, i) in ncAttackRecommendations.slice(0, 5)" :key="i" class="kn-row" :style="{ borderLeftColor: i === 0 ? '#ff3b3b' : '#facc15' }">
              <span class="kn-rank">#{{ rec.recommendationRank ?? (i+1) }}</span>
              <span class="kn-id">ObsNode {{ rec.recommendedObservedNodeId }}</span>
              <span class="kn-score" :style="{ color: i === 0 ? '#ff3b3b' : '#facc15' }">{{ (rec.recommendedScore * 100).toFixed(1) }}%</span>
            </div>
          </div>
        </div>

        <!-- 打击计划摘要 -->
        <div v-if="ncAttackPlan" class="glass-panel chart-card">
          <div class="section-title" style="color:#ff6b6b;">打击计划摘要</div>
          <div class="coop-dashboard">
            <div class="dash-row">
              <span class="dash-label">推荐目标</span>
              <span class="dash-value">Node {{ ncAttackPlan.recommendedObservedNodeId }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">确认目标</span>
              <span class="dash-value">Node {{ ncAttackPlan.confirmedObservedNodeId }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">绑定状态</span>
              <span class="dash-value" :class="ncAttackPlan.targetBindingStatus === 'confirmed' ? 'val-green' : 'val-yellow'">{{ ncAttackPlan.targetBindingStatus || '—' }}</span>
            </div>
            <div class="dash-row">
              <span class="dash-label">打击时间</span>
              <span class="dash-value">{{ fmtTime(ncAttackPlan.attackExecuteTime) }}</span>
            </div>
            <div v-if="ncAttackPlan.executedEntityNodeId != null" class="dash-row">
              <span class="dash-label">实际命中实体</span>
              <span class="dash-value" style="color:#ff3b3b;">Entity {{ ncAttackPlan.executedEntityNodeId }}</span>
            </div>
            <div v-if="ncAttackPlan.targetNeighborhoodSize != null" class="dash-row">
              <span class="dash-label">邻域规模</span>
              <span class="dash-value">{{ ncAttackPlan.targetNeighborhoodSize }} 节点</span>
            </div>
          </div>
        </div>

        <!-- 打击事件时间线 -->
        <div v-if="ncAttackEvents.length > 0" class="glass-panel chart-card">
          <div class="section-title" style="color:#ff6b6b;">打击事件时间线</div>
          <div class="event-timeline">
            <div v-for="(evt, i) in ncAttackEvents.slice(0, 8)" :key="i" class="timeline-item failure-item">
              <span class="tl-time">{{ evt.eventTime?.toFixed(1) }}s</span>
              <span class="tl-dot" :class="evt.isTrueTargetHit ? 'green-dot' : 'red-dot'"></span>
              <span class="tl-text">
                {{ evt.attackType }} → ObsNode {{ evt.executedObservedNodeId }}
                <span v-if="evt.isTrueTargetHit" style="color:#00ff88;"> ✓ 命中</span>
                <span v-else style="color:#ff3b3b;"> ✗ {{ evt.targetMismatchType || '未命中' }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- 打击前后对比摘要 -->
        <div v-if="ncAttackSummary" class="glass-panel chart-card">
          <div class="section-title" style="color:#ff6b6b;">打击效果评估</div>
          <div class="coop-dashboard">
            <template v-if="ncAttackSummary.finalMetrics">
              <div class="dash-row">
                <span class="dash-label">最终连通率</span>
                <span class="dash-value">{{ ((ncAttackSummary.finalMetrics.connectivityRatio ?? 0) * 100).toFixed(1) }}%</span>
              </div>
              <div class="dash-row">
                <span class="dash-label">最终 PDR</span>
                <span class="dash-value">{{ ((ncAttackSummary.finalMetrics.pdr ?? 0) * 100).toFixed(1) }}%</span>
              </div>
              <div class="dash-row">
                <span class="dash-label">最终吞吐</span>
                <span class="dash-value">{{ (ncAttackSummary.finalMetrics.throughputMbps ?? 0).toFixed(2) }} Mbps</span>
              </div>
            </template>
            <template v-if="ncAttackSummary.recoverySummary">
              <div class="dash-row">
                <span class="dash-label">恢复进度</span>
                <span class="dash-value" :class="(ncAttackSummary.recoverySummary.recoveryProgress ?? 0) >= 0.8 ? 'val-green' : 'val-yellow'">{{ ((ncAttackSummary.recoverySummary.recoveryProgress ?? 0) * 100).toFixed(0) }}%</span>
              </div>
              <div class="dash-row">
                <span class="dash-label">损伤持续</span>
                <span class="dash-value">{{ fmtTime(ncAttackSummary.recoverySummary.damageDuration) }}</span>
              </div>
            </template>
          </div>
        </div>
      </template>
    </template>

    <!-- 拓扑演化矩阵 (Topology Evolution Core) - 共享组件 -->
    <div class="glass-panel topo-card">
      <div class="section-title topo-title">
        {{ currentAppMode === 'cooperative' ? '组网拓扑矩阵' : '推断拓扑受损矩阵' }}
        <span class="topo-pulse" :style="{ backgroundColor: connectivityColor }"></span>
      </div>
      <div class="topo-content">
        <!-- 连通率核心环 -->
        <div class="topo-core">
          <svg viewBox="0 0 100 100" class="core-ring">
            <!-- 外部旋转圈 -->
            <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(0,242,255,0.15)" stroke-width="2" stroke-dasharray="10 4" class="spin-slow" />
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="6" />
            <!-- 数据圆环 (周长 251.2) -->
            <circle cx="50" cy="50" r="40" fill="none"
              :stroke="connectivityColor"
              stroke-width="6"
              stroke-linecap="round"
              :stroke-dasharray="`${display.connectivity * 2.512} 251.2`"
              transform="rotate(135 50 50)"
              :style="{ filter: `drop-shadow(0 0 6px ${connectivityColor})`, transition: 'all 0.5s ease' }" />
          </svg>
          <div class="core-val" :style="{ color: connectivityColor }">
            {{ connectivity }}<span class="pct">%</span>
          </div>
        </div>

        <!-- 幸存链路能级 -->
        <div class="topo-stats">
          <div class="stat-row">
            <span class="label">活跃链路存活</span>
            <span class="val" :style="{ color: connectivityColor, textShadow: `0 0 8px ${connectivityColor}` }">{{ links }} <span class="sub">链路</span></span>
          </div>
          <!-- 光剑式动态跳动能量条 -->
          <div class="link-power-bar-wrapper">
            <div class="power-bar-bg">
              <div class="power-fill" :style="{ width: `${Math.min(100, (display.links / maxLinks) * 100)}%`, background: connectivityColor, boxShadow: `0 0 12px ${connectivityColor}` }"></div>
            </div>
            <!-- 网格装饰 -->
            <div class="power-grid-overlay"></div>
          </div>
          <div class="status-msg" :style="{ color: connectivityColor }">{{ connectivityMsg }}</div>
        </div>
      </div>
    </div>

  </aside>
</template>

<style scoped>
.right-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  overflow-y: auto;
  padding-left: 4px;
}

/* 拓扑演化核心组件样式 */
.topo-card {
  padding: 14px;
  flex-shrink: 0;
  border-left: 2px solid var(--cyan);          /* ★ 始终显示 */
  transition: border-color 0.5s ease;
}

.topo-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.topo-pulse {
  width: 8px; height: 8px; border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
  animation: pulse-dot 1s infinite;
}

.topo-content {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
}

.topo-core {
  position: relative;
  width: 90px; height: 90px;
  display: flex; justify-content: center; align-items: center;
}

.core-ring {
  width: 100%; height: 100%;
  transform: rotate(-90deg);
}

.core-val {
  position: absolute;
  font-family: var(--font-display);
  font-weight: 700; font-size: 18px;
  text-shadow: 0 0 10px currentColor;
}
.core-val .pct { font-size: 10px; opacity: 0.8; }

.core-label {
  position: absolute; bottom: 18px;
  font-size: 7px; color: rgba(255,255,255,0.5);
  letter-spacing: 1px;
}

.topo-stats {
  flex: 1;
  display: flex; flex-direction: column; gap: 6px;
}

.stat-row {
  display: flex; justify-content: space-between; align-items: flex-end;
}
.stat-row .label { font-size: 10px; color: var(--text-dim); }
.stat-row .val { font-family: var(--font-mono); font-size: 16px; font-weight: bold; }
.stat-row .sub { font-size: 9px; opacity: 0.7; }

.link-power-bar-wrapper {
  position: relative;
  height: 6px; width: 100%;
  background: rgba(0,0,0,0.5);
  border-radius: 2px; overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
}

.power-fill {
  height: 100%;
  transition: width 0.3s ease-out, background-color 0.3s;
}

.power-grid-overlay {
  position: absolute; top:0; left:0; right:0; bottom:0;
  background-image: linear-gradient(90deg, transparent 50%, rgba(0,0,0,0.8) 50%);
  background-size: 4px 100%;
  opacity: 0.3;
}

.status-msg {
  font-size: 10px; text-align: right; margin-top: 2px;
  font-family: var(--font-mono);
}

.spin-slow {
  transform-origin: 50% 50%;
  animation: spin 20s linear infinite;       /* ★ 从 8s 减速到 20s */
}

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes pulse-dot { 0%, 100% { opacity: 0.5; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }

.chart-card {
  padding: 10px;
  flex-shrink: 0;
}

.chart-card:nth-child(1) {
  animation: ambient-glow 5s ease-in-out infinite alternate;
}

.chart-card:nth-child(2) {
  animation: ambient-glow 5s ease-in-out 1.5s infinite alternate;  /* ★ 延迟 */
}

.chart-card:nth-child(3) {
  animation: ambient-glow 5s ease-in-out 3s infinite alternate;    /* ★ 延迟 */
}

@keyframes ambient-glow {
  from {
    border-color: rgba(0, 242, 255, 0.06);
    box-shadow: 0 0 8px rgba(0, 242, 255, 0.02) inset;
  }
  to {
    border-color: rgba(0, 242, 255, 0.18);
    box-shadow: 0 0 16px rgba(0, 242, 255, 0.08) inset;
  }
}

.echart-box {
  width: 100%;
  height: 150px;
  min-height: 150px;
}

.gauge-box {
  height: 150px;
  min-height: 150px;
}

/* ── 仪表盘状态栏 ── */
.delay-gauge-card {
  position: relative;
  overflow: hidden;
}

.delay-gauge-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg,
    transparent,
    rgba(0, 242, 255, 0.6),
    transparent
  );
  animation: scan-line 3s ease-in-out infinite;
}

@keyframes scan-line {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.gauge-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;                          /* ★ 增大内边距 */
  background: rgba(0, 0, 0, 0.2);             /* ★ 新增底色 */
  border-radius: 4px 4px 0 0;
  font-family: var(--font-mono);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-green {
  background: #00ff88;
  box-shadow: 0 0 8px #00ff88, 0 0 16px #00ff8860;
  animation: pulse-dot 2s infinite;
}

.dot-cyan {
  background: #00f2ff;
  box-shadow: 0 0 8px #00f2ff, 0 0 16px #00f2ff60;
  animation: pulse-dot 2s infinite;
}

.dot-yellow {
  background: #facc15;
  box-shadow: 0 0 8px #facc15, 0 0 16px #facc1560;
  animation: pulse-dot 1.2s infinite;
}

.dot-red {
  background: #ff3b3b;
  box-shadow: 0 0 8px #ff3b3b, 0 0 16px #ff3b3b60;
  animation: pulse-dot 0.6s infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}

.gauge-label {
  font-size: 9px;
  color: #64748b;
  letter-spacing: 1.5px;
  flex: 1;
  font-weight: 500;                           /* ★ 加粗 */
}

.gauge-zone {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 1px;
  padding: 1px 6px;
  border-radius: 3px;
}

.zone-safe {
  color: #00ff88;
  background: rgba(0, 255, 136, 0.1);
  border: 1px solid rgba(0, 255, 136, 0.2);
}

.zone-normal {
  color: #00f2ff;
  background: rgba(0, 242, 255, 0.1);
  border: 1px solid rgba(0, 242, 255, 0.2);
}

.zone-warn {
  color: #facc15;
  background: rgba(250, 204, 21, 0.1);
  border: 1px solid rgba(250, 204, 21, 0.2);
  animation: blink-warn 1.5s infinite;
}

.zone-crit {
  color: #ff3b3b;
  background: rgba(255, 59, 59, 0.15);
  border: 1px solid rgba(255, 59, 59, 0.3);
  animation: blink-warn 0.8s infinite;
}

@keyframes blink-warn {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ── QoS 卡片 ── */
.qos-card {
  padding: 14px;
  flex-shrink: 0;
  border-top: 2px solid transparent;
  transition: border-color 0.5s ease;
}

.qos-card.qos-healthy {
  border-top-color: var(--green);
}

.qos-card.qos-warning {
  border-top-color: var(--orange);
}

.qos-card.qos-danger {
  border-top-color: var(--red);
  animation: pulse-danger 1.5s infinite;
}

.qos-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.qos-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: center;
}

.qos-item .stat-value {
  font-size: 16px;
}

/* ── 合作模式恢复总览 ── */
.coop-dashboard {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.dash-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 8px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.15);
  font-family: var(--font-mono);
}

.dash-label {
  font-size: 10px;
  color: var(--text-dim);
}

.dash-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.val-green { color: #00ff88; text-shadow: 0 0 6px rgba(0,255,136,0.3); }
.val-yellow { color: #facc15; }
.val-red { color: #ff3b3b; text-shadow: 0 0 6px rgba(255,59,59,0.3); }

/* ── 事件时间线 ── */
.event-timeline {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.timeline-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  font-size: 10px;
  font-family: var(--font-mono);
  border-radius: 2px;
}

.failure-item { background: rgba(255, 59, 59, 0.06); }
.recovery-item { background: rgba(0, 255, 136, 0.04); }

.tl-time {
  color: var(--text-dim);
  min-width: 40px;
  text-align: right;
}

.tl-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tl-text {
  color: var(--text-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 关键节点列表 ── */
.key-nodes-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
}

.kn-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-left: 3px solid #00f2ff;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 0 2px 2px 0;
  font-family: var(--font-mono);
  font-size: 11px;
}

.kn-rank {
  color: var(--text-dim);
  min-width: 24px;
}

.kn-id {
  color: var(--text-primary);
  flex: 1;
}

.kn-score {
  font-weight: 700;
}
</style>
