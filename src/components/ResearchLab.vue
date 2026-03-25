<script setup lang="ts">
import { onMounted, ref, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { generateBenchmarkData } from '../data/mockData'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const radarChartEl = ref<HTMLElement | null>(null)
let radarChart: echarts.ECharts | null = null

const benchmarkData = generateBenchmarkData()

onMounted(() => {
  if (!radarChartEl.value) return
  radarChart = echarts.init(radarChartEl.value)

  const indicators = [
    { name: 'Throughput', max: 1 },
    { name: 'Latency', max: 1 },
    { name: 'Jitter', max: 1 },
    { name: 'PDR', max: 1 },
    { name: 'Topology', max: 1 },
  ]

  const colors = ['#00f2ff', '#ffaa00', '#64748b']
  const series = benchmarkData.map((d, i) => ({
    value: [d.throughput, d.latency, d.jitter, d.pdr, d.topology_stability],
    name: d.algorithm,
    lineStyle: { color: colors[i], width: 2 },
    areaStyle: { color: colors[i] + '20' },
    itemStyle: { color: colors[i] },
    symbol: 'circle',
    symbolSize: 6
  }))

  radarChart.setOption({
    backgroundColor: 'transparent',
    title: {
      text: '算法性能对比雷达图',
      textStyle: { color: '#94a3b8', fontFamily: 'Noto Sans SC', fontSize: 14 },
      left: 'center', top: 10
    },
    legend: {
      data: benchmarkData.map(d => d.algorithm),
      bottom: 10,
      textStyle: { color: '#94a3b8', fontFamily: 'JetBrains Mono, Noto Sans SC', fontSize: 11 },
      itemWidth: 14,
      itemHeight: 8
    },
    radar: {
      indicator: indicators,
      center: ['50%', '52%'],
      radius: '60%',
      splitNumber: 4,
      shape: 'polygon',
      axisName: {
        color: '#94a3b8',
        fontFamily: 'JetBrains Mono, Noto Sans SC',
        fontSize: 10
      },
      splitArea: {
        areaStyle: { color: ['rgba(0,242,255,0.02)', 'rgba(0,242,255,0.04)', 'rgba(0,242,255,0.02)', 'rgba(0,242,255,0.04)'] }
      },
      splitLine: { lineStyle: { color: 'rgba(0,242,255,0.1)' } },
      axisLine: { lineStyle: { color: 'rgba(0,242,255,0.15)' } }
    },
    series: [{
      type: 'radar',
      data: series
    }],
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(10,14,39,0.95)',
      borderColor: 'rgba(0,242,255,0.2)',
      textStyle: { color: '#e2e8f0', fontFamily: 'JetBrains Mono, Noto Sans SC', fontSize: 11 }
    }
  })
})

onBeforeUnmount(() => {
  radarChart?.dispose()
})
</script>

<template>
  <div class="lab-overlay" @click.self="emit('close')">
    <div class="lab-panel glass-panel">
      <div class="lab-header">
        <div class="section-title" style="margin-bottom: 0; padding-bottom: 0; border-bottom: none;">
          RESEARCH LABORATORY
        </div>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>

      <p class="lab-desc">
        基于 metrics_summary.csv，对比图着色 (Graph Coloring)、贪心 (Greedy)、静态 (Static) 三种算法在 Moderate 场景下的综合表现。
      </p>

      <div ref="radarChartEl" id="radar-box" class="radar-chart"></div>

      <!-- 结论 -->
      <div class="lab-conclusion">
        <div class="conclusion-title">📊 核心发现</div>
        <ul>
          <li>图着色算法在五个维度上全面领先，雷达面积最大</li>
          <li>相比 Greedy 算法，PDR 提升 <span class="highlight">+21.8%</span>，延迟降低 <span class="highlight">-25.7%</span></li>
          <li>在极端干扰场景下拓扑稳定性保持 <span class="highlight">91%</span> 以上</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lab-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(6px);
}

.lab-panel {
  width: 520px;
  padding: 24px;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.lab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
  cursor: pointer;
}

.close-btn:hover { color: var(--text-primary); }

.lab-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 12px;
}

.radar-chart {
  width: 100%;
  height: 350px;
}

.lab-conclusion {
  margin-top: 12px;
  padding: 12px;
  background: rgba(0, 242, 255, 0.03);
  border: 1px solid rgba(0, 242, 255, 0.1);
  border-radius: var(--radius-sm);
}

.conclusion-title {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.lab-conclusion ul {
  list-style: none;
  padding: 0;
}

.lab-conclusion li {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 3px 0;
  padding-left: 12px;
  position: relative;
}

.lab-conclusion li::before {
  content: '▸';
  position: absolute;
  left: 0;
  color: var(--cyan);
}

.highlight {
  color: var(--green);
  font-family: var(--font-mono);
  font-weight: 700;
}
</style>
