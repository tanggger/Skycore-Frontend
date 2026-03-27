import type { BuildingBlock, FrameData, UAVNode, GeoJsonMapData, FrontendResponse, FrontendResponseData } from '../types'
import type { FormationType } from '../data/mockData'
import { GEOMETRIC_CONFLICT_DISTANCE_M, resolveConflictState } from '../utils/conflict'

// ── 合作模式专用配置字段 ──
export interface CooperativeConfigParams {
    communicationMode?: 'centralized' | 'distributed' | 'hybrid'
    leaderNodeId?: number
    backupLeaderList?: string      // 逗号分隔字符串，例如 "2,3,4"
    distributedHopLimit?: number   // 1 or 2

    cooperativeFailureType?: 'node_failure' | 'environment_degradation' | 'external_interference' | 'link_degradation'
    failureTargetId?: number
    failureStartTime?: number
    failureDuration?: number

    recoveryPolicy?: 'global_recovery' | 'local_recovery'
    recoveryObjective?: 'connectivity' | 'delay' | 'throughput' | 'pdr'
    recoveryCooldown?: number

    allowChannelReallocation?: boolean
    allowPowerAdjustment?: boolean
    allowRateAdjustment?: boolean
    allowRelayReselection?: boolean
    allowSlotReallocation?: boolean
    allowRouteRebuild?: boolean
}

export interface CustomSimulationParams {
    // --- 物理信道参数 ---
    pathLossExp?: number
    rxSens?: number
    txPower?: number
    nakagamiM?: number
    noiseFigure?: number
    // --- 网络层/MAC层参数 ---
    macRetries?: number
    trafficLoad?: number
    // --- RTK 定位误差参数 ---
    rtkNoise?: number
    rtkDriftMag?: number
    rtkDriftInt?: number
    rtkDriftDur?: number
    // --- 黑飞/恶意干扰参数 ---
    numInterfere?: number
    interfereRate?: number
    interfereDuty?: number
}

export interface SimulationConfig extends CustomSimulationParams, CooperativeConfigParams {
    buildings: BuildingBlock[]
    swarm_size: number
    formation: FormationType
    formation_spacing?: number
    difficulty: 'Easy' | 'Moderate' | 'Hard' | 'Custom'
    strategy: 'static' | 'dynamic'
    start?: string
    target?: string
    map_name?: string
    operationMode: 'cooperative' | 'non_cooperative'
    sceneType: string   // 后端格式: urban / forest / lake / open-field

    // --- 非合作模式打击闭环参数 ---
    enableNonCooperativeAttack?: boolean
    attackType?: string
    manualStrikeTarget?: number
    attackExecuteTime?: number
    attackEvaluationDuration?: number
    attackNeighborhoodHop?: number
}

const BASE_URL = 'http://localhost:5000';

