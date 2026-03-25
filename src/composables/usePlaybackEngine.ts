/**
 * 帧回放引擎 Playback Engine
 * 管理 tick 推进、播放控制、帧数据分发
 */
import { ref, computed, shallowRef, watch } from 'vue'
import { FrameData } from '../types'
import { activeScene, simulationStrategy } from './useScene'
import { sysLog } from '../composables/useSystemLog'
import { GEOMETRIC_CONFLICT_DISTANCE_M, resolveConflictState } from '../utils/conflict'

// ═══════════════════════════════════════════
//  核心状态
// ═══════════════════════════════════════════
const frames = shallowRef<FrameData[]>([])
const compareFrames = shallowRef<FrameData[]>([]) // 对比模式使用的第二组数据
const currentTick = ref(0)
const isPlaying = ref(false)
const playbackSpeed = ref(1)
const isSeeking = ref(false)           // 拖动滑块标记
const _animFrameId = ref(0)
let lastTime = 0
const tickInterval = 100               // ms per tick at 1x

// ═══════════════════════════════════════════
//  帧缓存
// ═══════════════════════════════════════════
const MAX_CACHE_SIZE = 500
const frameCache = new Map<number, FrameData>()
const compareFrameCache = new Map<number, FrameData>()

function clearFrameCache() {
  frameCache.clear()
  compareFrameCache.clear()
}

function setCacheEntry(cache: Map<number, FrameData>, tick: number, data: FrameData) {
  // 简易 LRU：超过上限时清除最早的一半
  if (cache.size >= MAX_CACHE_SIZE) {
    const keys = Array.from(cache.keys()).slice(0, MAX_CACHE_SIZE >> 1)
    for (let i = 0; i < keys.length; i++) {
        cache.delete(keys[i])
    }
  }
  cache.set(tick, data)
}

// 当帧数据、策略、建筑数量变化时清缓存
watch(
  [
    frames,
    compareFrames,
    simulationStrategy,
    () => activeScene.buildings.length,
  ],
  clearFrameCache
)

// ═══════════════════════════════════════════
//  建筑物预计算数据（避免每帧重复计算）
// ═══════════════════════════════════════════
interface BuildingPreCalc {
  cx: number
  cy: number
  r2: number
}

let _buildingCache: BuildingPreCalc[] = []
let _buildingCacheVer = -1

function getBuildingPreCalc(): BuildingPreCalc[] {
  const buildings = activeScene.buildings
  const ver = buildings.length // 简单版本号，建筑数量变化即刷新
  if (_buildingCacheVer === ver && _buildingCache.length === ver) {
    return _buildingCache
  }
  _buildingCache = buildings.map((b) => ({
    cx: b.x + b.width / 2,
    cy: b.y + b.depth / 2,
    r2: ((b.width + b.depth) / 2 + 15) ** 2,
  }))
  _buildingCacheVer = ver
  return _buildingCache
}

