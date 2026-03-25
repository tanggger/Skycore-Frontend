<script setup lang="ts">
import { ref } from 'vue'
import { useAppMode, type SceneType, type AppMode } from '../composables/useAppMode'

const { setMode, setScene, currentScene } = useAppMode()

const scenes: { id: SceneType; name: string; icon: string; desc: string }[] = [
  { id: 'city', name: '城市高楼场景', icon: '🏙️', desc: '高楼林立，多径效应显著，严重遮挡NLOS' },
  { id: 'forest', name: '森林遮挡场景', icon: '🌲', desc: '大面积植被遮挡，信号衰减与散射' },
  { id: 'open', name: '湖泊/空旷场景', icon: '🌊', desc: '视野开阔，视距LOS通信为主，环境干扰小' },
  { id: 'wild', name: '野地/低遮挡场景', icon: '🏜️', desc: '起伏地形，局部遮挡，中等连通难度' }
]

const hoverScene = ref<SceneType | null>(null)

function onSelectScene(id: SceneType) {
  setScene(id)
}

function startMode(mode: AppMode) {
  setMode(mode)
}
</script>

<template>
  <div class="entry-root">
    <div class="entry-bg"></div>
    
    <div class="entry-container">
      <header class="entry-header">
        <div class="logo-box">
          <div class="logo-icon"></div>
          <h1>Wing-Net Omni</h1>
        </div>
        <p class="subtitle">低空无人机蜂群通信推演与对抗增强平台</p>
      </header>

      <main class="entry-main">
        <section class="scene-selection">
          <h2>1. 选择环境底座</h2>
          <div class="scene-grid">
            <div 
              v-for="scene in scenes" 
              :key="scene.id"
              class="scene-card"
              :class="{ active: currentScene === scene.id }"
              @click="onSelectScene(scene.id)"
              @mouseenter="hoverScene = scene.id"
              @mouseleave="hoverScene = null"
            >
              <div class="scene-icon">{{ scene.icon }}</div>
              <h3>{{ scene.name }}</h3>
              <p class="scene-desc">{{ scene.desc }}</p>
            </div>
          </div>
        </section>

        <section class="mode-selection">
          <h2>2. 选择任务模式</h2>
          <div class="mode-grid">
            <!-- 合作场景 -->
            <div class="mode-card cooperative" @click="startMode('cooperative')">
              <div class="mode-bg"></div>
              <div class="mode-content">
                <div class="mode-icon">🤝</div>
                <h3>合作场景推演</h3>
                <p>我方内部网络拓扑规划、路由切换与环境适应恢复，关注<strong>稳健性与连通性</strong>。</p>
                <button class="launch-btn">进入指挥舱</button>
              </div>
            </div>

            <!-- 非合作场景 -->
            <div class="mode-card non-cooperative" @click="startMode('non_cooperative')">
              <div class="mode-bg"></div>
              <div class="mode-content">
                <div class="mode-icon">⚔️</div>
                <h3>非合作侦察对抗</h3>
                <p>基于带噪声的观测数据，图结构<strong>推断链路与关键节点</strong>，并实施干扰压制。</p>
                <button class="launch-btn danger">进入对抗舱</button>
              </div>
            </div>
          </div>
        </section>

        <!-- 其他入口 -->
        <section class="other-links">
          <button class="text-btn">CSV 离线复盘提取</button>
          <div class="divider"></div>
          <button class="text-btn">最近演练案例</button>
          <div class="divider"></div>
          <button class="text-btn">OSM 地图编辑</button>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
.entry-root {
  width: 100vw;
  height: 100vh;
  background: var(--bg-deep);
  color: #fff;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: hidden;
  font-family: var(--font-primary);
}

.entry-bg {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(circle at center, rgba(0, 242, 255, 0.05) 0%, transparent 60%);
  z-index: 1;
  pointer-events: none;
}

