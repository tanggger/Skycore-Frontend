<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { CustomSimulationParams } from '../services/apiService'

const props = defineProps<{
  visible: boolean
  mode: 'view' | 'edit'
  currentDifficulty: string
  initialParams: CustomSimulationParams
}>()

const emit = defineEmits(['close', 'save'])

// Local copy for editing
const localParams = ref<CustomSimulationParams>({})

// Preset definitions for read-only view
const PRESETS: Record<string, CustomSimulationParams> = {
  'Easy': {
    pathLossExp: 2.0, rxSens: -90.0, txPower: 23.0, nakagamiM: 0.0,
    noiseFigure: 7.0, macRetries: 7, trafficLoad: 0.2,
    rtkNoise: 0.01, rtkDriftMag: 0.0, numInterfere: 0
  },
  'Moderate': {
    pathLossExp: 2.8, rxSens: -85.0, txPower: 23.0, nakagamiM: 1.0,
    noiseFigure: 9.0, macRetries: 4, trafficLoad: 0.8,
    rtkNoise: 0.05, rtkDriftMag: 0.3, numInterfere: 2,
    interfereRate: 1.0, interfereDuty: 0.3
  },
  'Hard': {
    pathLossExp: 3.5, rxSens: -78.0, txPower: 23.0, nakagamiM: 0.5,
    noiseFigure: 12.0, macRetries: 2, trafficLoad: 2.0,
    rtkNoise: 0.20, rtkDriftMag: 0.8, numInterfere: 8,
    interfereRate: 3.0, interfereDuty: 0.8
  }
}

// Compute which params to show (either editable localParams or read-only preset)
const displayParams = computed(() => {
  if (props.mode === 'edit') return localParams.value
  return PRESETS[props.currentDifficulty] || PRESETS['Easy']
})

// Initialize local params when opening or changing mode
watch(() => props.visible, (val) => {
  if (val && props.mode === 'edit') {
    // If editing, clone initial params or use default custom base if empty
    localParams.value = { ...PRESETS['Moderate'], ...props.initialParams }
  }
})

function save() {
  emit('save', localParams.value)
  emit('close')
}

