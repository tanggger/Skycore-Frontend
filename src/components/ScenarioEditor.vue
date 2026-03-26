<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import type { BuildingBlock, SceneConfig, GeoJsonMapData, GeoJsonBuilding, GeoJsonPoint } from '../types'
import { applyScene, clearScene, resetScene, activeScene, applyGeoJsonMap, switchToManualMode, geojsonMapData, geojsonMapName, sceneMode } from '../composables/useScene'
import { apiService } from '../services/apiService'
import { currentScene } from '../composables/useAppMode'

const emit = defineEmits<{
  (e: 'close'): void
}>()

// ── Refs ──
const containerRef = ref<HTMLDivElement | null>(null)
const GRID = 600

const mode = ref<'building'>('building')
const buildingWidth = ref(60)
const buildingDepth = ref(60)
const buildingHeight = ref(80)

const buildings = reactive<BuildingBlock[]>([])
const mapList = ref<string[]>([])

// ── 编辑器顶部 Tab：手动编辑 / GeoJSON 导入 ──
const editorTab = ref<'manual' | 'geojson'>('manual')

// ── GeoJSON 导入状态 ──
const geojsonFile = ref<File | null>(null)
const geojsonInputMapName = ref('')
const geojsonFetchName = ref('')
const geojsonLoading = ref(false)
const geojsonError = ref('')
const geojsonSuccess = ref('')

function onGeoJsonFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  geojsonFile.value = input.files?.[0] ?? null
  geojsonError.value = ''
  geojsonSuccess.value = ''
  // 自动填充地图名（取文件名去掉扩展名）
  if (geojsonFile.value && !geojsonInputMapName.value) {
    geojsonInputMapName.value = geojsonFile.value.name.replace(/\.geojson$/i, '')
  }
}

async function handleGeoJsonUpload() {
  if (!geojsonFile.value) { geojsonError.value = '请先选择 .geojson 文件'; return }
  if (!geojsonInputMapName.value.trim()) { geojsonError.value = '请输入地图名称'; return }
  geojsonLoading.value = true
  geojsonError.value = ''
  geojsonSuccess.value = ''
  try {
    const data = await apiService.uploadGeoJsonMap(geojsonFile.value, geojsonInputMapName.value.trim())
    applyGeoJsonMap(geojsonInputMapName.value.trim(), data)
    geojsonSuccess.value = `✓ 已加载 ${data.buildings.length} 栋建筑 (${data.map_width.toFixed(0)}×${data.map_height.toFixed(0)} m)`
  } catch (err: any) {
    geojsonError.value = err.message || '上传失败'
  } finally {
    geojsonLoading.value = false
  }
}

async function handleGeoJsonFetch() {
  if (!geojsonFetchName.value.trim()) { geojsonError.value = '请输入地图名称'; return }
  geojsonLoading.value = true
  geojsonError.value = ''
  geojsonSuccess.value = ''
  try {
    const data = await apiService.fetchGeoJsonMapData(geojsonFetchName.value.trim())
    applyGeoJsonMap(geojsonFetchName.value.trim(), data)
    geojsonSuccess.value = `✓ 已加载 ${data.buildings.length} 栋建筑 (${data.map_width.toFixed(0)}×${data.map_height.toFixed(0)} m)`
  } catch (err: any) {
    geojsonError.value = err.message || '获取失败'
  } finally {
    geojsonLoading.value = false
  }
}

function handleSwitchToManual() {
  stopPlacement()
  switchToManualMode()
  geojsonSuccess.value = ''
  geojsonError.value = ''
  editorTab.value = 'manual'
}

function handleSwitchToGeoJson() {
  stopPlacement()
  editorTab.value = 'geojson'
}

// ── 本地 GeoJSON 解析（离线） ──
async function parseLocalGeoJson(file: File): Promise<GeoJsonMapData> {
  const text = await file.text()
  const geojson = JSON.parse(text)

  if (!geojson.features || !Array.isArray(geojson.features)) {
    throw new Error('无效的 GeoJSON 文件：缺少 features 数组')
  }

  // 1. 收集所有坐标以确定边界和中心点
  const allLngs: number[] = []
  const allLats: number[] = []

  for (const feature of geojson.features) {
    const geom = feature.geometry
    if (!geom) continue
    let coordSets: number[][][] = []
    if (geom.type === 'Polygon') {
      coordSets = geom.coordinates as number[][][]
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates as number[][][][]) {
        coordSets.push(...poly)
      }
    } else {
      continue
    }
    for (const ring of coordSets) {
      for (const pt of ring) {
        allLngs.push(pt[0])
        allLats.push(pt[1])
      }
    }
  }

  if (allLngs.length === 0) {
    throw new Error('GeoJSON 中未找到任何 Polygon/MultiPolygon 要素')
  }

  const minLng = Math.min(...allLngs)
  const maxLng = Math.max(...allLngs)
  const minLat = Math.min(...allLats)
  const maxLat = Math.max(...allLats)
  const avgLat = (minLat + maxLat) / 2

  // 等距圆柱投影系数
  const mPerDegLng = 111320 * Math.cos(avgLat * Math.PI / 180)
  const mPerDegLat = 110540

  const mapWidth = (maxLng - minLng) * mPerDegLng
  const mapHeight = (maxLat - minLat) * mPerDegLat

  // 2. 遍历每个 feature 生成建筑
  const buildings: GeoJsonBuilding[] = []

  for (const feature of geojson.features) {
    const geom = feature.geometry
    if (!geom) continue
    const props = feature.properties || {}

    // 只处理建筑类型
    if (!props.building && !props['building:part']) continue

    let polyCoords: number[][][][] = []
    if (geom.type === 'Polygon') {
      polyCoords = [geom.coordinates as number[][][]]
    } else if (geom.type === 'MultiPolygon') {
      polyCoords = geom.coordinates as number[][][][]
    } else {
      continue
    }

    // 提取高度（OSM 数据多数建筑缺少高度标注，默认取 35m 以构成有效障碍）
    let height = 35 // 默认高度
    if (props.height) {
      const h = parseFloat(props.height)
      if (!isNaN(h) && h > 0) height = h
    } else if (props['building:levels']) {
      const levels = parseFloat(props['building:levels'])
      if (!isNaN(levels) && levels > 0) height = levels * 3.5 // 每层 3.5m
    }

    // 对高度施加竖向夸张系数，使建筑物在沙盘中形成有效遮挡
    height *= 2.0

    for (const polygon of polyCoords) {
      const polygons: GeoJsonPoint[][] = []

      for (const ring of polygon) {
        const pts: GeoJsonPoint[] = []
        for (const coord of ring) {
          pts.push({
            x: (coord[0] - minLng) * mPerDegLng,
            y: (coord[1] - minLat) * mPerDegLat,
          })
        }
        polygons.push(pts)
      }

      if (polygons.length > 0 && polygons[0].length >= 3) {
        buildings.push({
          zMax: height,
          polygon: polygons[0],
          polygons: polygons.length > 1 ? polygons : undefined,
        })
      }
    }
  }

  if (buildings.length === 0) {
    throw new Error('未在 GeoJSON 中找到有效的建筑物要素（需要含 building 属性的 Polygon）')
  }

  return { map_width: mapWidth, map_height: mapHeight, buildings }
}