// ═══════════════════════════════════════════
//  applyDynamicSceneToFrame（优化版）
// ═══════════════════════════════════════════
function applyDynamicSceneToFrame(
  frame: FrameData,
  tickIndex?: number,
  targetCache: Map<number, FrameData> = frameCache
): FrameData {
  // 1. 缓存命中 → 直接返回
  if (tickIndex !== undefined && targetCache.has(tickIndex)) {
    return targetCache.get(tickIndex)!
  }

  const uavs = frame.uav_nodes
  const numUavs = uavs.length
  if (numUavs === 0) return frame

  // 2. 预计算建筑包围数据
  const buildData = getBuildingPreCalc()
  const buildLen = buildData.length

  // 3. 计算几何兜底冲突候选 —— 仅在没有后端物理/显式结果时使用
  const channelBuckets = new Map<number, number[]>()
  for (let i = 0; i < numUavs; i++) {
    const ch = uavs[i].channel
    let bucket = channelBuckets.get(ch)
    if (!bucket) {
      bucket = []
      channelBuckets.set(ch, bucket)
    }
    bucket.push(i)
  }

  const geometricConflictIds = new Set<number>()
  const conflictDistanceSq = GEOMETRIC_CONFLICT_DISTANCE_M * GEOMETRIC_CONFLICT_DISTANCE_M
  for (const indices of channelBuckets.values()) {
    const len = indices.length
    if (len < 2) continue
    for (let a = 0; a < len; a++) {
      const uavA = uavs[indices[a]]
      for (let b = a + 1; b < len; b++) {
        const uavB = uavs[indices[b]]
        const dx = uavA.x - uavB.x
        const dy = uavA.y - uavB.y
        const dz = (uavA.z || 30) - (uavB.z || 30)
        if (dx * dx + dy * dy + dz * dz < conflictDistanceSq) {
          geometricConflictIds.add(uavA.id)
          geometricConflictIds.add(uavB.id)
        }
      }
    }
  }

  // 4. 遍历 UAV，应用 NLOS / 冲突 patch
  const patchedUavs = new Array(numUavs)
  let totalPdr = 0
  let totalDelay = 0
  let totalTp = 0
  const isDynamic = simulationStrategy.value === 'dynamic'

  // 4a. 邻居计数：优先从 frame.links 解析，fallback 用近距离检测
  const neighborMap = new Map<number, number>()
  if ((frame as any).links && (frame as any).links.length > 0) {
    for (const link of (frame as any).links as string[]) {
      // 支持 "0-1" 和 "Node0-Node1" 两种格式
      const parts = link.split('-')
        .map((p: string) => p.replace(/\D/g, ''))
        .filter((p: string) => p.length > 0)
        .map(Number)
        .filter((n: number) => !isNaN(n))
      if (parts.length === 2) {
        neighborMap.set(parts[0], (neighborMap.get(parts[0]) || 0) + 1)
        neighborMap.set(parts[1], (neighborMap.get(parts[1]) || 0) + 1)
      }
    }
  } else {
    // Fallback：近距离邻居检测（CSV 模式无 links 时使用）
    const NEIGHBOR_RANGE_SQ = 150 * 150
    for (let a = 0; a < numUavs; a++) {
      for (let b = a + 1; b < numUavs; b++) {
        const uavA = uavs[a]
        const uavB = uavs[b]
        const dx = uavA.x - uavB.x
        const dy = uavA.y - uavB.y
        const dz = (uavA.z || 30) - (uavB.z || 30)
        if (dx * dx + dy * dy + dz * dz <= NEIGHBOR_RANGE_SQ) {
          neighborMap.set(uavA.id, (neighborMap.get(uavA.id) || 0) + 1)
          neighborMap.set(uavB.id, (neighborMap.get(uavB.id) || 0) + 1)
        }
      }
    }
  }

  for (let i = 0; i < numUavs; i++) {
    const uav = uavs[i]

    // 内联 NLOS 检测（用预算 r²，免 sqrt）
    let isNlos = false
    for (let bIdx = 0; bIdx < buildLen; bIdx++) {
      const bd = buildData[bIdx]
      const dx = uav.x - bd.cx
      const dy = uav.y - bd.cy
      if (dx * dx + dy * dy < bd.r2) {
        isNlos = true
        break
      }
    }

    const explicitConflict = uav.conflict_source === 'explicit' ? uav.is_conflict : undefined
    const { isConflict, source: conflictSource } = resolveConflictState({
      sinr: uav.sinr,
      interference: uav.interference,
      explicitConflict,
      sameChannelNearby: geometricConflictIds.has(uav.id),
    })
    const neighbors = neighborMap.get(uav.id) || 0

    // 确定指标值
    let pdr: number
    let delay: number
    let throughput: number
    const power = uav.power ?? 20

    // 优先使用后端下发的真实 QoS 数据；仅在后端无数据时才回退至电磁干扰/遮挡模型
    // 修复 Bug：这里曾使用 || 这个逻辑操作符，会导致 0（如黑飞机的 PDR=0）被误判为 false 从而强行套用默认值
    if (isConflict) {
      pdr = uav.pdr ?? (isDynamic ? 0.9 : 0.65)
      delay = uav.delay ?? (isDynamic ? 20 : 45)
      throughput = uav.throughput ?? (isDynamic ? 95 : 60)
    } else if (isNlos) {
      pdr = uav.pdr ?? 0.82
      delay = uav.delay ?? 25
      throughput = uav.throughput ?? 100
    } else {
      pdr = uav.pdr ?? 0.95
      delay = uav.delay ?? 15
      throughput = uav.throughput ?? 100
    }

    // 只在值确实变化时才创建新对象，否则直接复用原对象
    if (
      uav.is_nlos === isNlos &&
      uav.is_conflict === isConflict &&
      uav.conflict_source === conflictSource &&
      uav.pdr === pdr &&
      uav.delay === delay &&
      uav.throughput === throughput &&
      uav.neighbors === neighbors
    ) {
      patchedUavs[i] = uav // 零分配
    } else {
      patchedUavs[i] = {
        ...uav,
        is_nlos: isNlos,
        is_conflict: isConflict,
        conflict_source: conflictSource,
        pdr,
        delay,
        throughput,
        power,
        neighbors,
      }
    }

    // 黑飞靶机 (node_type === 1) 不应当计入全局通信指标的统计中
    if (uav.node_type !== 1) {
      totalPdr += pdr
      totalDelay += delay
      totalTp += throughput
    }
  }

  // 计算有效通信无人机数量（排除黑飞靶机）
  const validUavsCount = uavs.filter(u => u.node_type !== 1).length || 1
  const conflictCount = patchedUavs.filter((u: any) => u.is_conflict).length

  // 5. 构建结果帧
  const res: FrameData = {
    ...frame,
    uav_nodes: patchedUavs,
    conflicts: conflictCount,
    QoS: {
      ...frame.QoS,
      total_pdr: totalPdr / validUavsCount,
      p99_latency_ms: (totalDelay / validUavsCount) * 1.5,
      throughput_mbps: totalTp / validUavsCount,
    },
  }

  if (tickIndex !== undefined) {
    setCacheEntry(targetCache, tickIndex, res)
  }
  return res
}

