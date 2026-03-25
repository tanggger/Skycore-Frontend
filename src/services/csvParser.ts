/**
 * CSV 数据解析服务
 * 读取后端输出的 CSV 文件，转换为前端 FrameData 格式
 */
import Papa from 'papaparse'
import type { FrameData, UAVNode } from '../types'
import { defaultBuildings } from '../data/mockData'
import { GEOMETRIC_CONFLICT_DISTANCE_M, resolveConflictState } from '../utils/conflict'

const NUM_UAVS = 15

/** 通用 CSV fetch + parse */
async function fetchCSV<T>(url: string): Promise<T[]> {
    const resp = await fetch(url)
    const text = await resp.text()
    const result = Papa.parse<T>(text, { header: true, dynamicTyping: true, skipEmptyLines: true })
    return result.data
}

async function fetchText(url: string): Promise<string> {
    try {
        const resp = await fetch(url)
        if (!resp.ok) return ''
        return await resp.text()
    } catch (e) {
        return ''
    }
}

/** 检测两个 UAV 之间是否有 NLOS (简化: 距离建筑近 且 高度低于建筑) */
function checkNLOS(x: number, y: number, z: number, buildings: any[]): boolean {
    for (const b of buildings) {
        const w = b.w ?? b.width
        const d = b.d ?? b.depth
        const h = b.h ?? b.height ?? 80
        
        const dx = x - (b.x + w / 2)
        const dy = y - (b.y + d / 2)
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < (w + d) / 2 + 15 && z < h + 5) return true
    }
    return false
}

