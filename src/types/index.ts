/* ── 数据类型定义 ── */

// Re-export cooperative and non-cooperative types
export * from './cooperative'
export * from './nonCooperative'

import type { CooperativeData } from './cooperative'
import type { NonCooperativeData } from './nonCooperative'

/** 单架无人机帧状态 */
export interface UAVNode {
    id: number
    x: number
    y: number
    z: number
    channel: number       // 0/1/2 → CH1/CH2/CH3
    is_conflict: boolean
    is_nlos: boolean
    is_active: boolean
    node_type?: number    // 0=正常编队无人机, 1=黑飞无人机 (nodeId>=1000)
    delay?: number
    pdr?: number
    throughput?: number
    power?: number        // dBm
    rate?: number
    neighbors?: number    // 邻居数量
    interference?: number // 干扰强度
    sinr?: number         // 最差 SINR (dB)
    heading?: number      // 航向角 0-360°，由相邻帧位置差计算
    speed?: number        // m/s
    conflict_source?: 'physical' | 'explicit' | 'geometric' | 'none'
}

/** 全局 QoS 指标 */
export interface QoSMetrics {
    total_pdr: number
    p99_latency_ms: number
    throughput_mbps: number
    algo_compute_time_ms: number
}

/** 一帧完整数据 */
export interface FrameData {
    tick: number
    QoS: QoSMetrics
    uav_nodes: UAVNode[]
    topology: {
        num_links: number
        connectivity: number
    }
    conflicts: number
    links?: string[]     // format: e.g. "Node0-Node1", or "0-1" depending on backend
    transmissions?: any[]
}

/** 建筑物障碍定义 */
export interface BuildingBlock {
    x: number
    y: number
    width: number
    depth: number
    height: number
}

/** GeoJSON 坐标点 */
export interface GeoJsonPoint {
    x: number
    y: number
}

/** GeoJSON 建筑物（来自后端 /api/upload_geojson 或 /api/map_data） */
export interface GeoJsonBuilding {
    xMin?: number
    xMax?: number
    yMin?: number
    yMax?: number
    zMin?: number
    zMax: number
    polygon?: GeoJsonPoint[]     // 单路径（普通建筑）
    polygons?: GeoJsonPoint[][]  // 多路径（复杂建筑/带洞）
}

/** GeoJSON 地图完整数据 */
export interface GeoJsonMapData {
    map_width: number
    map_height: number
    buildings: GeoJsonBuilding[]
}

/** 场景配置 */
export interface SceneConfig {
    buildings: BuildingBlock[]
    gridSize: number
}

/** UAV 3D 模型 userData 类型（挂载在 THREE.Group.userData 上） */
export interface UAVMeshUserData {
    uavId: number
    isRogue: boolean
    yaw: number
    channelAura: any | null     // THREE.Mesh
    powerShield: any | null     // THREE.Mesh
    hull: any | null            // THREE.Mesh (黑飞外壳)
    glowSprite: any | null      // THREE.Sprite (发光光晕)
    propellers: any[]           // THREE.Mesh[] (桨叶，动画旋转用)
    motorBlurDiscs: any[]       // THREE.Mesh[] (高转速模糊圆盘)
}

/** 科研雷达图指标 */
export interface BenchmarkMetrics {
    algorithm: string
    scenario: string
    formation: string
    throughput: number
    latency: number
    jitter: number
    pdr: number
    topology_stability: number
}

/** CSV Row Types */
export interface QoSRow {
    time: number
    avg_pdr: number
    avg_throughput: number
    avg_delay: number
    [key: string]: number   // uavX_pdr, uavX_delay, uavX_throughput
}

export interface ResourceRow {
    time: number
    [key: string]: number   // uavX_channel, uavX_power, uavX_rate
}

export interface TopologyRow {
    time: number
    num_links: number
    connectivity: number
}

export interface PositionRow {
    time_s: number
    nodeId: number
    x: number
    y: number
    z: number
}

export interface FlowStatRow {
    FlowId: number
    Src: number
    Dest: number
    Tx: number
    Rx: number
    LossRate: number
}

/* ── /api/results/<task_id>/frontend 响应结构 ── */

/** meta 层 */
export interface FrontendResponseMeta {
    taskId: string
    operationMode: 'cooperative' | 'non_cooperative'
    sceneType: string
    difficulty: string
    communicationMode?: string
    formation: string
}

/** shared 数据层 */
export interface SharedData {
    environment_summary?: Record<string, any>
    request_metadata?: Record<string, any>
    positions?: any[]
    transmissions?: any[]
    topology_links?: any[]
    topology_evolution?: any[]
    topology_detailed?: any[]
    resource_detailed?: any[]
    qos?: any[]
    flow_summary?: any[]
}

/** /api/results/<task_id>/frontend 完整响应 data 层 */
export interface FrontendResponseData {
    meta: FrontendResponseMeta
    shared: SharedData
    cooperative: CooperativeData
    non_cooperative: NonCooperativeData
    manifest: Record<string, any>
}

/** /api/results/<task_id>/frontend 外层 */
export interface FrontendResponse {
    status: 'RUNNING' | 'SUCCESS' | 'FAILED'
    data?: FrontendResponseData
    error?: string
}

/** /api/results/<task_id>/manifest 响应 */
export interface ManifestResponse {
    status: string
    data?: {
        taskId: string
        outputDir: string
        operationMode: string
        sceneType: string
        difficulty: string
        communicationMode?: string
        formation: string
        sharedDatasets: string[]
        cooperativeDatasets: string[]
        nonCooperativeDatasets: string[]
        availableFiles: string[]
    }
}

/** 前端状态分层 - 运行元信息 */
export interface RunMeta {
    taskId: string
    operationMode: 'cooperative' | 'non_cooperative'
    sceneType: string
    difficulty: string
    formation: string
    communicationMode?: string
}

/** 前端状态分层 - 工作区数据 */
export interface WorkspaceData {
    shared: SharedData
    cooperative: CooperativeData
    nonCooperative: NonCooperativeData
}