// Collapsible sections state
const activeSection = ref('physical')
const sections = [
  { id: 'physical', label: '物理信道 (Physical)' },
  { id: 'network', label: '网络/MAC (Network)' },
  { id: 'rtk', label: '定位与导航 (RTK)' },
  { id: 'jamming', label: '对抗干扰 (Jamming)' }
]
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-container">
        <!-- Header -->
        <div class="modal-header">
          <h3>
            <span class="icon">⚙️</span>
            {{ mode === 'edit' ? '自定义环境参数配置' : `${currentDifficulty} 模式参数详情` }}
          </h3>
          <button class="close-btn" @click="$emit('close')">×</button>
        </div>

        <!-- Content -->
        <div class="modal-body">
          <!-- Sidebar Navigation for Sections -->
          <div class="modal-sidebar">
            <div 
              v-for="s in sections" 
              :key="s.id"
              class="nav-item"
              :class="{ active: activeSection === s.id }"
              @click="activeSection = s.id"
            >
              {{ s.label }}
            </div>
          </div>

          <!-- Form Area -->
          <div class="modal-content">
            
            <!-- Section: Physical -->
            <div v-show="activeSection === 'physical'" class="form-section">
              <h4>信道模型参数</h4>
              
              <div class="control-group">
                <label>路径损耗指数 (α)</label>
                <div class="control-row">
                  <input 
                    type="range" min="2.0" max="5.0" step="0.1" 
                    v-model.number="displayParams.pathLossExp" 
                    :disabled="mode === 'view'"
                  >
                  <span class="val">{{ displayParams.pathLossExp?.toFixed(1) }}</span>
                </div>
                <small>2.0=自由空间, 2.8=郊区, 4.0=密集遮挡</small>
              </div>

              <div class="control-group">
                <label>接收灵敏度 (dBm)</label>
                <div class="control-row">
                  <input 
                    type="range" min="-95" max="-60" step="1" 
                    v-model.number="displayParams.rxSens"
                    :disabled="mode === 'view'"
                  >
                  <span class="val">{{ displayParams.rxSens }} dBm</span>
                </div>
              </div>

              <div class="control-group">
                <label>Nakagami-m 衰落系数</label>
                <div class="control-row">
                  <input 
                    type="range" min="0.5" max="5.0" step="0.5" 
                    v-model.number="displayParams.nakagamiM"
                    :disabled="mode === 'view'"
                  >
                  <span class="val">{{ displayParams.nakagamiM }}</span>
                </div>
                <small>0.5=严重衰落, 1.0=瑞利, 3.0=视距 (0=关闭)</small>
              </div>
            </div>

            <!-- Section: Network -->
            <div v-show="activeSection === 'network'" class="form-section">
              <h4>MAC层与流量</h4>
              
              <div class="control-group">
                <label>MAC 最大重传次数</label>
                <div class="control-row">
                  <input 
                    type="number" min="0" max="10" 
                    v-model.number="displayParams.macRetries"
                    :disabled="mode === 'view'"
                  >
                </div>
              </div>

              <div class="control-group">
                <label>单机业务负载 (Mbps/Node)</label>
                <div class="control-row">
                  <input 
                    type="range" min="0.1" max="5.0" step="0.1" 
                    v-model.number="displayParams.trafficLoad"
                    :disabled="mode === 'view'"
                  >
                  <span class="val">{{ displayParams.trafficLoad }} Mbps</span>
                </div>
              </div>

              <div class="control-group">
                <label>接收机噪声系数 (dB)</label>
                <div class="control-row">
                  <input 
                    type="range" min="1" max="15" step="1"
                    v-model.number="displayParams.noiseFigure"
                    :disabled="mode === 'view'"
                  >
                  <span class="val">{{ displayParams.noiseFigure }} dB</span>
                </div>
              </div>
            </div>

            <!-- Section: RTK -->
            <div v-show="activeSection === 'rtk'" class="form-section">
              <h4>定位误差模拟 (RTK/GPS)</h4>
              
              <div class="control-group">
                <label>RTK 基础噪声 (标准差/米)</label>
                <div class="control-row">
                  <input 
                    type="range" min="0.01" max="1.0" step="0.01" 
                    v-model.number="displayParams.rtkNoise"
                    :disabled="mode === 'view'"
                  >
                  <span class="val">{{ displayParams.rtkNoise }} m</span>
                </div>
              </div>

              <div v-if="mode === 'edit' || (displayParams.rtkDriftMag || 0) > 0" class="control-group">
                <label>突发漂移幅度 (Drift Mag)</label>
                <div class="control-row">
                  <input 
                    type="range" min="0.0" max="5.0" step="0.1" 
                    v-model.number="displayParams.rtkDriftMag"
                    :disabled="mode === 'view'"
                  >
                  <span class="val">{{ displayParams.rtkDriftMag }} m</span>
                </div>
              </div>
            </div>

            <!-- Section: Jamming -->
            <div v-show="activeSection === 'jamming'" class="form-section">
              <h4>恶意对抗干扰</h4>
              
              <div class="control-group">
                <label>干扰源数量 (黑飞节点)</label>
                <div class="control-row">
                  <input 
                    type="range" min="0" max="20" step="1" 
                    v-model.number="displayParams.numInterfere"
                    :disabled="mode === 'view'"
                  >
                  <span class="val">{{ displayParams.numInterfere }}</span>
                </div>
              </div>

              <div v-if="mode === 'edit' || (displayParams.numInterfere || 0) > 0">
                <div class="control-group">
                  <label>干扰发射速率</label>
                  <div class="control-row">
                    <input 
                      type="range" min="0.5" max="10.0" step="0.5" 
                      v-model.number="displayParams.interfereRate"
                      :disabled="mode === 'view'"
                    >
                    <span class="val">{{ displayParams.interfereRate }} Mbps</span>
                  </div>
                </div>

                <div class="control-group">
                  <label>干扰占空比 (Duty Cycle)</label>
                  <div class="control-row">
                    <input 
                      type="range" min="0.1" max="1.0" step="0.1" 
                      v-model.number="displayParams.interfereDuty"
                      :disabled="mode === 'view'"
                    >
                    <span class="val">{{ ((displayParams.interfereDuty || 0) * 100).toFixed(0) }}%</span>
                  </div>
                </div>
              </div>
              <div v-else class="info-box">
                当前未配置有源干扰节点。
              </div>
            </div>

          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <button class="btn secondary" @click="$emit('close')">
            {{ mode === 'edit' ? '取消' : '关闭' }}
          </button>
          <button v-if="mode === 'edit'" class="btn primary" @click="save">
            确定并应用参数
          </button>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(5px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal-container {
  width: 700px;
  max-width: 90%;
  height: 550px;
  background: var(--bg-panel, #0a0e27);
  border: 1px solid var(--glass-border, rgba(0, 242, 255, 0.2));
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  overflow: hidden;
}

.modal-header {
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-header h3 {
  margin: 0;
  color: var(--cyan, #00f2ff);
  font-family: var(--font-display);
  font-size: 1.1rem;
  display: flex; align-items: center; gap: 8px;
}
.close-btn {
  background: none; border: none; color: #666; font-size: 24px; cursor: pointer;
}
.close-btn:hover { color: #fff; }

.modal-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.modal-sidebar {
  width: 160px;
  background: rgba(0, 0, 0, 0.2);
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 20px;
}
.nav-item {
  padding: 12px 20px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 0.9rem;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}
.nav-item.active {
  background: rgba(0, 242, 255, 0.1);
  color: var(--cyan);
  border-left-color: var(--cyan);
}

.modal-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.form-section h4 {
  margin: 0 0 20px 0;
  color: var(--text-primary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 8px;
}

.control-group {
  margin-bottom: 20px;
}
.control-group label {
  display: block;
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin-bottom: 8px;
}
.control-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.control-row input[type="range"] {
  flex: 1;
}
.control-row input[type="number"] {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #fff;
  padding: 4px 8px;
  width: 80px;
}
.val {
  min-width: 60px;
  text-align: right;
  font-family: monospace;
  color: var(--cyan);
}
small {
  display: block;
  color: #555;
  font-size: 0.75rem;
  margin-top: 4px;
}

.info-box {
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  color: #888;
  text-align: center;
  font-size: 0.9rem;
}

.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn {
  padding: 8px 20px;
  border-radius: 4px;
  cursor: pointer;
  border: none;
  font-family: var(--font-display);
  font-size: 0.9rem;
  transition: all 0.2s;
}
.btn.secondary {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--text-secondary);
}
.btn.secondary:hover {
  border-color: var(--text-primary);
  color: var(--text-primary);
}
.btn.primary {
  background: rgba(0, 242, 255, 0.15);
  border: 1px solid var(--cyan);
  color: var(--cyan);
  box-shadow: 0 0 10px rgba(0, 242, 255, 0.1);
}
.btn.primary:hover {
  background: var(--cyan);
  color: #000;
  box-shadow: 0 0 20px rgba(0, 242, 255, 0.4);
}
</style>