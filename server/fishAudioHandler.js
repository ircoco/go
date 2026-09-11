import { createHash } from 'crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUDIO_CACHE_DIR = resolve(__dirname, '../public/audio-cache')

const DEFAULT_API_KEYS = [
  'sk-fish-5-R0Y_BCg8RXVY_iaokb0BAWLY1jc9p90F9zaox9FWk',
  'sk-fish-MYToCn_B0xhQT-9H4tV_YXR9aTwWg_-CjHWkXli4iec',
]
const DEFAULT_MODEL = 's2.1-pro-free'
const DEFAULT_REFERENCE_ID = '67ec5cfd705947969b723d0ad165c787'

let currentKeyIndex = 0

function maskKey(key) {
  if (!key || typeof key !== 'string') return ''
  if (key.length <= 16) return key.slice(0, 6) + '***'
  return `${key.slice(0, 11)}...${key.slice(-6)}`
}

export function getApiKeys() {
  const envKeys = process.env.FISH_AUDIO_API_KEYS
    ? process.env.FISH_AUDIO_API_KEYS.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  if (process.env.FISH_AUDIO_API_KEY && !envKeys.includes(process.env.FISH_AUDIO_API_KEY)) {
    envKeys.unshift(process.env.FISH_AUDIO_API_KEY)
  }
  const all = [...new Set([...envKeys, ...DEFAULT_API_KEYS])]
  return all.length > 0 ? all : DEFAULT_API_KEYS
}

function ensureAudioCacheDir() {
  if (!existsSync(AUDIO_CACHE_DIR)) {
    mkdirSync(AUDIO_CACHE_DIR, { recursive: true })
  }
}

function getAudioHash(text, referenceId, model) {
  return createHash('md5')
    .update(`${text || ''}::${referenceId || ''}::${model || ''}`)
    .digest('hex')
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function readJsonBody(req) {
  return new Promise((resolvePromise, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      if (!raw) {
        resolvePromise({})
        return
      }
      try {
        resolvePromise(JSON.parse(raw))
      } catch (err) {
        reject(new Error('Invalid JSON: ' + err.message))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 调用 Fish Audio API 进行语音合成（支持多Key自动轮换与故障转移）
 */
export async function synthesizeSpeech({
  text,
  referenceId = DEFAULT_REFERENCE_ID,
  model = DEFAULT_MODEL,
  apiKey,
}) {
  if (!text || typeof text !== 'string') {
    throw new Error('缺少有效文本 text')
  }

  ensureAudioCacheDir()
  const cleanText = text.trim()
  const hash = getAudioHash(cleanText, referenceId, model)
  const filename = `${hash}.mp3`
  const filePath = resolve(AUDIO_CACHE_DIR, filename)
  const audioUrl = `/audio-cache/${filename}`

  // 若已缓存且文件有效，直接返回
  if (existsSync(filePath)) {
    try {
      const stat = readFileSync(filePath)
      if (stat && stat.length > 500) {
        return {
          ok: true,
          audioUrl,
          cached: true,
          hash,
          model,
          referenceId,
        }
      }
    } catch {
      // ignore
    }
  }

  // 获取可用 key 列表并自动轮换
  const allKeys = getApiKeys()
  const candidateKeys = apiKey ? [apiKey] : allKeys

  let lastError = null
  const startIndex = apiKey ? 0 : (currentKeyIndex++) % candidateKeys.length

  for (let attempt = 0; attempt < candidateKeys.length; attempt++) {
    const activeKey = candidateKeys[(startIndex + attempt) % candidateKeys.length]
    try {
      const response = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeKey}`,
          'Content-Type': 'application/json',
          'model': model,
        },
        body: JSON.stringify({
          text: cleanText,
          reference_id: referenceId,
          format: 'mp3',
        }),
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}: ${errText || response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      writeFileSync(filePath, buffer)

      return {
        ok: true,
        audioUrl,
        cached: false,
        hash,
        model,
        referenceId,
        usedKey: maskKey(activeKey),
      }
    } catch (err) {
      lastError = err
      console.warn(`[FishAudio] Key (${maskKey(activeKey)}) 请求异常，准备轮换下一个 Key:`, err.message)
      // 继续循环尝试下一个 key
    }
  }

  throw lastError || new Error('所有可用 Fish Audio Key 均调用失败')
}

/**
 * 轻量并发调度器 (限制并发数为 1~2)
 */
async function mapConcurrent(items, limit, workerFn) {
  if (!items.length) return []
  const results = new Array(items.length)
  let nextIndex = 0
  const concurrency = Math.min(Math.max(1, limit), items.length)
  const workers = new Array(concurrency).fill(0).map(async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++
      try {
        results[idx] = await workerFn(items[idx], idx)
      } catch (err) {
        results[idx] = { ok: false, error: err.message || String(err) }
      }
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 处理 TTS 相关 HTTP 接口
 */
export async function handleFishAudioRequest(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname.replace(/^\/api\/tts/, '')

  // GET /api/tts/info — 获取当前语音配置信息及轮换池状态
  if (req.method === 'GET' && (path === '/info' || path === '')) {
    const keys = getApiKeys()
    sendJson(res, 200, {
      ok: true,
      provider: 'fish-audio',
      model: DEFAULT_MODEL,
      referenceId: DEFAULT_REFERENCE_ID,
      keyCount: keys.length,
      keys: keys.map(maskKey),
      docs: 'https://docs.fish.audio/developer-guide/getting-started/quickstart',
    })
    return true
  }

  // POST /api/tts/synthesize — 单条文本语音合成（自动轮换 Key）
  if (req.method === 'POST' && path === '/synthesize') {
    try {
      const body = await readJsonBody(req)
      const { text, referenceId, model, apiKey } = body
      const result = await synthesizeSpeech({ text, referenceId, model, apiKey })
      sendJson(res, 200, result)
      return true
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message || String(error),
      })
      return true
    }
  }

  // POST /api/tts/batch — 批量文本语音合成（一次并发 1-2 个，自动轮换 Key）
  if (req.method === 'POST' && path === '/batch') {
    try {
      const body = await readJsonBody(req)
      const items = Array.isArray(body.items) ? body.items : []
      const referenceId = body.referenceId || DEFAULT_REFERENCE_ID
      const model = body.model || DEFAULT_MODEL
      const concurrency = Math.min(2, Math.max(1, Number(body.concurrency) || 2))

      const results = await mapConcurrent(items, concurrency, async (item, index) => {
        const text = typeof item === 'string' ? item : item.text || item.speech
        const id = item.id !== undefined ? item.id : index + 1
        if (!text) {
          return { id, text: '', ok: false, error: '空文本' }
        }
        try {
          const resItem = await synthesizeSpeech({ text, referenceId, model })
          return { id, text, ok: true, ...resItem }
        } catch (e) {
          return { id, text, ok: false, error: e.message || String(e) }
        }
      })

      sendJson(res, 200, {
        ok: true,
        concurrency,
        items: results,
      })
      return true
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) })
      return true
    }
  }

  return false
}

export function fishAudioPlugin() {
  return {
    name: 'fish-audio-proxy',
    configureServer(server) {
      ensureAudioCacheDir()
      server.middlewares.use('/api/tts', (req, res, next) => {
        Promise.resolve(handleFishAudioRequest(req, res))
          .then((handled) => {
            if (!handled) next()
          })
          .catch(next)
      })
    },
  }
}
