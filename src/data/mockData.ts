/**
 * Mock 数据生成器
 * 生成 15 架无人机在 300 tick 内的仿真数据
 * 支持多种阵型：v_formation, line, triangle, cross
 */
import type { FrameData, UAVNode, BuildingBlock, SceneConfig } from '../types'

const NUM_UAVS = 15
const TOTAL_TICKS = 300
const GRID_SIZE = 600

/** 默认建筑物布局 (CBD 区域) */
export const defaultBuildings: BuildingBlock[] = [
    { x: 180, y: 150, width: 50, depth: 50, height: 80 },
    { x: 300, y: 200, width: 60, depth: 40, height: 100 },
    { x: 400, y: 120, width: 45, depth: 55, height: 70 },
    { x: 250, y: 350, width: 55, depth: 45, height: 90 },
    { x: 420, y: 320, width: 50, depth: 50, height: 110 },
    { x: 150, y: 400, width: 40, depth: 60, height: 75 },
    { x: 350, y: 450, width: 65, depth: 35, height: 85 },
    { x: 500, y: 250, width: 45, depth: 50, height: 95 },
    { x: 100, y: 280, width: 50, depth: 40, height: 60 },
]

export const defaultScene: SceneConfig = {
    buildings: defaultBuildings,
    gridSize: GRID_SIZE
}

// ──────────────── 阵型生成器 ────────────────

export type FormationType = 'v_formation' | 'line' | 'triangle' | 'cross'

/** V 字编队 */
function generateVFormation(centerX: number, centerY: number, count: number, spacing: number): Array<{ x: number, y: number }> {
    const positions: Array<{ x: number, y: number }> = []
    const half = Math.floor(count / 2)
    positions.push({ x: centerX, y: centerY })
    for (let i = 1; i <= half; i++) {
        positions.push({ x: centerX - i * spacing * 0.7, y: centerY + i * spacing })
        if (positions.length < count) {
            positions.push({ x: centerX + i * spacing * 0.7, y: centerY + i * spacing })
        }
    }
    return positions.slice(0, count)
}

/** 直线编队 */
function generateLineFormation(centerX: number, centerY: number, count: number, spacing: number): Array<{ x: number, y: number }> {
    const positions: Array<{ x: number, y: number }> = []
    const startX = centerX - ((count - 1) * spacing) / 2
    for (let i = 0; i < count; i++) {
        positions.push({ x: startX + i * spacing, y: centerY })
    }
    return positions
}

/** 三角形编队 */
function generateTriangleFormation(centerX: number, centerY: number, count: number, spacing: number): Array<{ x: number, y: number }> {
    const positions: Array<{ x: number, y: number }> = []
    // Leader at front
    positions.push({ x: centerX, y: centerY })
    // Fill rows: row 1 has 2, row 2 has 3, row 3 has 4, etc.
    let row = 1
    while (positions.length < count) {
        const cols = row + 1
        const rowY = centerY + row * spacing
        const startX = centerX - (cols - 1) * spacing * 0.5
        for (let c = 0; c < cols && positions.length < count; c++) {
            positions.push({ x: startX + c * spacing, y: rowY })
        }
        row++
    }
    return positions.slice(0, count)
}

/** 十字形编队 */
function generateCrossFormation(centerX: number, centerY: number, count: number, spacing: number): Array<{ x: number, y: number }> {
    const positions: Array<{ x: number, y: number }> = []
    // Center
    positions.push({ x: centerX, y: centerY })
    // Fill arms: up, right, down, left, alternating outward
    let ring = 1
    while (positions.length < count) {
        // Up
        if (positions.length < count) positions.push({ x: centerX, y: centerY - ring * spacing })
        // Right
        if (positions.length < count) positions.push({ x: centerX + ring * spacing, y: centerY })
        // Down
        if (positions.length < count) positions.push({ x: centerX, y: centerY + ring * spacing })
        // Left
        if (positions.length < count) positions.push({ x: centerX - ring * spacing, y: centerY })
        ring++
    }
    return positions.slice(0, count)
}

/** 统一阵型生成接口 */
export function generateFormation(
    type: FormationType,
    centerX: number, centerY: number,
    count: number, spacing: number
): Array<{ x: number, y: number }> {
    switch (type) {
        case 'v_formation': return generateVFormation(centerX, centerY, count, spacing)
        case 'line': return generateLineFormation(centerX, centerY, count, spacing)
        case 'triangle': return generateTriangleFormation(centerX, centerY, count, spacing)
        case 'cross': return generateCrossFormation(centerX, centerY, count, spacing)
        default: return generateVFormation(centerX, centerY, count, spacing)
    }
}

/** 检测 NLOS: 简单检查无人机是否在建筑物后方 */
function checkNLOS(x: number, y: number, buildings: BuildingBlock[]): boolean {
    for (const b of buildings) {
        const dx = x - (b.x + b.width / 2)
        const dy = y - (b.y + b.depth / 2)
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < (b.width + b.depth) / 2 + 15) return true
    }
    return false
}

