/**
 * 场景状态管理 — ScenarioEditor 和 CenterSandbox 共享
 */
import { reactive, ref, watch } from 'vue'
import type { SceneConfig, GeoJsonMapData, BuildingBlock } from '../types'
import { defaultScene, defaultBuildings } from '../data/mockData'
import { currentScene } from './useAppMode'

// 生成随机的树林地形 (依据现实热带雨林高度比例进行调整)
function generateForest(): BuildingBlock[] {
    const trees: BuildingBlock[] = []
    // Seeded-like generation for stability
    for(let i=0; i<45; i++) {
        trees.push({
            x: 20 + (Math.sin(i*12.3) * 0.5 + 0.5) * 560,
            y: 20 + (Math.cos(i*17.5) * 0.5 + 0.5) * 560,
            width: 15 + Math.random() * 10,
            depth: 15 + Math.random() * 10,
            height: 25 + Math.random() * 35 // 高度由 60~120m 修改为更真实的热带雨林比例 (25~60m 左右)
        })
    }
    return trees;
}

// 生成野外山丘地形 (宽矮)
function generateWild(): BuildingBlock[] {
    const hills: BuildingBlock[] = []
    for(let i=0; i<15; i++) {
        hills.push({
            x: 50 + (Math.sin(i*8.1) * 0.5 + 0.5) * 450,
            y: 50 + (Math.cos(i*2.2) * 0.5 + 0.5) * 450,
            width: 60 + Math.random() * 80,
            depth: 60 + Math.random() * 80,
            height: 30 + Math.random() * 50
        })
    }
    return hills;
}

// 获取当前场景类型对应的默认建筑
function getPresetsForScene(scene: string) {
    switch(scene) {
        case 'forest': return generateForest();
        case 'open': return []; // 空旷场地无建筑
        case 'wild': return generateWild();
        case 'city': 
        default: return [...defaultBuildings];
    }
}

// 当前活跃场景（响应式，修改后 3D 沙盘自动刷新）
export const activeScene = reactive<SceneConfig>({
    buildings: getPresetsForScene(currentScene.value),
    gridSize: defaultScene.gridSize
})

// 起点和终点坐标
export const missionWaypoints = reactive({
    start: '0,0,30',
    target: '500,500,30'
})

// 交互状态 (如：从 3D 沙盘点选坐标)
export const interactionState = reactive({
    mode: 'none' as 'none' | 'setStart' | 'setTarget'
})

// 场景版本号 — 每次修改递增，触发 3D 重建
export const sceneVersion = ref(0)

// 仿真算法策略 (static | dynamic) — 影响 QoS 的恢复效果
export const simulationStrategy = ref<'static' | 'dynamic'>('dynamic')

export function applyScene(config: SceneConfig) {
    activeScene.buildings = [...config.buildings]
    activeScene.gridSize = config.gridSize
    sceneVersion.value++
}

export function resetScene() {
    activeScene.buildings = [...defaultScene.buildings]
    activeScene.gridSize = defaultScene.gridSize
    sceneVersion.value++
}

/** 清空场景 — 移除所有建筑 */
export function clearScene() {
    activeScene.buildings = []
    sceneVersion.value++
}

// ── GeoJSON 地图状态 ──────────────────────────────────────
/** 当前场景模式：manual = 手动放置，geojson = GeoJSON 真实地图 */
export const sceneMode = ref<'manual' | 'geojson'>('manual')

/** GeoJSON 地图数据（来自后端解析） */
export const geojsonMapData = ref<GeoJsonMapData | null>(null)

/** 当前加载的 GeoJSON 地图名称 */
export const geojsonMapName = ref<string>('')

/**
 * 应用 GeoJSON 地图并切换到 geojson 模式，触发 3D 重建
 */
export function applyGeoJsonMap(mapName: string, data: GeoJsonMapData) {
    geojsonMapName.value = mapName
    geojsonMapData.value = data
    sceneMode.value = 'geojson'

    // Auto-set start/target points based on map dimensions
    if (data.map_width && data.map_height) {
        missionWaypoints.start = '0,0,30'
        missionWaypoints.target = `${Math.round(data.map_width)},${Math.round(data.map_height)},30`
    }

    sceneVersion.value++
}

/**
 * 切回手动放置模式
 */
export function switchToManualMode() {
    sceneMode.value = 'manual'
    geojsonMapData.value = null
    geojsonMapName.value = ''
    sceneVersion.value++
}

// 监听入口页面场景选择的变化，动态更新当前障碍物环境
// 置于文件末尾避免访问未初始化的依赖 (sceneMode, sceneVersion) 导致的 ReferenceError
watch(currentScene, (newScene) => {
    if (sceneMode.value === 'manual') {
        activeScene.buildings = getPresetsForScene(newScene);
        sceneVersion.value++;
    }
}, { immediate: true })