function isEmptyValue(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

function getValueAtPath(obj: any, path: string): unknown {
    return path.split('.').reduce((acc: any, key) => acc?.[key], obj);
}

function collectMissingFields(payload: any, paths: string[]): string[] {
    const missing: string[] = [];
    for (const path of paths) {
        if (isEmptyValue(getValueAtPath(payload, path))) {
            missing.push(path);
        }
    }
    return missing;
}

function formatMissingFieldsError(paths: string[]): never {
    throw new Error(
        `后端返回的数据不完整，缺少以下字段：\n${paths.map(path => `- ${path}`).join('\n')}`
    );
}

function validateFrontendPayload(
    payload: FrontendResponseData | undefined,
    config: SimulationConfig
): FrontendResponseData {
    if (!payload) {
        throw new Error('后端没有返回 data 字段，无法完成前后端对接。');
    }

    const requiredCommon = [
        'meta.taskId',
        'meta.operationMode',
        'meta.sceneType',
        'meta.difficulty',
        'shared.positions',
        'shared.qos',
        'shared.topology_evolution',
        'shared.topology_links',
        'shared.transmissions',
        'shared.resource_detailed'
    ];

    const requiredCooperative = [
        'cooperative.mode_summary',
        'cooperative.dashboard_snapshot',
        'cooperative.failure_timeline.events',
        'cooperative.recovery_timeline.actions',
        'cooperative.metrics_timeseries.samples'
    ];

    const requiredNonCooperative = [
        'non_cooperative.observation_inference.observed_signal_events',
        'non_cooperative.observation_inference.observed_comm_windows',
        'non_cooperative.observation_inference.observed_link_evidence',
        'non_cooperative.observation_inference.inferred_topology_edges',
        'non_cooperative.observation_inference.inferred_graph_nodes',
        'non_cooperative.observation_inference.key_node_candidates'
    ];

    const requiredAttack = [
        'non_cooperative.attack.recommendations',
        'non_cooperative.attack.plan',
        'non_cooperative.attack.events',
        'non_cooperative.attack.target_binding',
        'non_cooperative.attack.effect_metrics',
        'non_cooperative.attack.summary'
    ];

    const missing = collectMissingFields(payload, requiredCommon);

    if (payload.meta.operationMode !== config.operationMode) {
        missing.push(`meta.operationMode (expected ${config.operationMode}, got ${payload.meta.operationMode})`);
    }

    if (config.operationMode === 'cooperative') {
        missing.push(...collectMissingFields(payload, requiredCooperative));
    }

    if (config.operationMode === 'non_cooperative') {
        missing.push(...collectMissingFields(payload, requiredNonCooperative));
        if (config.enableNonCooperativeAttack) {
            missing.push(...collectMissingFields(payload, requiredAttack));
        }
    }

    if (missing.length > 0) {
        formatMissingFieldsError(Array.from(new Set(missing)));
    }

    return payload;
}

/**
 * Parses the raw JSON response from the backend into a FrameData array
 * matching what the frontend expects.
 * Supports both old /api/results/<task_id> and new /frontend endpoint shared data.
 */
function parseBackendJSONToFrames(payload: any, swarmSize: number): FrameData[] {
    const frames: FrameData[] = [];
    // 支持新旧两种数据结构
    const positions = payload.positions || payload.shared?.positions || [];
    const qos = payload.qos || payload.shared?.qos || [];
    const topo = payload.topology_evolution || payload.shared?.topology_evolution || [];
    const backendTransmissions = payload.transmissions || payload.shared?.transmissions || [];
    const backendLinks = payload.topology_links || payload.shared?.topology_links || [];
    const resourceAlloc = payload.resource_allocation || [];
    const resourceDetailed = payload.resource_detailed || payload.shared?.resource_detailed || [];
    const detailedByTime = new Map<number, Map<number, any>>();
    for (const r of resourceDetailed) {
        const t = Math.round(Number(r.time) * 10) / 10;
        const nid = Number(r.node_id ?? r.nodeId ?? 0);
        if (!detailedByTime.has(t)) detailedByTime.set(t, new Map());
        detailedByTime.get(t)!.set(nid, r);
    }
    console.log(`[parseFrames] resource_detailed 索引: ${detailedByTime.size} 个时刻, 原始 ${resourceDetailed.length} 条`);

    // Map data by time segment
    const timeMap = new Map<number, any>();

    // Process QoS
    for (const q of qos) {
        const t = q.time;
        if (!timeMap.has(t)) timeMap.set(t, { qos: q, positions: new Map(), num_links: 0, connectivity: 0 });
        else timeMap.get(t).qos = q;
    }

    // Process Topology Evolution
    for (const tp of topo) {
        const t = tp.time;
        if (!timeMap.has(t)) timeMap.set(t, { qos: {}, positions: new Map(), num_links: tp.num_links, connectivity: tp.connectivity });
        else {
            timeMap.get(t).num_links = tp.num_links;
            timeMap.get(t).connectivity = tp.connectivity;
        }
    }

    // Process Positions
    for (const p of positions) {
        const t = p.time;
        if (!timeMap.has(t)) {
            timeMap.set(t, { qos: {}, positions: new Map(), num_links: 0, connectivity: 0 });
        }
        timeMap.get(t).positions.set(p.nodeId, p);
    }

    // Process Resource Allocation (channel / power / rate per UAV per tick)
    const resMap = new Map<number, any>();
    for (const r of resourceAlloc) {
        resMap.set(Number(r.time ?? 0), r);
    }

    // Process Topology Links (backend returns string list like: "0.0-0.2s: Node0-Node1, Node0-Node2")
    const parsedLinksArray: { start: number, end: number, links: string[] }[] = [];
    if (Array.isArray(backendLinks)) {
        for (const linkStr of backendLinks) {
            if (typeof linkStr !== 'string') continue;
            const parts = linkStr.split(':');
            if (parts.length >= 2) {
                const timeMatch = parts[0].match(/([0-9.]+)-([0-9.]+)s/);
                if (timeMatch) {
                    parsedLinksArray.push({
                        start: parseFloat(timeMatch[1]),
                        end: parseFloat(timeMatch[2]),
                        links: parts[1].split(',').map(s => s.trim()).filter(s => s.length > 0)
                    });
                }
            }
        }
    }

    const allTimes = Array.from(timeMap.keys()).sort((a, b) => a - b);

    // Forward-fill caches to prevent zero-drop spikes when data sampling rates differ
    let lastQosData: any = {};
    let lastResData: any = {};
    let lastDetailedSnapshot = new Map<number, any>();
    const lastPositions = new Map<number, any>();

    // Track previous tick positions for heading calculation
    const prevPositions = new Map<number, { x: number; y: number }>();

    for (const tick of allTimes) {
        const data = timeMap.get(tick);

        if (data.qos && Object.keys(data.qos).length > 0) {
            lastQosData = data.qos;
        }
        const qosData = lastQosData;

        if (data.positions && data.positions.size > 0) {
            for (const [id, pos] of data.positions) {
                lastPositions.set(id, pos);
            }
        }

        const resDataRaw = resMap.get(tick);
        if (resDataRaw) lastResData = resDataRaw;
        const resData = lastResData;
        const tickR = Math.round(tick * 10) / 10;
        if (detailedByTime.has(tickR)) {
            lastDetailedSnapshot = detailedByTime.get(tickR)!;
        }

        const uavs: UAVNode[] = [];
        const uavsWithPhys = new Set<number>();
        let totalPdrSum = 0;
        let totalDelaySum = 0;
        let totalTpSum = 0;

        const normalIds = Array.from({ length: swarmSize }, (_, i) => i);
        const rogueIds = [...lastPositions.keys()].filter((id: number) => id >= 1000);
        const allNodeIds = [...new Set([...normalIds, ...rogueIds])];

        for (const i of allNodeIds) {
            const isRogue = i >= 1000;
            const pos = lastPositions.get(i) || { x: 0, y: 0, z: 30 };

            const uPdr = isRogue ? 0 : (qosData[`uav${i}_pdr`] ?? qosData.avg_pdr ?? 0.95);
            let rawDelay = Number(qosData[`uav${i}_delay`] ?? qosData.avg_delay ?? 0.012);
            if (rawDelay === 0) rawDelay = 1.0;
            const uDelay = isRogue ? 0 : rawDelay * 1000;
            const rawTp = qosData[`uav${i}_throughput`] ?? qosData.avg_throughput ?? 5000;
            const uTp = isRogue ? 0 : Number(rawTp) / 1000;

            const det = lastDetailedSnapshot.get(i);
            const uChannel      = isRogue ? 0 : Number(det?.channel     ?? pos.channel   ?? resData[`uav${i}_channel`] ?? (i % 3));
            const uPower        = isRogue ? 0 : Number(det?.tx_power    ?? pos.power     ?? resData[`uav${i}_power`]   ?? 20);
            const uRate         = isRogue ? 0 : Number(det?.data_rate   ?? pos.data_rate  ?? resData[`uav${i}_rate`]    ?? 0);
            const uNeighbors    = isRogue ? 0 : Number(det?.neighbors   ?? pos.neighbors  ?? 0);
            const rawInterference = det?.interference ?? pos.interference;
            const rawSinr         = det?.worst_sinr_dB ?? pos.worst_sinr_dB;

            if ((rawSinr !== undefined || rawInterference !== undefined) && !(window as any)['_hasLoggedPhys']) {
                 console.log(`%c[WingNet Physics] 📡 Data Stream Detected!`, 'color: #00f2ff; font-weight: bold;');
                 console.log(`   Node: ${i}, Tick: ${tick}`);
                 console.log(`   ▶ SINR: ${rawSinr} dB (Threshold < 10)`);
                 console.log(`   ▶ Interference: ${rawInterference} dBm (Threshold > -82)`);
                 (window as any)['_hasLoggedPhys'] = true;
            }
            
            const explicitConflict = det?.is_conflict ?? pos.is_conflict;
            const parsedSinr = rawSinr !== undefined && rawSinr !== null ? Number(rawSinr) : undefined;
            const parsedInterference = rawInterference !== undefined && rawInterference !== null ? Number(rawInterference) : undefined;
            if (parsedSinr !== undefined || parsedInterference !== undefined) {
                uavsWithPhys.add(i);
            }

            let { isConflict: uConflict, source: conflictSource } = resolveConflictState({
                sinr: parsedSinr,
                interference: parsedInterference,
                explicitConflict: explicitConflict !== undefined ? Boolean(explicitConflict) : undefined,
            });

            if (isRogue) {
                uConflict = false;
                conflictSource = 'none';
            }

            const uNlos     = Boolean(det?.is_nlos     ?? pos.is_nlos     ?? false);

            if (!isRogue) {
                totalPdrSum += uPdr;
                totalDelaySum += uDelay;
                totalTpSum += uTp;
            }

            let heading: number | undefined;
            const prev = prevPositions.get(i);
            if (prev) {
                const dx = pos.x - prev.x;
                const dy = pos.y - prev.y;
                if (dx * dx + dy * dy > 0.01) {
                    heading = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
                }
            }

            uavs.push({
                id: i,
                x: pos.x,
                y: pos.y,
                z: pos.z,
                channel: uChannel,
                is_conflict: uConflict,
                is_nlos: uNlos,
                is_active: true,
                node_type: isRogue ? 1 : 0,
                delay: uDelay,
                pdr: uPdr,
                throughput: uTp,
                power: uPower,
                rate: uRate,
                neighbors: uNeighbors,
                interference: parsedInterference,
                sinr: parsedSinr,
                heading: heading,
                speed: pos.speed,
                conflict_source: conflictSource
            });
            
            prevPositions.set(i, { x: pos.x, y: pos.y });
        }

        // Find closest matching parsed links for this tick
        let activeLinks: string[] = [];
        const matchingLinkObj = parsedLinksArray.find(l => tick >= l.start && tick <= l.end);
        if (matchingLinkObj) {
            activeLinks = matchingLinkObj.links;
        } else {
            const closest = parsedLinksArray.sort((a, b) => Math.abs(a.start - tick) - Math.abs(b.start - tick))[0];
            if (closest && Math.abs(closest.start - tick) <= 1.0) {
                activeLinks = closest.links;
            }
        }

        // Bronze Standard: Geometric fallback
        for (let a = 0; a < uavs.length; a++) {
            if (uavs[a].node_type === 1) continue; 
            for (let b = a + 1; b < uavs.length; b++) {
                if (uavs[b].node_type === 1) continue;
                if (uavs[a].channel === uavs[b].channel) {
                    const dx = uavs[a].x - uavs[b].x;
                    const dy = uavs[a].y - uavs[b].y;
                    const dz = (uavs[a].z || 30) - (uavs[b].z || 30);
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist < GEOMETRIC_CONFLICT_DISTANCE_M) { 
                        if (!uavsWithPhys.has(uavs[a].id) && uavs[a].conflict_source === 'none') {
                            uavs[a].is_conflict = true;
                            uavs[a].conflict_source = 'geometric';
                        }
                        if (!uavsWithPhys.has(uavs[b].id) && uavs[b].conflict_source === 'none') {
                            uavs[b].is_conflict = true;
                            uavs[b].conflict_source = 'geometric';
                        }
                    }
                }
            }
        }

        frames.push({
            tick,
            QoS: {
                total_pdr: totalPdrSum / swarmSize,
                p99_latency_ms: (totalDelaySum / swarmSize) * 1.5,
                throughput_mbps: (totalTpSum / swarmSize),
                algo_compute_time_ms: 1.5 + Math.random() * 2
            },
            uav_nodes: uavs,
            topology: {
                num_links: data.num_links,
                connectivity: data.connectivity
            },
            conflicts: uavs.filter(u => u.is_conflict).length,
            links: activeLinks,
            transmissions: backendTransmissions.filter((tr: any) => {
                const trTime = typeof tr.time === 'number' ? tr.time : (typeof tr.time_s === 'number' ? tr.time_s : parseFloat(tr.time || tr.time_s || '0'));
                return Math.abs(trTime - tick) <= 0.5;
            })
        } as any);
    }

    return frames;
}

