/**
 * 阵型状态管理 composable
 * 提供当前阵型的响应式状态和切换方法
 */
import { ref } from 'vue'
import type { FormationType } from '../data/mockData'

export const currentFormation = ref<FormationType>('v_formation')

export const formationLabels: Record<FormationType, string> = {
    v_formation: 'V字形',
    line: '直线型',
    triangle: '三角形',
    cross: '十字形'
}

export const formationIcons: Record<FormationType, string> = {
    v_formation: '🔻',
    line: '➖',
    triangle: '🔺',
    cross: '✚'
}

export function switchFormation(type: FormationType) {
    currentFormation.value = type
}
