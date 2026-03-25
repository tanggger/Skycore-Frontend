<script setup lang="ts">
import { watch, ref, inject, computed } from 'vue'

const props = defineProps<{
  active?: boolean
}>()

const engine = inject<any>('engine')
const frame = computed(() => engine?.currentFrame?.value)

const showFlash = ref(false)
const shakeScreen = ref(false)

// 自动检测告警条件 (已禁用全屏闪烁和震动特效)
watch(frame, (f) => {
  // 特效已根据用户要求移除
})

// 暴露全局抖动 class (已禁用)
</script>

<template>
  <Teleport to="body">
    <!-- 红色闪屏 -->
    <div v-if="showFlash" class="alert-flash"></div>

    <!-- 边缘警告光 -->
    <div v-if="active || showFlash" class="alert-border-glow"></div>
  </Teleport>
</template>

<style>
/* 全局：屏幕抖动 (已移除) */
</style>

<style scoped>
.alert-flash {
  position: fixed;
  inset: 0;
  z-index: 10000;
  pointer-events: none;
  animation: flashAnim 0.3s ease forwards;
}

@keyframes flashAnim {
  0% { background: rgba(255, 59, 59, 0.2); }
  50% { background: rgba(255, 59, 59, 0.08); }
  100% { background: transparent; }
}

.alert-border-glow {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  box-shadow: inset 0 0 80px rgba(255, 59, 59, 0.15);
  animation: borderPulse 1s ease infinite;
}

@keyframes borderPulse {
  0%, 100% { box-shadow: inset 0 0 60px rgba(255, 59, 59, 0.1); }
  50% { box-shadow: inset 0 0 100px rgba(255, 59, 59, 0.2); }
}
</style>
