<script setup lang="ts">
import { inject, computed, onMounted, onBeforeUnmount } from 'vue'

const engine = inject<any>('engine')
const currentTick = computed(() => engine?.currentTick?.value ?? 0)
const totalTicks = computed(() => engine?.totalTicks?.value ?? 1)
const isPlaying = computed(() => engine?.isPlaying?.value ?? false)
const speed = computed(() => engine?.playbackSpeed?.value ?? 1)
const progress = computed(() => totalTicks.value > 1 ? (currentTick.value / (totalTicks.value - 1)) * 100 : 0)

function onSeekInput(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value)
  if (engine?.seekThrottled) {
    engine.seekThrottled(val)
  } else {
    engine?.seek(val)
  }
}

function onSeekChange(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value)
  if (engine?.seekEnd) {
    engine.seekEnd(val)
  } else {
    // Fallback: just ensure we're at the right tick
    engine?.seek(val)
  }
}


function togglePlay() {
  engine?.togglePlay()
}

function setSpeed(s: number) {
  engine?.setSpeed(s)
}

function stepForward() {
  engine?.pause()
  engine?.seek(Math.min(currentTick.value + 1, totalTicks.value - 1))
}

function stepBackward() {
  engine?.pause()
  engine?.seek(Math.max(currentTick.value - 1, 0))
}

const speeds = [0.5, 1, 2, 4]

// Keyboard shortcuts
function onKeydown(e: KeyboardEvent) {
  // Don't capture when typing in inputs
  if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
  switch (e.code) {
    case 'Space':
      e.preventDefault()
      togglePlay()
      break
    case 'ArrowRight':
      e.preventDefault()
      stepForward()
      break
    case 'ArrowLeft':
      e.preventDefault()
      stepBackward()
      break
    case 'Digit1': setSpeed(0.5); break
    case 'Digit2': setSpeed(1); break
    case 'Digit3': setSpeed(2); break
    case 'Digit4': setSpeed(4); break
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="playback-bar glass-panel">
    <!-- Top accent glow line -->
    <div class="bar-accent"></div>

    <button class="pb-btn step-btn" @click="stepBackward" title="上一帧 (←)">⏮</button>

    <button
      class="pb-btn play-btn"
      :class="{ playing: isPlaying }"
      @click="togglePlay"
      title="播放/暂停 (Space)"
    >
      <span class="play-icon" v-if="isPlaying">⏸</span>
      <span class="play-icon" v-else>▶</span>
      <!-- ★ 新增外圈进度环 -->
      <svg class="play-ring" viewBox="0 0 40 40" v-if="isPlaying">
        <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(0,242,255,0.2)"
          stroke-width="1.5" stroke-dasharray="2 4" class="ring-spin"/>
      </svg>
    </button>

    <button class="pb-btn step-btn" @click="stepForward" title="下一帧 (→)">⏭</button>

    <div class="pb-progress">
      <div class="pb-track">
        <div class="pb-fill" :style="{ width: progress + '%' }">
          <div class="pb-glow-dot"></div>
        </div>
      </div>
      <input
        type="range"
        class="pb-slider"
        min="0"
        :max="totalTicks - 1"
        :value="currentTick"
        @input="onSeekInput"
        @change="onSeekChange"
      />
    </div>

    <div class="pb-tick">
      <span class="pb-tick-label">TICK</span>
      <span class="pb-tick-value">{{ currentTick }} / {{ totalTicks - 1 }}</span>
    </div>

    <div class="pb-speed">
      <button
        v-for="s in speeds"
        :key="s"
        class="speed-btn"
        :class="{ active: speed === s }"
        @click="setSpeed(s)"
      >{{ s }}x</button>
    </div>

    <div class="kb-hint">Space ▶⏸ │ ←→ 帧 │ 1-4 倍速</div>
  </div>
</template>

<style scoped>
.playback-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 44px;
  padding: 0 20px;
  margin: 0 8px 8px;
  position: relative;
  overflow: hidden;
}

/* Top glow accent line */
.bar-accent {
  position: absolute;
  top: 0;
  left: 5%;
  right: 5%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--cyan), var(--purple), var(--cyan), transparent);
  opacity: 0.5;
}

.pb-btn {
  background: none;
  border: 1px solid var(--glass-border);
  color: var(--cyan);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: all var(--transition-fast);
}

.pb-btn:hover {
  background: var(--cyan-dim);
  box-shadow: var(--cyan-glow);
}

/* Breathing glow when playing */
.pb-btn.playing {
  animation: breathe-glow 2s ease-in-out infinite;
}

.step-btn {
  width: 28px;
  height: 28px;
  font-size: 12px;
  border: none;
  opacity: 0.6;
}

.step-btn:hover {
  opacity: 1;
}

.pb-progress {
  flex: 1;
  position: relative;
  height: 20px;
  display: flex;
  align-items: center;
}

.pb-track {
  position: absolute;
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: visible;
}

.pb-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--cyan), var(--green));
  border-radius: 2px;
  transition: width 0.1s linear;
  box-shadow: 0 0 10px var(--cyan);
  position: relative;
}

.play-btn {
  width: 38px;
  height: 38px;
  font-size: 16px;
  position: relative;
  border: 1.5px solid rgba(0, 242, 255, 0.3);
  transition: all 0.2s ease;
}

.play-btn:hover {
  background: rgba(0, 242, 255, 0.1);
  border-color: var(--cyan);
  box-shadow: 0 0 16px rgba(0, 242, 255, 0.2);
  transform: scale(1.05);
}

.play-btn.playing {
  border-color: var(--green);
  animation: none; /* 去除 breathe-glow */
  box-shadow: 0 0 12px rgba(0, 255, 136, 0.15);
}

.play-ring {
  position: absolute;
  inset: -4px;
  width: calc(100% + 8px);
  height: calc(100% + 8px);
  pointer-events: none;
}

.ring-spin {
  animation: spin 3s linear infinite;
  transform-origin: center;
}

/* Glowing dot at the end of progress */
.pb-glow-dot {
  position: absolute;
  right: -3px;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 8px var(--cyan), 0 0 16px var(--cyan);
  opacity: v-bind('progress > 1 ? 1 : 0');
  transition: opacity 0.3s;
}

.pb-slider {
  position: relative;
  width: 100%;
  height: 20px;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
  z-index: 1;
}

.pb-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 8px var(--cyan);
  cursor: pointer;
}

.pb-tick {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 80px;
}

.pb-tick-label {
  font-family: var(--font-display);
  font-size: 8px;
  color: var(--text-dim);
  letter-spacing: 2px;
}

.pb-tick-value {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--cyan);
}

.pb-speed {
  display: flex;
  gap: 4px;
}

.speed-btn {
  background: none;
  border: 1px solid transparent;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.speed-btn:hover {
  color: var(--cyan);
  border-color: var(--glass-border);
}

.speed-btn.active {
  color: var(--cyan);
  background: var(--cyan-dim);
  border-color: var(--cyan);
}

.kb-hint {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-dim);
  opacity: 0.6;               /* ★ 从 0.4 提升 */
  white-space: nowrap;
  letter-spacing: 0.5px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.2);  /* ★ 加背景 */
  border-radius: var(--radius-sm);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

/* ★ 倍速按钮 active 状态更明显 */
.speed-btn.active {
  color: var(--cyan);
  background: var(--cyan-dim);
  border-color: var(--cyan);
  box-shadow: 0 0 8px rgba(0, 242, 255, 0.15);
  font-weight: 600;
}
</style>
