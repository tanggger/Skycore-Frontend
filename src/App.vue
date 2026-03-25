<script setup lang="ts">
import { onMounted, provide, ref, computed, watch } from 'vue'
import TopBar from './components/TopBar.vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import CenterSandbox from './components/CenterSandbox.vue'
import PlaybackBar from './components/PlaybackBar.vue'
import UAVDetail from './components/UAVDetail.vue'
import AlertOverlay from './components/AlertOverlay.vue'
import ScenarioEditor from './components/ScenarioEditor.vue'
import IntroSequence from './components/IntroSequence.vue'
import { usePlaybackEngine } from './composables/usePlaybackEngine'
import { generateMockFrames } from './data/mockData'
import { loadCSVFrames } from './services/csvParser'
import type { UAVNode } from './types'
import { currentFormation } from './composables/useFormation'
import type { FormationType } from './data/mockData'
import EntryPage from './components/EntryPage.vue'
import { useAppMode } from './composables/useAppMode'

const { currentAppMode } = useAppMode()

const engine = usePlaybackEngine()
// 只存 ID，selectedUAV 由 computed 从当前帧实时派生，确保卡片数据随仿真更新
const selectedUAVId = ref<number | null>(null)
const selectedUAV = computed<UAVNode | null>(() => {
  if (selectedUAVId.value === null) return null
  return engine.currentFrame.value?.uav_nodes.find(u => u.id === selectedUAVId.value) ?? null
})
const showAlert = ref(false)
const showEditor = ref(false)
const showIntro = ref(true)
const panelsRevealed = ref(false)
const dataMode = ref<'mock' | 'csv'>('mock')
const loading = ref(true)

// Panel Resizing Logic
const leftWidth = ref(300)
const rightWidth = ref(320)
const showLeft = ref(true)
const showRight = ref(true)
const isResizing = ref(false)

const MIN_PANEL_WIDTH = 260
const MAX_PANEL_WIDTH = 600