async function handleLocalGeoJsonParse() {
  if (!geojsonFile.value) { geojsonError.value = '请先选择 .geojson 文件'; return }
  const mapName = geojsonInputMapName.value.trim() || geojsonFile.value.name.replace(/\.geojson$/i, '')
  geojsonLoading.value = true
  geojsonError.value = ''
  geojsonSuccess.value = ''
  try {
    const data = await parseLocalGeoJson(geojsonFile.value)
    applyGeoJsonMap(mapName, data)
    geojsonSuccess.value = `✓ 本地解析完成：${data.buildings.length} 栋建筑 (${data.map_width.toFixed(0)}×${data.map_height.toFixed(0)} m)`
  } catch (err: any) {
    geojsonError.value = err.message || '本地解析失败'
  } finally {
    geojsonLoading.value = false
  }
}

// Placement state
const isPlacing = ref(false)

// ── Three.js variables ──
let threeScene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let animId = 0
let groundPlane: THREE.Mesh
let gridHelper: THREE.GridHelper
let sceneGroup: THREE.Group  // holds placed buildings & zones
let ghostMesh: THREE.Mesh | null = null

// Camera orbit
let isDragging = false
let prevMouse = { x: 0, y: 0 }
let cameraAngle = { theta: Math.PI * 0.25, phi: Math.PI * 0.3 }
let cameraDistance = 550
let cameraTarget = new THREE.Vector3(GRID / 2, 0, GRID / 2)

// Raycaster for mouse → ground intersection
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

// ── Camera controls ──
function updateCameraPosition() {
  if (!camera) return
  const x = cameraTarget.x + cameraDistance * Math.sin(cameraAngle.phi) * Math.cos(cameraAngle.theta)
  const y = cameraTarget.y + cameraDistance * Math.cos(cameraAngle.phi)
  const z = cameraTarget.z + cameraDistance * Math.sin(cameraAngle.phi) * Math.sin(cameraAngle.theta)
  camera.position.set(x, y, z)
  camera.lookAt(cameraTarget)
}

// ── Init Three.js Scene ──
function initScene() {
  if (!containerRef.value) return
  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight

  threeScene = new THREE.Scene()
  threeScene.fog = new THREE.FogExp2(0x040714, 0.0008)

  camera = new THREE.PerspectiveCamera(50, w / h, 1, 2000)
  updateCameraPosition()

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x040714)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  containerRef.value.appendChild(renderer.domElement)

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x1a2040, 1.5)
  threeScene.add(ambientLight)
  const dirLight = new THREE.DirectionalLight(0x4488cc, 0.8)
  dirLight.position.set(200, 400, 200)
  dirLight.castShadow = true
  threeScene.add(dirLight)
  const hemiLight = new THREE.HemisphereLight(0x0f1535, 0x000510, 0.6)
  threeScene.add(hemiLight)
  const pointLight1 = new THREE.PointLight(0x00f2ff, 0.4, 600)
  pointLight1.position.set(100, 100, 100)
  threeScene.add(pointLight1)

  // Ground plane with scene-aware color
  const isForest = currentScene.value === 'forest'
  const isWild = currentScene.value === 'wild'
  const gColor = isForest ? 0x051a0f : (isWild ? 0x1a1205 : 0x0a0e27)
  const gGrid = isForest ? 0x00ff88 : (isWild ? 0xfacc15 : 0x00f2ff)

  const groundGeo = new THREE.PlaneGeometry(GRID, GRID)
  const groundMat = new THREE.MeshStandardMaterial({
    color: gColor, roughness: 0.9, metalness: 0.1,
  })
  groundPlane = new THREE.Mesh(groundGeo, groundMat)
  groundPlane.rotation.x = -Math.PI / 2
  groundPlane.position.set(GRID / 2, -0.5, GRID / 2)
  groundPlane.receiveShadow = true
  threeScene.add(groundPlane)

  // Grid
  gridHelper = new THREE.GridHelper(GRID, 12, gGrid, gGrid)
  gridHelper.position.set(GRID / 2, 0, GRID / 2)
  ;(gridHelper.material as THREE.Material).opacity = 0.08
  ;(gridHelper.material as THREE.Material).transparent = true
  threeScene.add(gridHelper)

  // Border
  const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(GRID, 0.5, GRID))
  const borderMat = new THREE.LineBasicMaterial({ color: gGrid, transparent: true, opacity: 0.15 })
  const borderLine = new THREE.LineSegments(borderGeo, borderMat)
  borderLine.position.set(GRID / 2, 0, GRID / 2)
  threeScene.add(borderLine)

  // Scene group for placed objects
  sceneGroup = new THREE.Group()
  threeScene.add(sceneGroup)

  // Load current scene buildings into editor
  for (const b of activeScene.buildings) {
    buildings.push({ ...b })
  }
  rebuildPlacedObjects()

  // Events
  renderer.domElement.addEventListener('mousedown', onMouseDown)
  renderer.domElement.addEventListener('mousemove', onMouseMove)
  renderer.domElement.addEventListener('mouseup', onMouseUp)
  renderer.domElement.addEventListener('wheel', onWheel)
  renderer.domElement.addEventListener('click', onClickPlace)
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault())
}

