/**
 * useBoardCapture — 真画布截图 composable（统一使用 window.snapdom）
 * Step1 / Step2 / AgentBDirect 共用此入口，禁止各自引用第三方截图库
 */
import { ref, nextTick } from 'vue'

const DEFAULT_OPTIONS = Object.freeze({
  cacheBust: true,
  pixelRatio: 1,
  backgroundColor: '#ffffff',
  embedFonts: false,
})

/**
 * @param {import('vue').Ref} elRef — 指向要截图的 DOM 元素的 ref
 * @returns {{ capture, captureStatus, captureError }}
 */
export function useBoardCapture(elRef) {
  const captureStatus = ref('idle') // 'idle' | 'capturing' | 'error'
  const captureError = ref('')

  /**
   * @param {{ quiet?: boolean, options?: object }} opts
   * @returns {Promise<string>} dataUrl，失败返回空串
   */
  async function capture({ quiet = false, options = {} } = {}) {
    if (!elRef.value) return ''
    if (!window.snapdom?.toPng) {
      captureStatus.value = 'error'
      captureError.value = 'window.snapdom.toPng 未载入'
      console.error('[useBoardCapture] snapdom 未就绪')
      return ''
    }
    captureStatus.value = 'capturing'
    captureError.value = ''
    try {
      await nextTick()
      await nextTick()
      await document.fonts?.ready
      const img = await window.snapdom.toPng(elRef.value, { ...DEFAULT_OPTIONS, ...options })
      const dataUrl = img?.src ?? ''
      captureStatus.value = 'idle'
      return dataUrl
    } catch (error) {
      captureStatus.value = 'error'
      captureError.value = error?.message || String(error)
      console.error('[useBoardCapture] 截图失败：', error)
      return ''
    }
  }

  return { capture, captureStatus, captureError }
}