export async function loadCSVFrames(basePath: string = '/data'): Promise<FrameData[]> {
    // 尝试拉取 CSV，发生异常时降级优雅处理
    let qosRows: any[] = []
    let resRows: any[] = []
    let topoRows: any[] = []
    let posRows: any[] = []
    let detailedRows: any[] = []
    let topoChangesText = ''

    try {
        const results = await Promise.all([
            fetchCSV<any>(`${basePath}/qos_performance.csv`).catch(() => []),
            fetchCSV<any>(`${basePath}/resource_allocation.csv`).catch(() => []),
            fetchCSV<any>(`${basePath}/topology_evolution.csv`).catch(() => []),
            fetchCSV<any>(`${basePath}/rtk-node-positions.csv`).catch(() => []),
            fetchText(`${basePath}/rtk-topology-changes.txt`).catch(() => ''),
            fetchCSV<any>(`${basePath}/resource_allocation_detailed.csv`).catch(e => {
                console.warn('⚠️ resource_allocation_detailed.csv 加载失败(如果是旧版数据可忽略):', e)
                return []
            })
        ])
        qosRows = results[0]
        resRows = results[1]
        topoRows = results[2]
        posRows = results[3]
        topoChangesText = results[4] as string
        detailedRows = results[5]
    } catch (e) {
        console.warn('Failed to fetch some CSVs', e)
    }

    // 如果找不到 rtk-node-positions.csv，尝试找旧的 positions.csv
    if (posRows.length === 0) {
        posRows = await fetchCSV<any>(`${basePath}/positions.csv`).catch(() => [])
    }

    // 索引化: 按 time 取整分组(0.1s精度)
    const qosMap = new Map<number, any>()
    for (const r of qosRows) qosMap.set(Math.round(Number(r.time || 0) * 10) / 10, r)

    const resMap = new Map<number, any>()
    for (const r of resRows) resMap.set(Math.round(Number(r.time || 0) * 10) / 10, r)

    const topoMap = new Map<number, any>()
    for (const r of topoRows) topoMap.set(Math.round(Number(r.time || 0) * 10) / 10, r)

    // 详细资源分配 map: time -> nodeId -> data
    const detailedMap = new Map<number, Map<number, any>>()
    for (const r of detailedRows) {
        const t = Math.round(Number(r.time || 0) * 10) / 10
        const nid = Number(r.node_id ?? 0)
        if (!detailedMap.has(t)) detailedMap.set(t, new Map())
        detailedMap.get(t)!.set(nid, r)
    }

    // positions 每行是新款 (time_s, nodeId, x, y, z[, node_type]) 或旧款 (time, uav_id, pos_x, pos_y)
    const posMap = new Map<number, Map<number, {
        x: number
        y: number
        z: number
        drift: number
        node_type: number
        worst_sinr_dB?: number
        is_conflict?: boolean
    }>>()
    for (const r of posRows) {
        const t = Math.round(Number(r.time_s ?? r.time ?? 0) * 10) / 10
        const uid = Number(r.nodeId ?? r.uav_id ?? 0)

        if (!posMap.has(t)) posMap.set(t, new Map())
        posMap.get(t)!.set(uid, {
            x: Number(r.x ?? r.pos_x ?? 0),
            y: Number(r.y ?? r.pos_y ?? 0),
            z: Number(r.z ?? 30),
            drift: Number(r.rtk_drift_error || 0),
            node_type: Number(r.node_type ?? (uid >= 1000 ? 1 : 0)),
            worst_sinr_dB: r.worst_sinr_dB !== undefined && r.worst_sinr_dB !== null ? Number(r.worst_sinr_dB) : undefined,
            is_conflict: r.is_conflict !== undefined && r.is_conflict !== null ? Boolean(r.is_conflict) : undefined
        })
    }


    // 提取所有时间戳 (包括详细资源分配的时间点)
    const allTimes = [...new Set([
        ...qosMap.keys(), ...resMap.keys(), ...topoMap.keys(), ...posMap.keys(), ...detailedMap.keys()
    ])].sort((a, b) => a - b)

    // 解析 rtk-topology-changes.txt
    // 格式: 0.1-0.3s: Node0-Node1, Node0-Node2...
    const parsedLinksArray: { start: number, end: number, links: string[] }[] = []
    if (topoChangesText) {
        const lines = topoChangesText.split('\n')
        for (const line of lines) {
            const parts = line.split(':')
            if (parts.length < 2) continue
            
            const timeRange = parts[0].trim().replace('s', '') // "0.1-0.3"
            const linkContent = parts[1].trim() // "Node0-Node1, ..."
            
            const [startStr, endStr] = timeRange.split('-')
            const start = parseFloat(startStr)
            const end = parseFloat(endStr)
            
            if (!isNaN(start) && !isNaN(end)) {
                // 将 "Node0-Node1" 转换为 "0-1" 格式，适配前端
                const links = linkContent.split(',')
                    .map(s => s.trim())
                    .filter(s => s)
                    .map(s => {
                        // "Node0-Node1" -> "0-1"
                        return s.replace(/Node/g, '')
                    })
                parsedLinksArray.push({ start, end, links })
            }
        }
    }

    // 组装 FrameData
    const frames: FrameData[] = []
    // Track previous positions for heading calculation
    const prevPositions = new Map<number, { x: number; y: number }>()

    // Last known data for forward-fill (handling sparse sampling)
    let lastQoS: any = {}
    let lastRes: any = {}
    let lastTopo: any = {}
    let lastPositions = new Map<number, {
        x: number
        y: number
        z: number
        drift: number
        node_type: number
        worst_sinr_dB?: number
        is_conflict?: boolean
    }>()
    let lastDetailed = new Map<number, any>()

    for (const tick of allTimes) {
        // Update if data exists for this tick, otherwise hold previous
        const qos = qosMap.get(tick) || lastQoS
        const res = resMap.get(tick) || lastRes
        const topo = topoMap.get(tick) || lastTopo
        const currentPositions = posMap.get(tick)
        if (detailedMap.has(tick)) lastDetailed = detailedMap.get(tick)!

        if (qosMap.has(tick)) lastQoS = qos
        if (resMap.has(tick)) lastRes = res
        if (topoMap.has(tick)) lastTopo = topo
        
        // Positions needs special handling: merge new positions into lastPositions
        // (because rtk-node-positions might have only updated some nodes in this tick, or none)
        if (currentPositions) {
            for (const [uid, pos] of currentPositions.entries()) {
                lastPositions.set(uid, pos)
            }
        }
        
        // Use last known positions map
        const positions = lastPositions

        // Find matching links for this timestamp
        let activeLinks: string[] = []
        // 精确匹配时间窗口
        const matchingLinkObj = parsedLinksArray.find(l => tick >= l.start && tick <= l.end)
        if (matchingLinkObj) {
            activeLinks = matchingLinkObj.links
        } else if (parsedLinksArray.length > 0) {
            // 兜底：找最近的时间窗口
            const closest = parsedLinksArray.reduce((prev, curr) => {
                return (Math.abs(curr.start - tick) < Math.abs(prev.start - tick) ? curr : prev)
            })
            if (Math.abs(closest.start - tick) < 2.0) {
                activeLinks = closest.links
            }
        }

        const uavs: UAVNode[] = []
        // 收集所有节点 id：普通节点 0..NUM_UAVS-1 + 当前帧中黑飞节点 (id >= 1000)
        const normalIds = Array.from({ length: NUM_UAVS }, (_, i) => i)
        // From accumulated positions
        const rogueIds = [...positions.keys()].filter(id => id >= 1000)
        const allIds = [...new Set([...normalIds, ...rogueIds])] // De-duplicate

        for (const i of allIds) {
            const pos = positions.get(i) || { x: 300, y: 300, z: 30, drift: 0, node_type: i >= 1000 ? 1 : 0 }
            const detailed = lastDetailed.get(i)

            // 优先使用 resource_allocation_detailed.csv 的数据
            let ch = detailed?.channel
            if (ch === undefined) {
                 ch = Number(res[`uav${i}_channel`] ?? res[`uav${i}_ch`] ?? (i % 3))
            }
            ch = Number(ch)

            let pwr = detailed?.tx_power
            if (pwr === undefined) {
                 pwr = Number(res[`uav${i}_power`] ?? res[`uav${i}_pwr`] ?? 20)
            }
            pwr = Number(pwr)
            
            let rate = detailed?.data_rate
            if (rate === undefined) {
                rate = Number(res[`uav${i}_rate`] ?? 0)
            }
            rate = Number(rate)

            let neighbors = detailed?.neighbors
            if (neighbors === undefined) {
                // 如果没有详细数据，也许可以尝试通过几何距离估算，或者暂时留空
                // 这里暂时保持 undefined，或者设为 0
                // 现有的 UAVDetail.vue 看起来可以处理 undefined
                neighbors = 0 
            }
            neighbors = Number(neighbors)
            
            const rawInterference = detailed?.interference
            const interference = rawInterference !== undefined && rawInterference !== null
                ? Number(rawInterference)
                : undefined
            const rawSinr = detailed?.worst_sinr_dB ?? pos.worst_sinr_dB
            const sinr = rawSinr !== undefined && rawSinr !== null
                ? Number(rawSinr)
                : undefined

            const pdr = Number(qos[`uav${i}_pdr`] ?? qos.avg_pdr ?? 0.9)
            
            // CSV 中的 delay 单位是秒(s)，转换为毫秒(ms)
            // 如果 CSV 没有数据，兜底使用 0.015s (15ms)
            let rawDelay = Number(qos[`uav${i}_delay`] ?? qos.avg_delay ?? 0.015)
            
            // 如果读到的值为 0，通常意味着丢包/超时，在物理上应表现为极大时延
            // 这里强制设为 1.0s (1000ms) 以体现网络质量恶化
            if (rawDelay === 0) rawDelay = 1.0 

            const delay = rawDelay * 1000

            // CSV 中的 throughput 单位通常是 kbps，转换为 Mbps
            // 如果 CSV 没有数据，兜底使用 5000kbps (5Mbps)
            const rawTp = Number(qos[`uav${i}_throughput`] ?? qos.avg_throughput ?? 5000)
            const tp = rawTp / 1000

            const isNlos = checkNLOS(pos.x, pos.y, pos.z, defaultBuildings)

            const explicitConflictRaw = detailed?.is_conflict ?? pos.is_conflict
            let sameChannelNearby = false
            for (let j = 0; j < i; j++) {
                const otherPos = positions.get(j) || { x: 0, y: 0, z: 0, drift: 0 }
                // Use detailed data for J if available
                const detailedJ = lastDetailed.get(j)
                let otherCh = detailedJ?.channel
                if (otherCh === undefined) {
                     otherCh = Number(res[`uav${j}_channel`] ?? res[`uav${j}_ch`] ?? (j % 3))
                }
                otherCh = Number(otherCh)

                if (otherCh === ch) {
                    const dx = pos.x - otherPos.x
                    const dy = pos.y - otherPos.y
                    const dz = pos.z - otherPos.z
                    // 3D 距离冲突检测
                    if (Math.sqrt(dx * dx + dy * dy + dz * dz) < GEOMETRIC_CONFLICT_DISTANCE_M) {
                        sameChannelNearby = true
                        break
                    }
                }
            }
            const { isConflict, source: conflictSource } = resolveConflictState({
                sinr,
                interference,
                explicitConflict: explicitConflictRaw !== undefined ? Boolean(explicitConflictRaw) : undefined,
                sameChannelNearby,
            })

            // 能量随时间衰减
            // Heading: computed from movement direction vs previous tick
            let heading: number | undefined;
            const prev = prevPositions.get(i);
            if (prev) {
                const dx = pos.x - prev.x;
                const dy = pos.y - prev.y;
                if (dx * dx + dy * dy > 0.01) {
                    heading = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
                }
            }
            prevPositions.set(i, { x: pos.x, y: pos.y });

            uavs.push({
                id: i,
                x: pos.x + (pos.drift > 0 ? (Math.random() - 0.5) * pos.drift : 0),
                y: pos.y + (pos.drift > 0 ? (Math.random() - 0.5) * pos.drift : 0),
                z: pos.z,
                channel: ch,
                is_conflict: isConflict,
                is_nlos: isNlos,
                is_active: true,
                node_type: pos.node_type ?? (i >= 1000 ? 1 : 0),
                pdr, delay, throughput: tp, power: pwr, rate,
                neighbors, interference, sinr,
                heading,
                conflict_source: conflictSource,
            })
        }

        const avgPdr = Number(qos.avg_pdr) || uavs.reduce((s, u) => s + (u.pdr || 0), 0) / NUM_UAVS
        const avgDelay = Number(qos.avg_delay) || uavs.reduce((s, u) => s + (u.delay || 0), 0) / NUM_UAVS

        frames.push({
            tick,
            QoS: {
                total_pdr: avgPdr,
                p99_latency_ms: avgDelay * 1.5,
                throughput_mbps: Number(qos.avg_throughput) || 100,
                algo_compute_time_ms: 1.5 + Math.random() * 2
            },
            uav_nodes: uavs,
            topology: {
                num_links: Number(topo.num_links) || activeLinks.length || 25,
                connectivity: Number(topo.connectivity) || 0.95
            },
            conflicts: uavs.filter(u => u.is_conflict).length,
            links: activeLinks // 注入解析出的真实链路数据
        })
    }

    return frames
}