// ── Build placed objects in 3D ──
function rebuildPlacedObjects() {
  if (!sceneGroup) return
  // Clear
  while (sceneGroup.children.length > 0) {
    const child = sceneGroup.children[0]
    sceneGroup.remove(child)
    if ((child as any).geometry) (child as any).geometry.dispose()
    if ((child as any).material) {
      const mat = (child as any).material
      if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose())
      else mat.dispose()
    }
  }

  // GeoJSON Mode Preview
  if (sceneMode.value === 'geojson' && geojsonMapData.value) {
    createGeoJsonBuildings()
  } else {
    // Manual Mode
    for (const b of buildings) {
      addBuildingMesh(b)
    }
  }
}

function createGeoJsonBuildings() {
  const mapData = geojsonMapData.value
  if (!mapData || !mapData.buildings.length) return

  // 计算缩放比例
  const scale = Math.min(
    GRID / Math.max(mapData.map_width, 1),
    GRID / Math.max(mapData.map_height, 1)
  )
  const offsetX = (GRID - mapData.map_width * scale) / 2
  const offsetZ = (GRID - mapData.map_height * scale) / 2

  const MAX_LABELED = 100

  for (let idx = 0; idx < mapData.buildings.length; idx++) {
    const b = mapData.buildings[idx]
    const bHeight = (b.zMax ?? 20) * scale

    const pathList = b.polygons ?? (b.polygon ? [b.polygon] : null)
    if (!pathList || pathList.length === 0) continue

    const shape = new THREE.Shape()
    let isFirst = true

    for (const pts of pathList) {
      if (!pts || pts.length < 3) continue
      if (isFirst) {
        shape.moveTo(
          pts[0].x * scale + offsetX, 
          (mapData.map_height - pts[0].y) * scale + offsetZ
        )
        for (let i = 1; i < pts.length; i++) {
          shape.lineTo(
            pts[i].x * scale + offsetX, 
            (mapData.map_height - pts[i].y) * scale + offsetZ
          )
        }
        shape.closePath()
        isFirst = false
      } else {
        const hole = new THREE.Path()
        hole.moveTo(
          pts[0].x * scale + offsetX, 
          (mapData.map_height - pts[0].y) * scale + offsetZ
        )
        for (let i = 1; i < pts.length; i++) {
          hole.lineTo(
            pts[i].x * scale + offsetX, 
            (mapData.map_height - pts[i].y) * scale + offsetZ
          )
        }
        hole.closePath()
        shape.holes.push(hole)
      }
    }

    const geo = new THREE.ExtrudeGeometry(shape, { depth: bHeight, bevelEnabled: false })
    const mat4 = new THREE.Matrix4()
    mat4.set(
      1, 0, 0, 0,
      0, 0, 1, 0,
      0, 1, 0, 0,
      0, 0, 0, 1
    )
    geo.applyMatrix4(mat4)

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x0a1128, emissive: 0x001133, roughness: 0.1, metalness: 0.8,
      clearcoat: 1.0, clearcoatRoughness: 0.1, transparent: true, opacity: 0.9,
    })

    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    sceneGroup.add(mesh)

    const edgeGeo = new THREE.EdgesGeometry(geo)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.2 })
    const edges = new THREE.LineSegments(edgeGeo, edgeMat)
    sceneGroup.add(edges)

    if (idx < MAX_LABELED) {
      const firstPts = pathList[0]
      const cx = firstPts.reduce((s, p) => s + p.x, 0) / firstPts.length * scale + offsetX
      const cz = firstPts.reduce((s, p) => s + p.y, 0) / firstPts.length * scale + offsetZ
      const label = createTextSprite(`${Math.round(b.zMax ?? 20)}m`, '#00f2ff')
      label.position.set(cx, bHeight + 6, cz)
      label.scale.set(16, 8, 1)
      sceneGroup.add(label)
    }
  }
}