/**
 * 将 resource_detailed 数据合并到 FrameData 的 uav_nodes 中
 */
export function mergeDetailedIntoFrames(
  frames: FrameData[],
  resourceDetailed: any[]
): FrameData[] {
  if (!resourceDetailed || resourceDetailed.length === 0) return frames

  const detailedIndex = new Map<number, Map<number, any>>()
  for (const r of resourceDetailed) {
    const t = Math.round(Number(r.time) * 10) / 10
    const nid = Number(r.node_id)
    if (!detailedIndex.has(t)) detailedIndex.set(t, new Map())
    detailedIndex.get(t)!.set(nid, r)
  }

  let lastSnapshot = new Map<number, any>()

  for (const frame of frames) {
    const tick = Math.round(frame.tick * 10) / 10
    if (detailedIndex.has(tick)) {
      lastSnapshot = detailedIndex.get(tick)!
    }
    for (const uav of frame.uav_nodes) {
      const d = lastSnapshot.get(uav.id)
      if (d) {
        if (d.tx_power !== undefined) uav.power = Number(d.tx_power)
        if (d.channel !== undefined) uav.channel = Number(d.channel)
        if (d.data_rate !== undefined) uav.rate = Number(d.data_rate)
        if (d.neighbors !== undefined) uav.neighbors = Number(d.neighbors)
        if (d.interference !== undefined) uav.interference = Number(d.interference)
      }
    }
  }

  return frames
}

