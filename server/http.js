const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export function applyCors(req, res) {
  const origin = String(req.headers?.origin || '').trim()
  const allowedOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  for (const [key, value] of Object.entries(JSON_HEADERS)) res.setHeader(key, value)
}

export function sendJson(req, res, statusCode, payload) {
  applyCors(req, res)
  res.statusCode = statusCode
  res.end(JSON.stringify(payload))
}

export function isOptions(req, res) {
  if (req.method !== 'OPTIONS') return false
  sendJson(req, res, 204, {})
  return true
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}')
    } catch {
      return {}
    }
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

export function getChatMessageText(message) {
  if (typeof message?.content === 'string') return message.content
  if (!Array.isArray(message?.content)) return ''
  return message.content.map((item) => item?.text || '').join('')
}

export function resolveUserCredentials(body) {
  const apiKey = String(body?.apiKey || '').trim()
  const endpoint = String(body?.endpoint || '').trim()
  const model = String(body?.model || '').trim()
  if (!apiKey) throw Object.assign(new Error('缺少 apiKey：请在前端「Agent 配置」里填写用户自己的 API Key'), { code: 'MISSING_API_KEY' })
  if (!endpoint) throw Object.assign(new Error('缺少 endpoint：请在前端「Agent 配置」里填写完整接口 URL'), { code: 'MISSING_ENDPOINT' })
  if (!model) throw Object.assign(new Error('缺少 model：请在前端「Agent 配置」里填写支持多模态的模型名'), { code: 'MISSING_MODEL' })

  let url
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('Endpoint 不是合法 URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Endpoint 只支持 http/https')
  const allowedHosts = String(process.env.UPSTREAM_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  if (allowedHosts.length && !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error('Endpoint 域名不在 UPSTREAM_HOSTS 白名单')
  }
  return { apiKey, endpoint, model }
}

export async function requestChatCompletion({ endpoint, apiKey, model, body, timeoutMs = 300000 }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({ model, ...body }),
      })
      const raw = await response.text()
      let data
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        data = { raw }
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      if (attempt === 0 && retryable) continue
      return { response, data }
    } catch (error) {
      if (attempt === 1) throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

export async function requestAnthropicMessage({ endpoint, apiKey, model, body, timeoutMs = 300000 }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({ model, ...body }),
      })
      const raw = await response.text()
      let data
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        data = { raw }
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      if (attempt === 0 && retryable) continue
      return { response, data }
    } catch (error) {
      if (attempt === 1) throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