function addBuildingMesh(b: BuildingBlock) {
  const isForest = currentScene.value === 'forest'
  const isWild = currentScene.value === 'wild'
  const h = b.height
  const visualScale = (isForest || isWild) ? 2.5 : 1.0
  const renderH = h * visualScale

  const bColor = isForest ? 0x0a2618 : (isWild ? 0x261a0a : 0x0a1128)
  const eColor = isForest ? 0x00ff88 : (isWild ? 0xfacc15 : 0x00f2ff)

  const mat = new THREE.MeshPhysicalMaterial({
    color: bColor,
    emissive: isForest || isWild ? 0x000000 : 0x001133,
    roughness: isForest || isWild ? 0.9 : 0.1,
    metalness: isForest || isWild ? 0.05 : 0.8,
    clearcoat: isForest || isWild ? 0.0 : 1.0,
    clearcoatRoughness: 0.1,
    transparent: true,
    opacity: isForest || isWild ? 1.0 : 0.9,
  })
  const edgeMat = new THREE.LineBasicMaterial({
    color: eColor, transparent: true, opacity: 0.25,
  })

  if (isForest) {
    // Tree: trunk + 3 layered cones
    const trunkH = Math.max(8, renderH * 0.2)
    const trunkGeo = new THREE.CylinderGeometry(2, 3, trunkH, 8)
    const trunk = new THREE.Mesh(trunkGeo, mat)
    trunk.scale.set(1, 1, 1)
    trunk.position.set(b.x + b.width / 2, trunkH / 2, b.y + b.depth / 2)
    trunk.castShadow = true
    sceneGroup.add(trunk)

    const leafMat = mat.clone()
    leafMat.color.setHex(0x0a3318)
    const leavesGeo = new THREE.ConeGeometry(1, 1, 8)

    for (let i = 0; i < 3; i++) {
      const leafH = renderH * 0.4
      const leafW = b.width * (1 - i * 0.25)
      const leaves = new THREE.Mesh(leavesGeo, leafMat)
      leaves.scale.set(leafW, leafH, leafW)
      leaves.position.set(b.x + b.width / 2, trunkH + i * (leafH * 0.5) + leafH / 2, b.y + b.depth / 2)
      leaves.castShadow = true
      sceneGroup.add(leaves)
      // edges
      const edgeG = new THREE.EdgesGeometry(leavesGeo)
      const edgesM = new THREE.LineSegments(edgeG, edgeMat)
      edgesM.scale.copy(leaves.scale)
      edgesM.position.copy(leaves.position)
      sceneGroup.add(edgesM)
    }

    // Height label
    const labelSprite = createTextSprite(`${Math.round(h)}m`, '#00ff88')
    labelSprite.position.set(b.x + b.width / 2, renderH + 8, b.y + b.depth / 2)
    labelSprite.scale.set(20, 10, 1)
    sceneGroup.add(labelSprite)

  } else if (isWild) {
    // Low-poly hill
    const r = Math.max(b.width, b.depth) * 1.5
    const segs = 4 + Math.floor(Math.abs(Math.sin(b.x * 0.1)) * 3)
    const hillGeo = new THREE.ConeGeometry(r, renderH, segs)
    const hillMat = mat.clone()
    hillMat.color.setHex(0x2a1d10)
    hillMat.flatShading = true
    hillMat.roughness = 1.0
    const hill = new THREE.Mesh(hillGeo, hillMat)
    hill.rotation.y = Math.abs(Math.sin(b.y * 0.07)) * Math.PI
    hill.position.set(b.x + b.width / 2, renderH / 2, b.y + b.depth / 2)
    hill.castShadow = true
    hill.receiveShadow = true
    sceneGroup.add(hill)
    const edgeG = new THREE.EdgesGeometry(hillGeo)
    const edgesM = new THREE.LineSegments(edgeG, edgeMat)
    edgesM.rotation.y = hill.rotation.y
    edgesM.position.copy(hill.position)
    sceneGroup.add(edgesM)

    // Height label
    const labelSprite = createTextSprite(`${Math.round(h)}m`, '#facc15')
    labelSprite.position.set(b.x + b.width / 2, renderH + 8, b.y + b.depth / 2)
    labelSprite.scale.set(20, 10, 1)
    sceneGroup.add(labelSprite)

  } else {
    // City/default: box
    const geo = new THREE.BoxGeometry(b.width, renderH, b.depth)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(b.x + b.width / 2, renderH / 2, b.y + b.depth / 2)
    mesh.castShadow = true
    mesh.receiveShadow = true
    sceneGroup.add(mesh)

    const edgeGeo = new THREE.EdgesGeometry(geo)
    const edges = new THREE.LineSegments(edgeGeo, edgeMat)
    edges.position.copy(mesh.position)
    sceneGroup.add(edges)

    // Height label
    const labelSprite = createTextSprite(`${Math.round(b.height)}m`, '#00f2ff')
    labelSprite.position.set(b.x + b.width / 2, renderH + 8, b.y + b.depth / 2)
    labelSprite.scale.set(20, 10, 1)
    sceneGroup.add(labelSprite)
  }
}

function createTextSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.font = 'bold 48px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 64)
  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true })
  return new THREE.Sprite(mat)
}

// ── Ghost mesh management ──
function createGhostBuilding() {
  removeGhost()
  const w = buildingWidth.value
  const d = buildingDepth.value
  const h = buildingHeight.value * 0.8
  const geo = new THREE.BoxGeometry(w, h, d)
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00f2ff,
    transparent: true,
    opacity: 0.25,
    wireframe: false,
  })
  ghostMesh = new THREE.Mesh(geo, mat)
  ghostMesh.position.set(GRID / 2, h / 2, GRID / 2)
  threeScene.add(ghostMesh)

  // Ghost edges
  const edgeGeo = new THREE.EdgesGeometry(geo)
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.7 })
  const edges = new THREE.LineSegments(edgeGeo, edgeMat)
  ghostMesh.add(edges)
}

function removeGhost() {
  if (ghostMesh) {
    threeScene.remove(ghostMesh)
    ghostMesh.geometry.dispose()
    ;(ghostMesh.material as THREE.Material).dispose()
    ghostMesh = null
  }
}

// ── Start / Stop placement ──
function startPlacement() {
  isPlacing.value = true
  createGhostBuilding()
  if (renderer) renderer.domElement.style.cursor = 'crosshair'
}

function stopPlacement() {
  isPlacing.value = false
  removeGhost()
  if (renderer) renderer.domElement.style.cursor = 'grab'
}

// ── Get ground intersection ──
function getGroundPoint(e: MouseEvent): THREE.Vector3 | null {
  if (!renderer || !camera) return null
  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObject(groundPlane)
  if (intersects.length > 0) {
    const p = intersects[0].point
    // Clamp to grid bounds
    p.x = Math.max(0, Math.min(GRID, p.x))
    p.z = Math.max(0, Math.min(GRID, p.z))
    return p
  }
  return null
}