// ═══════════════════════════════════════════
//  getHistory — 防抖缓存
// ═══════════════════════════════════════════
const historyCache = shallowRef<FrameData[]>([])
let _historyTimer: ReturnType<typeof setTimeout> | null = null
const HISTORY_DEBOUNCE_MS = 200
const DEFAULT_HISTORY_COUNT = 100

function _rebuildHistory(tickIdx: number, count: number) {
  const start = Math.max(0, tickIdx - count + 1)
  const hist: FrameData[] = []
  for (let i = start; i <= tickIdx; i++) {
    const f = frames.value[i]
    if (f) hist.push(applyDynamicSceneToFrame(f, i))
  }
  historyCache.value = hist
}

// 监听 currentTick 变化，防抖重算历史
watch(currentTick, (tick) => {
  // 拖动中完全跳过历史重算
  if (isSeeking.value) return

  if (_historyTimer) clearTimeout(_historyTimer)
  _historyTimer = setTimeout(() => {
    _rebuildHistory(tick, DEFAULT_HISTORY_COUNT)
    _historyTimer = null
  }, HISTORY_DEBOUNCE_MS)
})

// ═══════════════════════════════════════════
//  seek 节流
// ═══════════════════════════════════════════
let _seekRAF = 0
let _pendingTick = -1

/** 拖动滑块过程中调用 —— 每渲染帧最多更新一次 */
function seekThrottled(tickNum: number) {
  const clamped = Math.max(0, Math.min(tickNum, frames.value.length - 1))
  _pendingTick = clamped
  isSeeking.value = true

  if (!_seekRAF) {
    _seekRAF = requestAnimationFrame(() => {
      if (_pendingTick >= 0) {
        currentTick.value = _pendingTick
      }
      _seekRAF = 0
    })
  }
}

/** 滑块松手后调用 —— 精确定位 + 恢复完整计算 */
function seekEnd(tickNum: number) {
  const clamped = Math.max(0, Math.min(tickNum, frames.value.length - 1))

  // 取消可能还在排队的 RAF
  if (_seekRAF) {
    cancelAnimationFrame(_seekRAF)
    _seekRAF = 0
  }
  _pendingTick = -1

  currentTick.value = clamped
  isSeeking.value = false

  // 松手后立即重算一次历史
  _rebuildHistory(clamped, DEFAULT_HISTORY_COUNT)
}