/**
 * API 服务 — 对接后端的完整接口层
 */
export const apiService = {

    /** 健康检查 GET /api/health */
    async checkHealth(): Promise<{ status: string; message: string }> {
        const res = await fetch(`${BASE_URL}/api/health`)
        if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`)
        return res.json()
    },

    /**
     * 发起仿真任务 POST /api/simulate
     * 返回 taskId 和初始状态
     */
    async startSimulation(config: SimulationConfig): Promise<{ taskId: string; status: string }> {
        console.log('[WingNet API] POST /api/simulate', JSON.stringify(config, null, 2))

        const body: Record<string, any> = {
            operationMode: config.operationMode,
            sceneType: config.sceneType,
            num_drones: config.swarm_size,
            formation: config.formation,
            formation_spacing: config.formation_spacing,
            difficulty: config.difficulty,
            strategy: config.strategy,
            start: config.start || '0,0,30',
            target: config.target || '0,600,30',
        }

        // 地图
        if (config.map_name) {
            body.map_name = config.map_name
            body.buildings = []
        } else {
            body.buildings = config.buildings.map(b => ({
                xMin: b.x, xMax: b.x + b.width,
                yMin: b.y, yMax: b.y + b.depth,
                zMin: 0, zMax: b.height
            }))
        }

        // 合作模式专用字段
        if (config.operationMode === 'cooperative') {
            if (config.communicationMode) body.communicationMode = config.communicationMode
            if (config.leaderNodeId !== undefined) body.leaderNodeId = config.leaderNodeId
            if (config.backupLeaderList) body.backupLeaderList = config.backupLeaderList
            if (config.distributedHopLimit !== undefined) body.distributedHopLimit = config.distributedHopLimit
            if (config.cooperativeFailureType) body.cooperativeFailureType = config.cooperativeFailureType
            if (config.failureTargetId !== undefined) body.failureTargetId = config.failureTargetId
            if (config.failureStartTime !== undefined) body.failureStartTime = config.failureStartTime
            if (config.failureDuration !== undefined) body.failureDuration = config.failureDuration
            if (config.recoveryPolicy) body.recoveryPolicy = config.recoveryPolicy
            if (config.recoveryObjective) body.recoveryObjective = config.recoveryObjective
            if (config.recoveryCooldown !== undefined) body.recoveryCooldown = config.recoveryCooldown
            // 动作开关
            if (config.allowChannelReallocation !== undefined) body.allowChannelReallocation = config.allowChannelReallocation
            if (config.allowPowerAdjustment !== undefined) body.allowPowerAdjustment = config.allowPowerAdjustment
            if (config.allowRateAdjustment !== undefined) body.allowRateAdjustment = config.allowRateAdjustment
            if (config.allowRelayReselection !== undefined) body.allowRelayReselection = config.allowRelayReselection
            if (config.allowSlotReallocation !== undefined) body.allowSlotReallocation = config.allowSlotReallocation
            if (config.allowRouteRebuild !== undefined) body.allowRouteRebuild = config.allowRouteRebuild
        }

        // Custom 难度参数
        if (config.difficulty === 'Custom') {
            const customKeys: (keyof CustomSimulationParams)[] = [
                'pathLossExp', 'rxSens', 'txPower', 'nakagamiM', 'noiseFigure',
                'macRetries', 'trafficLoad',
                'rtkNoise', 'rtkDriftMag', 'rtkDriftInt', 'rtkDriftDur',
                'numInterfere', 'interfereRate', 'interfereDuty'
            ]
            for (const k of customKeys) {
                if (config[k] !== undefined) body[k] = config[k]
            }
        }

        const res = await fetch(`${BASE_URL}/api/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })

        if (!res.ok) {
            throw new Error(`Failed to start simulation: ${res.statusText}`)
        }

        const data = await res.json()
        console.log(`[WingNet API] 仿真已在云端启动，任务 ID: ${data.task_id}`)
        return { taskId: data.task_id, status: data.status || 'RUNNING' }
    },

    /**
     * 轮询前端专用结果 GET /api/results/<task_id>/frontend
     */
    async pollFrontendResults(taskId: string): Promise<FrontendResponse> {
        const res = await fetch(`${BASE_URL}/api/results/${taskId}/frontend`)
        if (!res.ok) throw new Error(`Failed to poll frontend results: ${res.statusText}`)
        return res.json()
    },

    /**
     * 获取 Manifest GET /api/results/<task_id>/manifest
     */
    async pollManifest(taskId: string): Promise<any> {
        const res = await fetch(`${BASE_URL}/api/results/${taskId}/manifest`)
        if (!res.ok) throw new Error(`Failed to poll manifest: ${res.statusText}`)
        return res.json()
    },

    /**
     * 轮询旧版结果（兼容） GET /api/results/<task_id>
     */
    async pollLegacyResults(taskId: string): Promise<any> {
        const res = await fetch(`${BASE_URL}/api/results/${taskId}`)
        if (!res.ok) throw new Error('Failed to poll results')
        return res.json()
    },

    /**
     * 完整仿真工作流：启动 → 轮询 → 返回帧数据
     * 优先使用 /frontend 接口，fallback 到旧接口
     */
    async runSimulationAndPoll(config: SimulationConfig): Promise<{
        frames: FrameData[],
        frontendData?: any
    }> {
        try {
            // 1. 启动仿真
            const { taskId } = await this.startSimulation(config)

            // 2. 等 2s 后开始轮询
            await new Promise(r => setTimeout(r, 2000))

            // 3. 轮询结果（优先 /frontend）
            return new Promise((resolve, reject) => {
                const timer = setInterval(async () => {
                    try {
                        // 尝试新接口
                        let pollData: any
                        try {
                            pollData = await this.pollFrontendResults(taskId)
                        } catch {
                            // fallback 到旧接口
                            pollData = await this.pollLegacyResults(taskId)
                        }

                        if (pollData.status === 'SUCCESS') {
                            clearInterval(timer)
                            console.log("[WingNet API] 🎉 数据结算完成！")

                            const rawData = validateFrontendPayload(pollData.data, config)
                            // 解析帧数据（从 shared 或直接从 data）
                            const frameSource: any = rawData?.shared ? rawData.shared : rawData
                            let frames = parseBackendJSONToFrames(
                                frameSource,
                                config.swarm_size
                            )

                            if (frames.length === 0) {
                                throw new Error('后端返回成功，但无法解析出任何回放帧，请检查 shared.positions / shared.qos / shared.topology_evolution。')
                            }

                            // 合并 resource_detailed
                            const detailed = frameSource.resource_detailed || (rawData as any)?.resource_detailed || []
                            if (detailed.length > 0) {
                                console.log(`[WingNet API] 注入 Detailed Resource Data: ${detailed.length} records`)
                                frames = mergeDetailedIntoFrames(frames, detailed)
                            }

                            resolve({ frames, frontendData: rawData })

                        } else if (pollData.status === 'FAILED') {
                            clearInterval(timer)
                            console.error("[WingNet API] ❌ 后端引擎推演崩溃了：", pollData.error)
                            reject(new Error("Server simulation failed: " + pollData.error))
                        } else {
                            console.log(`[WingNet API] 状态: ${pollData.status} (后端算力引擎正在轰鸣中...)`)
                        }
                    } catch (e) {
                        clearInterval(timer)
                        reject(e)
                    }
                }, 3000)
            })

        } catch (error) {
            console.error('[WingNet API] Backend integration failed:', error)
            throw error
        }
    },

    /**
     * 上传 .geojson 文件并获取解析后的建筑数据
     */
    async uploadGeoJsonMap(file: File, mapName: string): Promise<GeoJsonMapData> {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('map_name', mapName)

        const res = await fetch(`${BASE_URL}/api/upload_geojson`, {
            method: 'POST',
            body: formData
        })

        if (!res.ok) {
            throw new Error(`GeoJSON 上传失败: ${res.status} ${res.statusText}`)
        }

        const json = await res.json()
        if (json.status !== 'SUCCESS') {
            throw new Error(json.message || '后端解析 GeoJSON 文件失败')
        }

        return json.data as GeoJsonMapData
    },

    /**
     * 拉取已有地图数据 GET /api/map_data/<map_name>
     */
    async fetchGeoJsonMapData(mapName: string): Promise<GeoJsonMapData> {
        const res = await fetch(`${BASE_URL}/api/map_data/${encodeURIComponent(mapName)}`)
        if (!res.ok) {
            throw new Error(`获取地图失败: ${res.status} ${res.statusText}`)
        }
        const json = await res.json()
        return (json.data ?? json) as GeoJsonMapData
    },

    /**
     * 获取所有可用地图列表 GET /api/maps
     */
    async fetchMaps(): Promise<string[]> {
        const res = await fetch(`${BASE_URL}/api/maps`)
        if (!res.ok) {
            throw new Error(`获取地图列表失败: ${res.status} ${res.statusText}`)
        }
        const json = await res.json()
        return (json.maps || []) as string[]
    }
}