// ── Mouse events ──
function onMouseDown(e: MouseEvent) {
  if (isPlacing.value) return
  isDragging = true
  prevMouse = { x: e.clientX, y: e.clientY }
  if (renderer) renderer.domElement.style.cursor = 'grabbing'
}

function onMouseMove(e: MouseEvent) {
  if (isPlacing.value) {
    // Move ghost
    const point = getGroundPoint(e)
    if (point) {
      if (ghostMesh) {
        const h = buildingHeight.value * 0.8
        ghostMesh.position.set(point.x, h / 2, point.z)
      }
    }
    return
  }

  if (!isDragging) return
  const dx = e.clientX - prevMouse.x
  const dy = e.clientY - prevMouse.y
  prevMouse = { x: e.clientX, y: e.clientY }

  if (e.shiftKey) {
    // Pan
    const right = new THREE.Vector3()
    camera.getWorldDirection(right)
    right.y = 0; right.normalize()
    const forward = right.clone()
    right.cross(new THREE.Vector3(0, 1, 0))
    cameraTarget.add(right.multiplyScalar(-dx * 0.5))
    cameraTarget.add(forward.multiplyScalar(dy * 0.5))
  } else {
    // Orbit
    cameraAngle.theta -= dx * 0.005
    cameraAngle.phi = Math.max(0.15, Math.min(Math.PI / 2 - 0.05, cameraAngle.phi - dy * 0.005))
  }
  updateCameraPosition()
}

function onMouseUp() {
  isDragging = false
  if (!isPlacing.value && renderer) renderer.domElement.style.cursor = 'grab'
}

function onWheel(e: WheelEvent) {
  cameraDistance = Math.max(100, Math.min(1200, cameraDistance + e.deltaY * 0.5))
  updateCameraPosition()
}

function onClickPlace(e: MouseEvent) {
  if (!isPlacing.value) return
  const point = getGroundPoint(e)
  if (!point) return

  if (mode.value === 'building') {
    const w = buildingWidth.value
    const d = buildingDepth.value
    const h = buildingHeight.value
    const b: BuildingBlock = {
      x: point.x - w / 2,
      y: point.z - d / 2,
      width: w, depth: d, height: h
    }
    buildings.push(b)
    addBuildingMesh(b)
    // Recreate ghost for next placement (with potentially updated params)
    createGhostBuilding()
  }
}

// ── Watch param changes → update ghost ──
watch([buildingWidth, buildingDepth, buildingHeight], () => {
  if (isPlacing.value && mode.value === 'building' && ghostMesh) {
    const pos = ghostMesh.position.clone()
    createGhostBuilding()
    const h = buildingHeight.value * 0.8
    ghostMesh!.position.set(pos.x, h / 2, pos.z)
  }
})

// Watch scene mode changes for GeoJSON preview
watch([sceneMode, geojsonMapData], () => {
  rebuildPlacedObjects()
})

// Watch scene type changes to rebuild terrain accordingly
watch(currentScene, () => {
  rebuildPlacedObjects()
})

// ── Render loop ──
function animate() {
  animId = requestAnimationFrame(animate)
  if (renderer && threeScene && camera) {
    renderer.render(threeScene, camera)
  }
}