// ═══════════════════════════════════════════
//  导出 Composable
// ═══════════════════════════════════════════
export function usePlaybackEngine() {
  /** 当前帧（拖动中返回原始帧，静止时返回完整计算帧） */
  const currentFrame = computed<FrameData | null>(() => {
    const idx = currentTick.value
    const rawFrame = frames.value[idx] || null
    if (!rawFrame) return null

    // 拖动中：跳过昂贵的重计算，直接用原始帧
    if (isSeeking.value) return rawFrame

    return applyDynamicSceneToFrame(rawFrame, idx)
  })

  /** 对比模式下的第二帧 */
  const currentCompareFrame = computed<FrameData | null>(() => {
    if (compareFrames.value.length === 0) return null
    const idx = currentTick.value
    const rawFrame = compareFrames.value[idx] || null
    if (!rawFrame) return null

    if (isSeeking.value) return rawFrame

    return applyDynamicSceneToFrame(rawFrame, idx, compareFrameCache)
  })

  const totalTicks = computed(() => frames.value.length)

  const progress = computed(() =>
    totalTicks.value > 1
      ? currentTick.value / (totalTicks.value - 1)
      : 0
  )

  /** 加载全部帧数据 */
  function loadFrames(data: FrameData[]) {
    frames.value = data
    compareFrames.value = []
    currentTick.value = 0
    isSeeking.value = false
    historyCache.value = []
    clearFrameCache()
  }

  /** 加载对比数据 (双路流) */
  function loadComparisonData(primary: FrameData[], secondary: FrameData[]) {
    frames.value = primary
    compareFrames.value = secondary
    currentTick.value = 0
    isSeeking.value = false
    historyCache.value = []
    clearFrameCache()
  }

  /** 播放 */
  function play() {
    if (frames.value.length === 0) return
    isPlaying.value = true
    isSeeking.value = false
    lastTime = performance.now()
    _scheduleNextTick()
  }

  /** 暂停 */
  function pause() {
    isPlaying.value = false
    if (_animFrameId.value) {
      cancelAnimationFrame(_animFrameId.value)
      _animFrameId.value = 0
    }
  }

  /** 切换播放/暂停 */
  function togglePlay() {
    if (isPlaying.value) pause()
    else play()
  }

  /** 精确跳转（非拖动场景，如点击按钮跳帧） */
  function seek(tickNum: number) {
    currentTick.value = Math.max(
      0,
      Math.min(tickNum, frames.value.length - 1)
    )
  }

  /** 设置播放倍速 */
  function setSpeed(speed: number) {
    playbackSpeed.value = speed
  }

  /** 内部 tick 驱动 */
  function _scheduleNextTick() {
    _animFrameId.value = requestAnimationFrame(_onTick)
  }

  function _onTick() {
    if (!isPlaying.value) return

    const now = performance.now()
    const delta = now - lastTime

    if (delta >= tickInterval / playbackSpeed.value) {
      lastTime = now
      if (currentTick.value < frames.value.length - 1) {
        currentTick.value++
      } else {
        currentTick.value = 0 // loop
      }
    }

    _scheduleNextTick()
  }

  /** 获取历史帧（返回防抖缓存，不会每次现算） */
  function getHistory(count?: number): FrameData[] {
    // 如果调用方传了自定义 count 且与默认不同，现算一次
    if (count !== undefined && count !== DEFAULT_HISTORY_COUNT) {
      const idx = currentTick.value
      const start = Math.max(0, idx - count + 1)
      const hist: FrameData[] = []
      for (let i = start; i <= idx; i++) {
        const f = frames.value[i]
        if (f) hist.push(applyDynamicSceneToFrame(f, i))
      }
      return hist
    }
    return historyCache.value
  }

  return {
    // 状态
    frames,
    compareFrames,
    currentFrame,
    currentCompareFrame,
    currentTick,
    totalTicks,
    progress,
    isPlaying,
    isSeeking,
    playbackSpeed,

    // 控制
    loadFrames,
    loadComparisonData,
    play,
    pause,
    togglePlay,
    seek,
    seekThrottled,   // ← 滑块拖动中用
    seekEnd,         // ← 滑块松手后用
    setSpeed,
    getHistory,
  }
}
