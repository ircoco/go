/* @qh-core LANE=B-V2 POINT=API_PROXY /api/agent-b-v2/generate inject prompt+preview
 * 注意：本代理不再读取 .env 中的 API Key。
 * apiKey / endpoint / model 全部由前端用户填写后随请求体传入。
 */
import { AGENT_B_V2_SYSTEM_PROMPT } from '../src/agent-b-v2/prompt.js'
import { parseAgentBV2Response } from '../src/agent-b-v2/contract.js'

const UPSTREAM_TIMEOUT_MS = 90000

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function getMessageText(message) {
  if (typeof message?.content === 'string') return message.content
  if (!Array.isArray(message?.content)) return ''
  return message.content.map((item) => item?.text || '').join('')
}

/**
 * 从请求体读取用户自填的 apiKey/endpoint/model，做最小校验。
 * 不再提供 fallback 默认值——前端必须传齐三件套，否则报错。
 * 避免用错服务或用不支持多模态的模型。
 */
function resolveUserCredentials(body) {
  const apiKey = String(body?.apiKey || '').trim()
  const endpointStr = String(body?.endpoint || '').trim()
  const model = String(body?.model || '').trim()
  if (!apiKey) {
    const err = new Error('缺少 apiKey：请在前端「Agent 配置」里填写用户自己的 API Key')
    err.code = 'MISSING_API_KEY'
    throw err
  }
  if (!endpointStr) {
    const err = new Error('缺少 endpoint：请在前端「Agent 配置」里填写上游 API URL')
    err.code = 'MISSING_ENDPOINT'
    throw err
  }
  if (!model) {
    const err = new Error('缺少 model：请在前端「Agent 配置」里填写支持多模态的模型名（如 gpt-5.6-terra）')
    err.code = 'MISSING_MODEL'
    throw err
  }
  let endpoint
  try {
    endpoint = new URL(endpointStr)
  } catch {
    throw new Error('Endpoint 不是合法 URL')
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error('Endpoint 只支持 http/https')
  }
  const baseURL = endpoint.toString().replace(/\/$/, '')
  return { apiKey, baseURL, model }
}

export function agentBV2ProxyPlugin() {
  return {
    name: 'agent-b-v2-direct-proxy',
    configureServer(server) {
      server.middlewares.use('/api/agent-b-v2/generate', async (req, res, next) => {
        if (req.method === 'OPTIONS') return sendJson(res, 204, {})
        if (req.method !== 'POST') return next()

        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          let apiKey, baseURL, model
          try {
            ;({ apiKey, baseURL, model } = resolveUserCredentials(body))
          } catch (err) {
            return sendJson(res, String(err.code || '').startsWith('MISSING_') ? 400 : 500, { ok: false, error: err.message })
          }
          if (!body.userPayload?.boardPlan || !body.userPayload?.problemText) {
            return sendJson(res, 400, { ok: false, error: '新线缺少已确认题目或实时 boardPlan' })
          }
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
          let upstream
          let raw
          try {
            upstream = await fetch(`${baseURL}/chat/completions`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              signal: controller.signal,
              body: JSON.stringify({
                model,
                temperature: Number(body.temperature ?? 0.5),
                stream: false,
                response_format: { type: 'json_object' },
                messages: [
                  { role: 'system', content: AGENT_B_V2_SYSTEM_PROMPT },
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: `【结构化输入】\n${JSON.stringify(body.userPayload, null, 2)}` },
                      ...(body.previewDataUrl
                        ? [
                            { type: 'text', text: '【真画布预览图】已提供。先看图，再按实时 boardPlan 定位。' },
                            { type: 'image_url', image_url: { url: body.previewDataUrl } },
                          ]
                        : [
                            { type: 'text', text: '【真画布预览图】未提供。只按结构化输入中的动态 boardPlan 和 zoneAnchors 定位，不得假定截图内容。' },
                          ]),
                    ],
                  },
                ],
              }),
            })
            raw = await upstream.text()
          } catch (error) {
            if (error?.name === 'AbortError') {
              return sendJson(res, 504, { ok: false, error: 'Agent B 新线上游请求超过 90 秒，已取消' })
            }
            throw error
          } finally {
            clearTimeout(timeoutId)
          }

          let data
          try {
            data = raw ? JSON.parse(raw) : {}
          } catch {
            data = { raw }
          }
          if (!upstream.ok) {
            return sendJson(res, upstream.status, {
              ok: false,
              error: data?.error?.message || data?.message || `上游失败 ${upstream.status}`,
            })
          }

          const text = getMessageText(data?.choices?.[0]?.message)
          const parsed = parseAgentBV2Response(text)
          if (!parsed.ok) {
            return sendJson(res, 422, {
              ok: false,
              code: 'AGENT_B_V2_CONTRACT_INVALID',
              error: parsed.error,
              finishReason: data?.choices?.[0]?.finish_reason || '',
              usage: data?.usage || null,
              diagnostic: { rawTextHead: text.slice(0, 500) },
            })
          }

          return sendJson(res, 200, {
            ok: true,
            model,
            rows: parsed.value,
            finishReason: data?.choices?.[0]?.finish_reason || '',
            usage: data?.usage || null,
          })
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: error?.message || String(error) })
        }
      })
    },
  }
}
