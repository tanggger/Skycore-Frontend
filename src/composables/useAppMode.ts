import { ref, computed } from 'vue'

export type AppMode = 'entry' | 'cooperative' | 'non_cooperative'
export type SceneType = 'city' | 'forest' | 'open' | 'wild'

/** 前端 SceneType → 后端 sceneType 映射 */
const sceneTypeMap: Record<SceneType, string> = {
  city: 'urban',
  forest: 'forest',
  open: 'lake',
  wild: 'open-field'
}

/** 后端 sceneType → 前端 SceneType 映射 */
const reverseSceneTypeMap: Record<string, SceneType> = {
  urban: 'city',
  forest: 'forest',
  lake: 'open',
  'open-field': 'wild'
}

// 全局唯一的应用状态
export const currentAppMode = ref<AppMode>('entry')
export const currentScene = ref<SceneType>('city')

export function useAppMode() {
  const setMode = (mode: AppMode) => {
    currentAppMode.value = mode
  }
  
  const setScene = (scene: SceneType) => {
    currentScene.value = scene
  }

  /** 当前场景对应的后端 sceneType 值 */
  const backendSceneType = computed(() => sceneTypeMap[currentScene.value] || 'urban')

  /** 当前 appMode 对应的后端 operationMode 值 */
  const backendOperationMode = computed<'cooperative' | 'non_cooperative'>(() => {
    return currentAppMode.value === 'non_cooperative' ? 'non_cooperative' : 'cooperative'
  })

  /** 从后端 sceneType 设置前端场景 */
  function setSceneFromBackend(backendScene: string) {
    const mapped = reverseSceneTypeMap[backendScene]
    if (mapped) currentScene.value = mapped
  }

  return {
    currentAppMode,
    currentScene,
    setMode,
    setScene,
    backendSceneType,
    backendOperationMode,
    setSceneFromBackend
  }
}