function startResizeLeft(e: MouseEvent) {
  isResizing.value = true
  const startX = e.clientX
  const startWidth = leftWidth.value
  
  const doDrag = (ev: MouseEvent) => {
    const delta = ev.clientX - startX
    let newW = startWidth + delta
    if (newW < MIN_PANEL_WIDTH) newW = MIN_PANEL_WIDTH
    if (newW > MAX_PANEL_WIDTH) newW = MAX_PANEL_WIDTH
    leftWidth.value = newW
  }
  
  const stopDrag = () => {
    isResizing.value = false
    document.removeEventListener('mousemove', doDrag)
    document.removeEventListener('mouseup', stopDrag)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  
  document.addEventListener('mousemove', doDrag)
  document.addEventListener('mouseup', stopDrag)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function startResizeRight(e: MouseEvent) {
  isResizing.value = true
  const startX = e.clientX
  const startWidth = rightWidth.value
  
  const doDrag = (ev: MouseEvent) => {
    const delta = startX - ev.clientX // Might need adjustment based on flex direction
    let newW = startWidth + delta
    if (newW < MIN_PANEL_WIDTH) newW = MIN_PANEL_WIDTH
    if (newW > MAX_PANEL_WIDTH) newW = MAX_PANEL_WIDTH
    rightWidth.value = newW
  }
  
  const stopDrag = () => {
    isResizing.value = false
    document.removeEventListener('mousemove', doDrag)
    document.removeEventListener('mouseup', stopDrag)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  
  document.addEventListener('mousemove', doDrag)
  document.addEventListener('mouseup', stopDrag)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onIntroComplete() {
  showIntro.value = false
  // 确保回放从 frame 0 暂停开始，避免闪烁
  engine.pause()
  engine.seek(0)
  // Trigger staggered panel reveal after intro
  requestAnimationFrame(() => {
    panelsRevealed.value = true
  })
}

provide('engine', engine)
provide('selectedUAV', selectedUAV)  // ComputedRef<UAVNode|null>，CenterSandbox 通过 .value?.id 读取
provide('formation', currentFormation)

// Clear simulation data when switching formation (mode) to keep a clean state
watch(currentFormation, () => {
  engine.loadFrames([])
  console.log(`[WingNet] 阵型切换，清空旧推演数据`)
})

function onSelectUAV(uav: UAVNode | null) {
  selectedUAVId.value = uav?.id ?? null
}

onMounted(async () => {
  // 通过 URL 参数切换数据源: ?mode=csv
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')

  try {
    if (mode === 'csv') {
      dataMode.value = 'csv'
      const csvPath = params.get('path') || '/data'
      console.log(`[WingNet] 加载 CSV 数据: ${csvPath}`)
      const frames = await loadCSVFrames(csvPath)
      engine.loadFrames(frames)
      console.log(`[WingNet] CSV 加载完毕, 共 ${frames.length} 帧`)
    } else {
      dataMode.value = 'mock'
      // By default, do not load any frames on start to keep panels clean
      engine.loadFrames([])
      console.log(`[WingNet] 初始状态: 等待仿真指令`)
    }
  } catch (e) {
    console.error('[WingNet] 数据加载失败', e)
    dataMode.value = 'mock'
    engine.loadFrames([])
  }
  loading.value = false
})
</script>

<template>
  <div class="app-root">
    <!-- 模式选择入口页 -->
    <Transition name="fade">
      <EntryPage v-if="currentAppMode === 'entry'" />
    </Transition>

    <!-- 工作区主体 -->
    <div class="workspace-container" v-show="currentAppMode !== 'entry'">
      <!-- 开场动画 -->
      <IntroSequence v-if="showIntro" @complete="onIntroComplete" />

      <!-- 全局告警覆层 -->
      <AlertOverlay :active="showAlert" />

      <!-- 顶栏 -->
      <TopBar :class="{ 'panel-reveal panel-reveal-1': panelsRevealed }" />

      <!-- 三栏主体 -->
      <div class="main-body" :class="{ 'is-resizing': isResizing }">
      
      <!-- LEFT PANEL -->
      <transition name="slide-left">
        <div 
          v-show="showLeft" 
          class="panel-wrapper left" 
          :style="{ width: leftWidth + 'px' }"
        >
          <LeftPanel class="panel-inner" :class="{ 'panel-reveal panel-reveal-2': panelsRevealed }" />
        </div>
      </transition>

      <!-- Resize Bar L -->
      <div 
        class="resize-bar" 
        :class="{ collapsed: !showLeft }"
        @mousedown="startResizeLeft"
      >
        <div class="toggle-btn" @click.stop="showLeft = !showLeft" :title="showLeft ? '收起面板' : '展开面板'">
          {{ showLeft ? '◀' : '▶' }}
        </div>
      </div>

      <!-- CENTER PANEL -->
      <div class="panel-center" :class="{ 'panel-reveal panel-reveal-3': panelsRevealed }">
        <CenterSandbox @select-uav="onSelectUAV" />
        <!-- 浮动工具按钮 -->
        <div class="floating-tools">
          <button class="float-btn" @click="showEditor = true" title="场景编辑器">
            🏗
          </button>
        </div>
      </div>

      <!-- Resize Bar R -->
      <div 
        class="resize-bar" 
        :class="{ collapsed: !showRight }"
        @mousedown="startResizeRight"
      >
        <div class="toggle-btn" @click.stop="showRight = !showRight" :title="showRight ? '收起面板' : '展开面板'">
          {{ showRight ? '▶' : '◀' }}
        </div>
      </div>

      <!-- RIGHT PANEL -->
      <transition name="slide-right">
        <div 
          v-show="showRight" 
          class="panel-wrapper right" 
          :style="{ width: rightWidth + 'px' }"
        >
          <RightPanel class="panel-inner" :class="{ 'panel-reveal panel-reveal-4': panelsRevealed }" />
        </div>
      </transition>

    </div>

    <!-- 底部播放控制 -->
    <PlaybackBar :class="{ 'panel-reveal panel-reveal-5': panelsRevealed }" />

    <!-- 无人机详情弹窗 -->
    <Transition name="modal">
      <UAVDetail
        v-if="selectedUAV"
        :uav="selectedUAV"
        @close="selectedUAVId = null"
      />
    </Transition>

    <!-- 场景编辑器 -->
    <Transition name="modal">
      <ScenarioEditor v-if="showEditor" @close="showEditor = false" />
    </Transition>
    </div> <!-- end workspace-container -->
  </div>
</template>

<style scoped>
.app-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  overflow: hidden;
  position: relative;
}

.workspace-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: absolute;
  top: 0;
  left: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.main-body {
  flex: 1;
  display: flex;
  gap: 0;
  overflow: hidden;
  padding: 0 4px 8px; /* Reduce horizontal padding to make resizers flush */
}

/* Panel Wrappers */
.panel-wrapper {
  height: 100%;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
  /* Smooth width transition only when NOT resizing */
  transition: width 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  display: flex;
  flex-direction: column;
}

.panel-inner {
  width: 100%;
  height: 100%;
  overflow: hidden; /* Let child components handle scrolling */
  display: flex;
  flex-direction: column;
}

/* Resize Bar & Toggle Button */
.resize-bar {
  width: 20px;            /* 增加感应宽度 */
  margin: 0 -10px;        /* 使用负 Margin 让其“悬浮”在间隙上，完全不占布局空间 */
  height: 100%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  position: relative;
  z-index: 50;            /* 确保在面板之上 */
  transition: all 0.3s ease;
  pointer-events: auto;   /* 确保能接收鼠标事件 */
}

/* 视觉引导线 (平时极淡，Hover变亮) */
.resize-bar::before {
  content: '';
  position: absolute;
  top: 15%; bottom: 15%;
  left: 50%;
  width: 1px;
  background: linear-gradient(to bottom, transparent, rgba(0, 242, 255, 0.1), transparent);
  transform: translateX(-50%);
  transition: all 0.3s;
  pointer-events: none;
}

.resize-bar:hover::before {
  background: linear-gradient(to bottom, transparent, var(--cyan), transparent);
  box-shadow: 0 0 10px var(--cyan);
  opacity: 0.8;
}

/* Toggle Button (The "Capsule") */
.toggle-btn {
  width: 22px;
  height: 60px;          /* 更修长，不再是小方块 */
  background: rgba(10, 14, 39, 0.85); /* 深色磨砂背景 */
  border: 1px solid rgba(0, 242, 255, 0.2);
  color: var(--cyan);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  z-index: 51;
  user-select: none;
  
  /* 形状美化：圆角胶囊 */
  border-radius: 12px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
  
  /* 动效：平时缩小并透明，Hover时弹出 */
  opacity: 0; 
  transform: scale(0.8) translateZ(0); 
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); /* 弹性动画 */
}

/* 状态：Hover时、或已折叠时，按钮必须可见 */
.resize-bar:hover .toggle-btn,
.resize-bar.collapsed .toggle-btn {
  opacity: 1;
  transform: scale(1) translateZ(0);
  border-color: var(--cyan);
  box-shadow: 0 0 20px rgba(0, 242, 255, 0.25);
}

/* 按钮内的文字/图标微调 */
.toggle-btn:hover {
  color: #fff;
  text-shadow: 0 0 5px var(--cyan);
  background: rgba(10, 14, 39, 0.95);
}

/* 侧边装饰线，增加科技感 */
.toggle-btn::after {
  content: '';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  height: 12px;
  top: 6px;
  background: rgba(255,255,255,0.1);
  border-radius: 2px;
}
.toggle-btn::before {
  content: '';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  height: 12px;
  bottom: 6px;
  background: rgba(255,255,255,0.1);
  border-radius: 2px;
}

/* Transitions for Panel Toggle */
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.slide-left-enter-from, .slide-left-leave-to,
.slide-right-enter-from, .slide-right-leave-to {
  width: 0 !important;
  opacity: 0;
}

.panel-center {
  flex: 1;
  position: relative;
  margin: 0; /* Remove margin as padding is usually handled by gaps */
  min-width: 400px; /* Prevent center from being crushed */
  overflow: hidden;
}

.panel-right {
  /* Removed fixed width here, controlled by wrapper */
}

.floating-tools {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 50;
}

.float-btn {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  color: var(--cyan);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  box-shadow: var(--glass-shadow);
}

.float-btn:hover {
  background: var(--cyan-dim);
  border-color: var(--cyan);
  box-shadow: var(--cyan-glow);
  transform: scale(1.1);
}

/* ── Panel Staggered Reveal ── */
.panel-reveal {
  animation: panelSlideIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.panel-reveal-1 { animation-delay: 0s; }
.panel-reveal-2 { animation-delay: 0.1s; }
.panel-reveal-3 { animation-delay: 0.2s; }
.panel-reveal-4 { animation-delay: 0.3s; }
.panel-reveal-5 { animation-delay: 0.4s; }

@keyframes panelSlideIn {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.97);
    filter: blur(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

/* ── Modal Transitions ── */
.modal-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-leave-active {
  transition: all 0.2s ease;
}
.modal-enter-from {
  opacity: 0;
  transform: scale(0.95) translateY(10px);
}
.modal-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
</style>