// ── Resize ──
function handleResize() {
  if (!containerRef.value || !renderer || !camera) return
  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

// ── Actions ──
function clearAll() {
  buildings.length = 0
  rebuildPlacedObjects()
  stopPlacement()
}

function removeBuilding(index: number) {
  buildings.splice(index, 1)
  rebuildPlacedObjects()
}

function applyToSandbox() {
  // 确保切换回手动模式，并清除 OSM 数据引用
  switchToManualMode()
  const config: SceneConfig = {
    buildings: [...buildings],
    gridSize: GRID
  }
  applyScene(config)
}

function exportScene() {
  const config: SceneConfig = {
    buildings: [...buildings],
    gridSize: GRID
  }
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'scene.json'; a.click()
  URL.revokeObjectURL(url)
}

function applyAndClose() {
  stopPlacement()
  applyToSandbox()
  emit('close')
}

function clearSceneAndClose() {
  stopPlacement()
  clearScene()
  emit('close')
}

function resetSceneAndClose() {
  stopPlacement()
  resetScene()
  emit('close')
}

function switchMode(_newMode: 'building') {
  mode.value = 'building'
  if (isPlacing.value) {
    createGhostBuilding()
  }
}

let resizeOb: ResizeObserver | null = null

onMounted(async () => {
  initScene()
  animate()
  resizeOb = new ResizeObserver(handleResize)
  if (containerRef.value) resizeOb.observe(containerRef.value)

  // 加载地图列表
  try {
    const list = await apiService.fetchMaps()
    mapList.value = list
  } catch (e) {
    console.error('Failed to load map list', e)
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animId)
  resizeOb?.disconnect()
  stopPlacement()
  renderer?.domElement.removeEventListener('mousedown', onMouseDown)
  renderer?.domElement.removeEventListener('mousemove', onMouseMove)
  renderer?.domElement.removeEventListener('mouseup', onMouseUp)
  renderer?.domElement.removeEventListener('wheel', onWheel)
  renderer?.domElement.removeEventListener('click', onClickPlace)
  renderer?.dispose()
})
</script>

<template>
  <div class="editor-overlay" @click.self="emit('close')">
    <div class="editor-panel glass-panel">
      <div class="editor-header">
        <div class="section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none;">
          三维场景编辑器
        </div>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>

      <div class="editor-body">
        <!-- Left: 3D Viewport -->
        <div ref="containerRef" class="viewport-3d">
          <!-- GeoJSON 模式覆盖提示 -->
          <div v-if="sceneMode === 'geojson'" class="osm-viewport-badge">
            🗺 GeoJSON 模式 — {{ geojsonMapName }}
          </div>
        </div>

        <!-- Right: Controls Panel -->
        <div class="controls-panel">
          <!-- 顶部 Tab 切换：手动编辑 / GeoJSON 导入 -->
          <div class="editor-tab-row">
            <button class="tab-btn" :class="{ active: editorTab === 'manual' }" @click="handleSwitchToManual">
              ✏️ 手动编辑
            </button>
            <button class="tab-btn" :class="{ active: editorTab === 'geojson' }" @click="handleSwitchToGeoJson">
              🗺 GeoJSON 导入
            </button>
          </div>

          <!-- ───── 手动编辑面板 ───── -->
          <template v-if="editorTab === 'manual'">
            <!-- Mode switcher -->
            <div class="editor-tools">
              <button class="tool-btn" :class="{ active: mode === 'building' }" @click="switchMode('building')">
                🏢 建筑物
              </button>
            </div>

            <!-- Building params -->
            <div class="param-group">
              <div class="param-row">
                <label>长度(X)</label>
                <input type="range" v-model.number="buildingWidth" min="20" max="200" step="5" />
                <span class="param-val">{{ buildingWidth }}m</span>
              </div>
              <div class="param-row">
                <label>宽度(Z)</label>
                <input type="range" v-model.number="buildingDepth" min="20" max="200" step="5" />
                <span class="param-val">{{ buildingDepth }}m</span>
              </div>
              <div class="param-row">
                <label>高度(Y)</label>
                <input type="range" v-model.number="buildingHeight" min="20" max="200" step="5" />
                <span class="param-val">{{ buildingHeight }}m</span>
              </div>
            </div>

            <!-- Placement toggle -->
            <button
              class="place-btn"
              :class="{ active: isPlacing }"
              @click="isPlacing ? stopPlacement() : startPlacement()"
            >
              <span v-if="isPlacing">⬛ 停止放置</span>
              <span v-else>➕ 开始放置</span>
            </button>

            <div class="editor-hint" v-if="isPlacing">
              🖱 移动鼠标定位 → 单击放置建筑
              <span class="drawing-badge">放置中...</span>
            </div>
            <div class="editor-hint" v-else>
              🖱 拖拽旋转 | Shift+拖拽平移 | 滚轮缩放
            </div>

            <!-- Object list -->
            <div class="obj-list">
              <div class="obj-list-header">已放置对象</div>
              <div v-if="buildings.length === 0" class="obj-list-empty">
                暂无对象
              </div>
              <div v-for="(b, i) in buildings" :key="'b'+i" class="obj-item building">
                <span>🏢 {{ Math.round(b.width) }}×{{ Math.round(b.depth) }}m H:{{ Math.round(b.height) }}m</span>
                <button class="obj-del" @click="removeBuilding(i)">✕</button>
              </div>
            </div>

            <!-- Actions -->
            <div class="action-btns">
              <button class="apply-btn" @click="applyAndClose">🚀 应用到 3D</button>
              <button class="export-btn" @click="exportScene">📤 导出</button>
            </div>

            <div class="scene-mgmt">
              <button class="mgmt-btn" @click="clearAll">🗑 清空编辑器</button>
              <button class="mgmt-btn danger" @click="clearSceneAndClose">🚫 清空 3D 场景</button>
              <button class="mgmt-btn" @click="resetSceneAndClose">🔄 恢复默认</button>
            </div>
          </template>

          <!-- ───── GeoJSON 导入面板 ───── -->
          <template v-else>
            <!-- 当前模式提示 -->
            <div class="osm-mode-badge" v-if="sceneMode === 'geojson'">
              🟢 当前使用 GeoJSON 模式：<strong>{{ geojsonMapName }}</strong>
              <button class="osm-switch-manual" @click="handleSwitchToManual">切换回手动</button>
            </div>
            <div class="osm-mode-badge inactive" v-else>
              ⚪ 当前为手动放置模式
            </div>

            <!-- 已加载地图信息 -->
            <div v-if="geojsonMapData && sceneMode === 'geojson'" class="osm-info-card">
              <div class="osm-info-row">
                <span class="osm-info-label">地图名称</span>
                <span class="osm-info-val">{{ geojsonMapName }}</span>
              </div>
              <div class="osm-info-row">
                <span class="osm-info-label">建筑数量</span>
                <span class="osm-info-val cyan">{{ geojsonMapData.buildings.length }} 栋</span>
              </div>
              <div class="osm-info-row">
                <span class="osm-info-label">沙盘尺寸</span>
                <span class="osm-info-val">{{ geojsonMapData.map_width.toFixed(0) }} × {{ geojsonMapData.map_height.toFixed(0) }} m</span>
              </div>
            </div>

            <div class="osm-divider">上传新 GeoJSON 文件</div>

            <!-- 文件上传 -->
            <div class="osm-upload-area">
              <label class="osm-file-label">
                <span v-if="geojsonFile">📄 {{ geojsonFile.name }}</span>
                <span v-else>📂 点击选择 .geojson 文件</span>
                <input type="file" accept=".geojson" @change="onGeoJsonFileChange" class="osm-file-input" />
              </label>
            </div>

            <div class="param-row">
              <label>地图名</label>
              <input
                type="text"
                v-model="geojsonInputMapName"
                placeholder="如：shanghai_cbd"
                class="osm-text-input"
              />
            </div>

            <div class="osm-btn-row">
              <button
                class="osm-action-btn"
                :disabled="geojsonLoading"
                @click="handleGeoJsonUpload"
              >
                <span v-if="geojsonLoading">⏳ 解析中...</span>
                <span v-else>⬆️ 上传并解析</span>
              </button>
              <button
                class="osm-action-btn local-parse-btn"
                :disabled="geojsonLoading"
                @click="handleLocalGeoJsonParse"
              >
                <span v-if="geojsonLoading">⏳ 解析中...</span>
                <span v-else>🖥 本地解析（离线）</span>
              </button>
            </div>

            <div class="osm-divider">或加载已有地图</div>

            <div class="param-row">
              <label>选择地图</label>
              <select
                v-model="geojsonFetchName"
                class="glass-select"
                style="flex: 1"
                @change="handleGeoJsonFetch"
              >
                <option value="" disabled>-- 请选择 --</option>
                <option v-for="m in mapList" :key="m" :value="m">{{ m }}</option>
              </select>
            </div>

            <button
              class="osm-action-btn secondary"
              :disabled="geojsonLoading"
              @click="handleGeoJsonFetch"
            >
              <span v-if="geojsonLoading">⏳ 加载中...</span>
              <span v-else>📥 加载地图</span>
            </button>

            <!-- 状态反馈 -->
            <div v-if="geojsonError" class="osm-feedback error">❌ {{ geojsonError }}</div>
            <div v-if="geojsonSuccess" class="osm-feedback success">{{ geojsonSuccess }}</div>

            <!-- 应用关闭 -->
            <button v-if="sceneMode === 'geojson'" class="apply-btn" style="margin-top:auto" @click="emit('close')">
              ✅ 确认并关闭
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(6px);
}
.editor-panel {
  width: 920px; max-width: 95vw; max-height: 90vh;
  padding: 20px; animation: slideUp 0.3s ease;
  display: flex; flex-direction: column;
}
@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.editor-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;
}
.close-btn {
  background: none; border: none; color: var(--text-dim);
  font-size: 16px; cursor: pointer; padding: 4px 8px;
}
.close-btn:hover { color: var(--text-primary); }

