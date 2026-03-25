<script setup lang="ts">
import { inject, computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useAppMode, type SceneType } from '../composables/useAppMode'
import { useWorkspaceStore } from '../composables/workspaceStore'

const { currentAppMode, currentScene, setMode } = useAppMode()
const { runMeta, taskStatus } = useWorkspaceStore()

function exitToEntry() {
  setMode('entry')
}

const sceneNames: Record<SceneType, string> = {
  city: '城市高楼',
  forest: '森林遮挡',
  open: '湖泊/空旷',
  wild: '起伏野地'
}
const sceneName = computed(() => sceneNames[currentScene.value] || '未知环境')
const modeName = computed(() => currentAppMode.value === 'cooperative' ? '合作场景推演' : '非合作侦察对抗')

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)
const connectivity = computed(() => frame.value ? Math.round(frame.value.topology.connectivity * 100) : 0)
const conflicts = computed(() => frame.value?.conflicts || 0)

const healthGradient = computed(() => {
  const c = connectivity.value
  // 优化为更具军事高级感的冷色调渐变，降低杂色，两端平滑淡出
  if (c >= 90 && conflicts.value === 0) return 'linear-gradient(90deg, transparent, rgba(0, 255, 136, 0.8), rgba(0, 242, 255, 0.8), transparent)'
  if (c >= 75) return 'linear-gradient(90deg, transparent, rgba(0, 242, 255, 0.8), rgba(168, 85, 247, 0.8), transparent)'
  if (c >= 60) return 'linear-gradient(90deg, transparent, rgba(250, 204, 21, 0.8), rgba(255, 59, 59, 0.8), transparent)'
  return 'linear-gradient(90deg, transparent, rgba(255, 59, 59, 0.9), rgba(200, 0, 0, 0.5), transparent)'
})

const realTime = ref('')
let clockTimer: ReturnType<typeof setInterval> | null = null

function updateClock() {
  const now = new Date()
  realTime.value = now.toLocaleTimeString('zh-CN', { hour12: false })
}

onMounted(() => {
  updateClock()
  clockTimer = setInterval(updateClock, 1000)
})

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <header class="top-bar glass-panel">
    <!-- 扫描线效果 -->
    <div class="scan-line-track">
      <div class="scan-line-beam"></div>
    </div>

    <div class="top-left">
      <div class="logo">
        <div class="logo-icon">
          <!-- ★ 改用呼吸代替旋转，更沉稳大气 -->
          <svg width="32" height="32" viewBox="0 0 28 28" class="logo-svg">
            <polygon points="14,2 26,14 14,26 2,14" fill="none" stroke="currentColor" stroke-width="1.5" />
            <polygon points="14,6 22,14 14,22 6,14" fill="none" stroke="currentColor" stroke-width="0.8" opacity="0.5" />
            <circle cx="14" cy="14" r="2.5" fill="currentColor" class="logo-core"/>
          </svg>
        </div>
        <div class="logo-text">
          <span class="logo-main">天枢·翼阵</span>
          <span class="logo-sub">Celestial Pivot</span>
        </div>
      </div>
      
      <button class="back-btn" @click="exitToEntry" title="返回模式选择">
        ◀ 返回控制塔
      </button>
    </div>

    <div class="top-center">
      <div class="status-chips">
        <!-- 当前环境与模式指示 -->
        <div class="chip scene-chip">
          <span class="dot cyan-dot"></span>
          <span class="chip-label">环境</span>
          <span class="chip-value">{{ sceneName }}</span>
        </div>
        <div class="chip mode-chip" :class="{'danger-mode': currentAppMode === 'non_cooperative'}">
          <span class="dot" :class="currentAppMode === 'non_cooperative' ? 'red-dot' : 'green-dot'"></span>
          <span class="chip-label">模式</span>
          <span class="chip-value">{{ modeName }}</span>
        </div>
        <!-- 合作模式显示通信模式 -->
        <div v-if="currentAppMode === 'cooperative' && runMeta.communicationMode" class="chip">
          <span class="dot cyan-dot"></span>
          <span class="chip-label">通信</span>
          <span class="chip-value">{{ runMeta.communicationMode }}</span>
        </div>
        <!-- 任务 ID -->
        <div v-if="runMeta.taskId" class="chip">
          <span class="dot" :class="taskStatus === 'RUNNING' ? 'cyan-dot pulse-dot' : taskStatus === 'SUCCESS' ? 'green-dot' : taskStatus === 'FAILED' ? 'red-dot' : 'cyan-dot'"></span>
          <span class="chip-label">任务</span>
          <span class="chip-value">{{ runMeta.taskId.substring(0, 8) }}</span>
        </div>
        <div class="chip-divider"></div>

        <div class="chip" :class="{ excellent: connectivity >= 90 }">
          <span class="dot green-dot"></span>
          <span class="chip-label">拓扑连通</span>
          <span class="chip-value">{{ connectivity }}%</span>
        </div>
        <div class="chip" :class="{ warn: conflicts > 0, danger: conflicts > 2 }">
          <span class="dot" :class="conflicts > 0 ? 'red-dot' : 'green-dot'"></span>
          <span class="chip-label">同频冲突</span>
          <span class="chip-value">{{ conflicts }}</span>
        </div>
        <div class="chip">
          <span class="dot cyan-dot pulse-dot"></span>
          <span class="chip-label">引擎在线</span>
        </div>
      </div>
    </div>

    <div class="top-right">
      <div class="time-block">
        <div class="sys-time">
          <span class="time-label">推演帧数</span>
          <span class="time-value">{{ frame?.tick ?? 0 }}</span>
        </div>
        <div class="time-divider"></div>
        <div class="real-clock">
          <span class="time-label">物理时间</span>
          <span class="clock-value">{{ realTime }}</span>
        </div>
      </div>
    </div>

    <div class="health-status-line" :style="{ background: healthGradient }"></div>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;           /* ★ 微增高度，呼吸感更好 */
  padding: 0 24px;
  margin: 8px 8px 0;
  position: relative;
  z-index: 100;
  overflow: hidden;
}

