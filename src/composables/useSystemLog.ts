import { ref } from 'vue';

export const logs = ref<string[]>([])

export function sysLog(msg: string) {
    const time = new Date().toLocaleTimeString('en-US', {hour12: false})
    logs.value.unshift(`[${time}] ${msg}`)
    if (logs.value.length > 50) logs.value.pop()
}