.editor-body {
  display: flex; gap: 16px; flex: 1; min-height: 0;
}

/* 3D Viewport */
.viewport-3d {
  flex: 1.4; min-height: 400px;
  background-color: var(--bg-deep); /* Use variable for dark background */
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  position: relative;
  cursor: grab;
}
.viewport-3d :deep(canvas) {
  display: block; width: 100% !important; height: 100% !important;
}

/* Controls */
.controls-panel {
  width: 280px; flex-shrink: 0;
  display: flex; flex-direction: column; gap: 8px;
  overflow-y: auto;
}

.editor-tools { display: flex; gap: 6px; }
.tool-btn {
  flex: 1; padding: 7px; background: var(--bg-card);
  border: 1px solid var(--glass-border); color: var(--text-secondary);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 12px;
  transition: all var(--transition-fast);
}
.tool-btn:hover { border-color: var(--cyan); color: var(--cyan); }
.tool-btn.active { border-color: var(--cyan); color: var(--cyan); background: var(--cyan-dim); }

.param-group { display: flex; flex-direction: column; gap: 4px; }
.param-row {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px;
  background: rgba(0, 242, 255, 0.03); border-radius: var(--radius-sm);
  border: 1px solid rgba(0, 242, 255, 0.06);
}
.param-row label {
  font-size: 11px; color: var(--text-dim); white-space: nowrap;
  font-family: var(--font-body); min-width: 48px;
}
.param-row input[type="range"] {
  flex: 1; accent-color: var(--cyan); height: 4px;
}
.param-val {
  font-family: var(--font-mono); font-size: 12px;
  color: var(--cyan); min-width: 44px; text-align: right;
}

.place-btn {
  padding: 8px 12px;
  background: linear-gradient(135deg, rgba(0, 242, 255, 0.1), rgba(168, 85, 247, 0.1));
  border: 1px solid var(--glass-border); color: var(--text-secondary);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 13px;
  transition: all var(--transition-fast);
}
.place-btn:hover {
  border-color: var(--cyan); color: var(--cyan);
  background: var(--cyan-dim);
}
.place-btn.active {
  border-color: var(--cyan); color: var(--cyan);
  background: var(--cyan-dim);
  animation: pulse 1.5s infinite;
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

.editor-hint {
  font-size: 11px; color: var(--text-dim);
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap;
}
.drawing-badge {
  display: inline-block; padding: 2px 8px; border-radius: 10px;
  background: rgba(0, 242, 255, 0.15); color: var(--cyan);
  font-size: 10px; animation: pulse 1s infinite;
}

/* Object list */
.obj-list {
  flex: 1; min-height: 60px; max-height: 180px;
  overflow-y: auto;
  border: 1px solid rgba(0, 242, 255, 0.06);
  border-radius: var(--radius-sm);
  padding: 6px;
}
.obj-list-header {
  font-size: 10px; color: var(--text-dim); text-transform: uppercase;
  letter-spacing: 1px; margin-bottom: 4px;
  font-family: var(--font-display);
}
.obj-list-empty {
  font-size: 11px; color: var(--text-dim); text-align: center; padding: 8px;
}
.obj-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 6px; margin-bottom: 2px;
  border-radius: 4px; font-size: 11px;
  font-family: var(--font-mono);
}
.obj-item.building {
  color: var(--cyan); background: rgba(0, 242, 255, 0.04);
}
.obj-item.zone {
  color: #ff6b6b; background: rgba(255, 59, 59, 0.04);
}
.obj-del {
  background: none; border: none; color: var(--text-dim);
  cursor: pointer; font-size: 12px; padding: 2px 4px;
  transition: color 0.15s;
}
.obj-del:hover { color: #ff3b3b; }

/* Action buttons */
.action-btns { display: flex; gap: 6px; }
.apply-btn {
  flex: 1; padding: 8px 12px;
  background: linear-gradient(135deg, rgba(0, 242, 255, 0.2), rgba(168, 85, 247, 0.2));
  border: 1px solid var(--cyan); color: var(--cyan);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 13px;
  transition: all var(--transition-fast);
}
.apply-btn:hover { background: var(--cyan-dim); box-shadow: var(--cyan-glow); }
.export-btn {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border); color: var(--text-secondary);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 12px;
  transition: all var(--transition-fast);
}
.export-btn:hover { border-color: var(--text-secondary); color: var(--text-primary); }