.top-bar::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 10%;
  right: 10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--cyan), transparent);
}

/* ── 扫描线优化：更柔和 ── */
.scan-line-track {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.scan-line-beam {
  position: absolute;
  top: 0;
  left: 0;
  width: 120px;          /* ★ 更宽更柔和 */
  height: 100%;
  background: linear-gradient(90deg,
    transparent,
    rgba(0, 242, 255, 0.03),
    rgba(0, 242, 255, 0.05),
    rgba(0, 242, 255, 0.03),
    transparent);
  animation: scan-line-h 6s linear infinite;  /* ★ 减速 */
}

@keyframes scan-line-h {
  from { transform: translateX(-120px); }
  to   { transform: translateX(calc(100vw + 120px)); }
}

@keyframes scan-line-h {
  from { transform: translateX(-120px); }
  to   { transform: translateX(calc(100vw + 120px)); }
}

.top-left { display: flex; align-items: center; gap: 20px; }

.back-btn {
  background: rgba(0, 242, 255, 0.1);
  border: 1px solid rgba(0, 242, 255, 0.3);
  color: var(--cyan);
  padding: 6px 14px;
  border-radius: 16px;
  font-size: 13px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all 0.3s ease;
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  gap: 4px;
}
.back-btn:hover {
  background: var(--cyan-dim);
  border-color: var(--cyan);
  transform: translateX(-2px);
  box-shadow: 0 0 10px rgba(0, 242, 255, 0.2);
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  color: var(--cyan);
  filter: drop-shadow(0 0 8px rgba(0, 242, 255, 0.5));
}

/* ★ 去掉 spin，只保留呼吸——更专业 */
.logo-svg {
  animation: logo-breathe 3s ease-in-out infinite;
}

.logo-core {
  animation: core-pulse 2s ease-in-out infinite;
}

@keyframes logo-breathe {
  0%, 100% { filter: drop-shadow(0 0 4px rgba(0, 242, 255, 0.4)); }
  50% { filter: drop-shadow(0 0 14px rgba(0, 242, 255, 0.9)); }
}

@keyframes core-pulse {
  0%, 100% { r: 2.5; opacity: 0.8; }
  50% { r: 3; opacity: 1; }
}

.logo-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.logo-main {
  font-family: var(--font-body);
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 5px;
}

.logo-sub {
  font-family: var(--font-display);
  font-size: 9px;
  color: var(--cyan);
  letter-spacing: 3px;
  opacity: 0.8;
}

/* ── 状态芯片增强 ── */
.status-chips {
  display: flex;
  gap: 8px;
}

.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-secondary);
  transition: all var(--transition-normal);
  cursor: default;
}

.chip:hover {
  background: rgba(0, 242, 255, 0.05);
  border-color: rgba(0, 242, 255, 0.15);
}

.chip-divider {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.15);
  margin: 0 4px;
}

.mode-chip.danger-mode {
  border-color: rgba(255, 59, 59, 0.3);
  background: rgba(255, 59, 59, 0.08);
  color: #ff3c3c;
}
.mode-chip.danger-mode .chip-value {
  color: #ff3c3c;
}

.chip.excellent {
  border-color: rgba(0, 255, 136, 0.2);
  background: rgba(0, 255, 136, 0.04);
}

.chip.warn {
  border-color: rgba(255, 170, 0, 0.25);
  background: rgba(255, 170, 0, 0.06);
}

.chip.danger {
  border-color: rgba(255, 59, 59, 0.3);
  background: rgba(255, 59, 59, 0.08);
  animation: chip-pulse 1.5s infinite;
}

@keyframes chip-pulse {
  0%, 100% { box-shadow: none; }
  50% { box-shadow: 0 0 12px rgba(255, 59, 59, 0.15); }
}

.chip-label {
  color: var(--text-dim);
  font-size: 10px;
}

.chip-value {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text-primary);
  font-size: 12px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.green-dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
.cyan-dot  { background: var(--cyan); box-shadow: 0 0 6px var(--cyan); }
.red-dot   { background: var(--red); box-shadow: 0 0 6px var(--red); }

.pulse-dot {
  animation: dot-blink 2s infinite;
}

@keyframes dot-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ── 时间区块优化 ── */
.time-block {
  display: flex;
  align-items: center;
  gap: 16px;
}

.time-divider {
  width: 1px;
  height: 28px;
  background: linear-gradient(180deg,
    transparent,
    rgba(0, 242, 255, 0.2),
    transparent);
}

.sys-time, .real-clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.time-label {
  font-family: var(--font-display);
  font-size: 8px;
  color: var(--text-dim);
  letter-spacing: 2px;
}

.time-value {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  color: #ffffff; /* 核心变白，发光留给 shadow */
  text-shadow: 0 0 8px rgba(0, 242, 255, 0.8), 0 0 16px rgba(0, 242, 255, 0.4); /* 收紧内层发光，扩大外层柔光 */
  line-height: 1;
}

.clock-value {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 1px;
  line-height: 1;
}

.health-status-line {
  position: absolute;
  bottom: -1px;
  left: 5%;
  right: 5%;
  height: 2px;
  border-radius: 1px;
  transition: background 1s ease;
  z-index: 2;
}
</style>