/** 生成全部帧数据 */
export function generateMockFrames(formation: FormationType = 'v_formation'): FrameData[] {
    const frames: FrameData[] = []

    for (let tick = 0; tick < TOTAL_TICKS; tick++) {
        const t = tick / TOTAL_TICKS
        const uavs: UAVNode[] = []

        // 编队整体运动
        const formationCenterX = 300 + Math.sin(t * Math.PI * 2) * 120
        const formationCenterY = 80 + t * 400
        const wrappedY = formationCenterY % GRID_SIZE

        const currentPositions = generateFormation(formation, formationCenterX, wrappedY, NUM_UAVS, 35)

        let conflictCount = 0

        for (let i = 0; i < NUM_UAVS; i++) {
            const basePos = currentPositions[i] || { x: 300, y: 300 }

            // 小幅抖动模拟 RTK 误差
            const jitterX = (Math.sin(tick * 0.1 + i * 1.5) * 5)
            const jitterY = (Math.cos(tick * 0.15 + i * 2.0) * 5)

            const px = Math.max(20, Math.min(GRID_SIZE - 20, basePos.x + jitterX))
            const py = Math.max(20, Math.min(GRID_SIZE - 20, basePos.y + jitterY))

            // 信道分配
            let channel = i % 3
            const isNlos = checkNLOS(px, py, defaultBuildings)

            // 偶尔模拟冲突事件
            let isConflict = false
            if (tick > 100 && tick < 130 && (i === 3 || i === 4)) {
                channel = 1
                isConflict = true
                conflictCount++
            }

            // 单机 QoS
            const basePdr = isConflict ? 0.65 + Math.random() * 0.1 : (isNlos ? 0.82 + Math.random() * 0.1 : 0.93 + Math.random() * 0.06)
            const baseDelay = isConflict ? 45 + Math.random() * 20 : (isNlos ? 25 + Math.random() * 15 : 8 + Math.random() * 10)
            const baseThroughput = isConflict ? 50 + Math.random() * 30 : (isNlos ? 80 + Math.random() * 30 : 110 + Math.random() * 40)

            uavs.push({
                id: i,
                x: px,
                y: py,
                z: 30, // Added z property
                channel,
                is_conflict: isConflict,
                is_nlos: isNlos,
                is_active: true,
                pdr: Math.round(basePdr * 1000) / 1000,
                delay: Math.round(baseDelay * 10) / 10,
                throughput: Math.round(baseThroughput * 10) / 10,
                power: 20 - Math.random() * 5,
                interference: isConflict ? -50 - Math.random() * 20 : -95 - Math.random() * 15, // dBm
                rate: 54 // Added rate property
            })

        }

        // 全局 QoS
        const avgPdr = uavs.reduce((s, u) => s + (u.pdr || 0), 0) / NUM_UAVS
        const avgDelay = uavs.reduce((s, u) => s + (u.delay || 0), 0) / NUM_UAVS
        const avgThroughput = uavs.reduce((s, u) => s + (u.throughput || 0), 0) / NUM_UAVS

        // 拓扑数据
        const numLinks = Math.max(5, NUM_UAVS * 2 - conflictCount * 3 + Math.floor(Math.random() * 5 - 2))
        const connectivity = Math.max(0.5, Math.min(1.0, 1.0 - conflictCount * 0.08 - Math.random() * 0.05))

        frames.push({
            tick,
            QoS: {
                total_pdr: Math.round(avgPdr * 1000) / 1000,
                p99_latency_ms: Math.round(avgDelay * 1.5 * 10) / 10,
                throughput_mbps: Math.round(avgThroughput * 10) / 10,
                algo_compute_time_ms: Math.round((1.5 + Math.random() * 2) * 10) / 10
            },
            uav_nodes: uavs,
            topology: {
                num_links: numLinks,
                connectivity: Math.round(connectivity * 1000) / 1000
            },
            conflicts: conflictCount
        })
    }

    return frames
}

/** 基准测试模拟数据 */
export function generateBenchmarkData() {
    return [
        { algorithm: 'Graph Coloring', scenario: 'Moderate', formation: 'V-Formation', throughput: 0.92, latency: 0.88, jitter: 0.85, pdr: 0.95, topology_stability: 0.91 },
        { algorithm: 'Greedy', scenario: 'Moderate', formation: 'V-Formation', throughput: 0.75, latency: 0.70, jitter: 0.65, pdr: 0.78, topology_stability: 0.72 },
        { algorithm: 'Static', scenario: 'Moderate', formation: 'V-Formation', throughput: 0.60, latency: 0.55, jitter: 0.50, pdr: 0.62, topology_stability: 0.58 },
    ]
}
