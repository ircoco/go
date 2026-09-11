/**
 * useAsyncAction — 统一异步操作状态机
 * 消除 Step1Entry + AgentBDirect 中重复的 state/errorText/message.error 模式
 */
import { ref } from 'vue'
import { message } from 'ant-design-vue'

/**
 * @returns {{ status, errorText, run }}
 * status: 'idle' | 'running' | 'error' | 'done'
 */
export function useAsyncAction() {
  const status = ref('idle')
  const errorText = ref('')

  /**
   * @param {() => Promise<T>} fn
   * @param {{ errorMessage?: string, onError?: (e: Error) => void }} opts
   * @returns {Promise<T | undefined>}
   */
  async function run(fn, { errorMessage, onError } = {}) {
    if (status.value === 'running') return undefined
    status.value = 'running'
    errorText.value = ''
    try {
      const result = await fn()
      status.value = 'idle'
      return result
    } catch (error) {
      status.value = 'error'
      errorText.value = error?.message || String(error)
      const msg = errorMessage || errorText.value
      message.error(msg)
      onError?.(error)
      return undefined
    }
  }

  return { status, errorText, run }
}