.entry-container {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 1200px;
  padding: 40px;
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.entry-header {
  text-align: center;
}

.logo-box {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 8px;
}

.logo-icon {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, var(--cyan), #0088ff);
  border-radius: 12px;
  box-shadow: var(--cyan-glow);
  position: relative;
}

.logo-icon::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 10px;
  background: var(--bg-deep);
}

.logo-icon::before {
  content: '⚡';
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  font-size: 24px;
}

h1 {
  font-size: 42px;
  font-weight: 700;
  letter-spacing: 2px;
  background: linear-gradient(to right, #fff, var(--cyan));
  -webkit-background-clip: text;
  color: transparent;
  margin: 0;
}

.subtitle {
  color: var(--text-dim);
  font-size: 16px;
  letter-spacing: 4px;
  text-transform: uppercase;
}

.entry-main {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

h2 {
  font-size: 18px;
  color: var(--cyan);
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}

h2::before {
  content: '';
  display: inline-block;
  width: 4px;
  height: 18px;
  background: var(--cyan);
  border-radius: 2px;
}

/* Scene Selection */
.scene-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}

.scene-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  padding: 24px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
}

.scene-card:hover {
  transform: translateY(-5px);
  background: rgba(0, 242, 255, 0.05);
  border-color: rgba(0, 242, 255, 0.3);
}

.scene-card.active {
  background: rgba(0, 242, 255, 0.1);
  border-color: var(--cyan);
  box-shadow: 0 0 20px rgba(0, 242, 255, 0.2);
}

.scene-icon {
  font-size: 42px;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));
}

.scene-card h3 {
  font-size: 16px;
  margin: 0;
  color: #fff;
}

.scene-desc {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  margin: 0;
  line-height: 1.4;
}

/* Mode Selection */
.mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
}

.mode-card {
  position: relative;
  border-radius: 16px;
  padding: 40px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--glass-border);
  transition: all 0.4s ease;
}

.mode-bg {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-size: cover;
  background-position: center;
  opacity: 0.2;
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.mode-card.cooperative .mode-bg {
  background: radial-gradient(circle at bottom right, rgba(0, 242, 255, 0.3), transparent);
}

.mode-card.non-cooperative .mode-bg {
  background: radial-gradient(circle at bottom right, rgba(255, 60, 60, 0.3), transparent);
}

.mode-card:hover {
  transform: translateY(-8px);
}

.mode-card.cooperative:hover {
  border-color: var(--cyan);
  box-shadow: 0 10px 30px rgba(0, 242, 255, 0.15);
}

.mode-card.non-cooperative:hover {
  border-color: #ff3c3c;
  box-shadow: 0 10px 30px rgba(255, 60, 60, 0.15);
}

.mode-card:hover .mode-bg {
  opacity: 0.4;
  transform: scale(1.05);
}

.mode-content {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
}

.mode-icon {
  font-size: 48px;
}

.mode-card h3 {
  font-size: 28px;
  margin: 0;
  color: #fff;
}

.mode-card p {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.6;
  margin: 0 0 20px 0;
}

.mode-card p strong {
  color: #fff;
}

.launch-btn {
  padding: 12px 32px;
  background: var(--cyan-dim);
  border: 1px solid var(--cyan);
  color: var(--cyan);
  border-radius: 20px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.mode-card:hover .launch-btn {
  background: var(--cyan);
  color: #000;
  box-shadow: var(--cyan-glow);
}

.launch-btn.danger {
  background: rgba(255, 60, 60, 0.1);
  border-color: #ff3c3c;
  color: #ff3c3c;
}

.mode-card.non-cooperative:hover .launch-btn.danger {
  background: #ff3c3c;
  color: #fff;
  box-shadow: 0 0 15px rgba(255, 60, 60, 0.5);
}

.other-links {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
  margin-top: 20px;
}

.text-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  cursor: pointer;
  transition: color 0.2s;
}

.text-btn:hover {
  color: var(--cyan);
}

.divider {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
}
</style>