.scene-mgmt {
  display: flex; gap: 4px; flex-wrap: wrap;
  padding-top: 6px; border-top: 1px solid rgba(0, 242, 255, 0.06);
}
.mgmt-btn {
  flex: 1; padding: 5px 8px; min-width: 80px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--glass-border); color: var(--text-dim);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 10px;
  transition: all var(--transition-fast);
}
.mgmt-btn:hover { border-color: var(--text-secondary); color: var(--text-primary); }
.mgmt-btn.danger:hover { border-color: var(--red); color: var(--red); }

/* ── OSM Tab styles ── */
.editor-tab-row {
  display: flex; gap: 4px;
}
.tab-btn {
  flex: 1; padding: 7px 6px;
  background: var(--bg-card);
  border: 1px solid var(--glass-border); color: var(--text-secondary);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 12px;
  transition: all var(--transition-fast);
}
.tab-btn:hover { border-color: var(--cyan); color: var(--cyan); }
.tab-btn.active {
  border-color: var(--cyan); color: var(--cyan);
  background: var(--cyan-dim);
}

.osm-viewport-badge {
  position: absolute; top: 8px; left: 8px;
  padding: 4px 10px;
  background: rgba(0, 242, 255, 0.15);
  border: 1px solid var(--cyan);
  border-radius: var(--radius-sm);
  color: var(--cyan); font-size: 11px;
  font-family: var(--font-mono);
  pointer-events: none;
}

.osm-mode-badge {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 4px;
  padding: 6px 8px;
  background: rgba(0, 242, 255, 0.06);
  border: 1px solid rgba(0, 242, 255, 0.15);
  border-radius: var(--radius-sm);
  font-size: 11px; color: var(--text-secondary);
}
.osm-mode-badge strong { color: var(--cyan); }
.osm-mode-badge.inactive {
  background: rgba(255,255,255,0.02);
  border-color: rgba(255,255,255,0.06);
  color: var(--text-dim);
}
.osm-switch-manual {
  background: none; border: 1px solid rgba(0,242,255,0.3);
  color: var(--cyan); font-size: 10px; padding: 2px 6px;
  border-radius: 4px; cursor: pointer;
  transition: all var(--transition-fast);
}
.osm-switch-manual:hover { background: var(--cyan-dim); }

.osm-info-card {
  background: rgba(0,242,255,0.04);
  border: 1px solid rgba(0,242,255,0.1);
  border-radius: var(--radius-sm);
  padding: 8px;
  display: flex; flex-direction: column; gap: 4px;
}
.osm-info-row {
  display: flex; justify-content: space-between;
  font-size: 11px;
}
.osm-info-label { color: var(--text-dim); font-family: var(--font-mono); }
.osm-info-val { color: var(--text-secondary); font-family: var(--font-mono); }
.osm-info-val.cyan { color: var(--cyan); }

.osm-divider {
  font-size: 10px; color: var(--text-dim);
  text-transform: uppercase; letter-spacing: 1px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(0,242,255,0.08);
  font-family: var(--font-display);
}

.osm-upload-area {
  border: 1px dashed rgba(0,242,255,0.2);
  border-radius: var(--radius-sm);
  padding: 10px;
  text-align: center;
  background: rgba(0,242,255,0.02);
  transition: border-color 0.2s;
}
.osm-upload-area:hover { border-color: var(--cyan); }
.osm-file-label {
  display: block; cursor: pointer;
  font-size: 12px; color: var(--text-secondary);
  font-family: var(--font-body);
}
.osm-file-input { display: none; }

.osm-text-input {
  flex: 1; background: rgba(255,255,255,0.04);
  border: 1px solid rgba(0,242,255,0.15);
  border-radius: 4px; color: var(--text-primary);
  font-family: var(--font-mono); font-size: 11px;
  padding: 4px 8px; outline: none;
  transition: border-color 0.2s;
}
.osm-text-input:focus { border-color: var(--cyan); }
.osm-text-input::placeholder { color: var(--text-dim); }

.osm-action-btn {
  width: 100%; padding: 8px 12px;
  background: linear-gradient(135deg, rgba(0,242,255,0.15), rgba(168,85,247,0.1));
  border: 1px solid var(--cyan); color: var(--cyan);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-body); font-size: 13px;
  transition: all var(--transition-fast);
}
.osm-action-btn:hover:not(:disabled) { background: var(--cyan-dim); box-shadow: var(--cyan-glow); }
.osm-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.osm-action-btn.secondary {
  background: rgba(255,255,255,0.03);
  border-color: var(--glass-border); color: var(--text-secondary);
}
.osm-action-btn.secondary:hover:not(:disabled) { border-color: var(--text-secondary); color: var(--text-primary); }

.osm-btn-row {
  display: flex; gap: 6px;
}
.osm-btn-row .osm-action-btn {
  flex: 1;
}
.osm-action-btn.local-parse-btn {
  background: linear-gradient(135deg, rgba(0,255,136,0.12), rgba(0,242,255,0.08));
  border-color: #00ff88;
  color: #00ff88;
}
.osm-action-btn.local-parse-btn:hover:not(:disabled) {
  background: rgba(0,255,136,0.15);
  box-shadow: 0 0 12px rgba(0,255,136,0.3);
}

.osm-feedback {
  padding: 6px 8px; border-radius: var(--radius-sm);
  font-size: 11px; font-family: var(--font-mono);
}
.osm-feedback.error { color: var(--red); background: rgba(255,59,59,0.06); border: 1px solid rgba(255,59,59,0.2); }
.osm-feedback.success { color: #00ff88; background: rgba(0,255,136,0.06); border: 1px solid rgba(0,255,136,0.2); }
</style>
