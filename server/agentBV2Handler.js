import fs from 'node:fs'
import path from 'node:path'
import { AGENT_B_V2_SYSTEM_PROMPT } from '../src/agent-b-v2/prompt.js'
import { getSkillById, DEFAULT_SKILL_ID } from '../src/agent-b-v2/skills/index.js'
import { parseAgentBV2Response, normalizeAgentBV2BoardCells, sanitizeRowLayout, AGENT_B_V2_STAGES } from '../src/agent-b-v2/contract.js'
import { writeResultFile } from './boardResultStore.js'
import {
  isOptions,
  readJsonBody,
  requestAnthropicMessage,
  requestChatCompletion,
  resolveUserCredentials,
  sendJson,
  getChatMessageText,
} from './http.js'

// ---------- 软降级：尽量从模型输出中提取可用的 rows ----------
function parseJsonObjectLoose(text) {
  const source = String(text || '').trim()
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || source
  try { return JSON.parse(candidate) } catch { /* fall through */ }
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(candidate.slice(start, end + 1)) } catch { return null }
}

function tryExtractFallbackRows(text) {
  const parsed = parseJsonObjectLoose(text)
  if (!parsed || typeof parsed !== 'object') return null
  if (!Array.isArray(parsed.rows) || !parsed.rows.length) return null

  // 用 contract 的归一化函数提取能用的行
  // 非法 stage 会被兜底修正，非法 actionSpec 会被过滤掉
  const normalized = normalizeAgentBV2BoardCells(parsed.rows)
  return normalized.length ? normalized : null
}

const AGENT_B_SYSTEM_MESSAGE = AGENT_B_V2_SYSTEM_PROMPT
// ⚠️⚠️⚠️ 发给 Agent B 的白名单字段，只有这里列出的字段才会发给 B ⚠️⚠️⚠️
// 以下字段绝对不发给 B（本地存档字段，防止 agent 摸鱼误加）：
//   - knowledgeBasePath: 知识库文件地址（修缮 API 后端自己读，不发给 B）
//   - confirmedAt: 确认时间戳
//   - showGrid: 是否显示网格
//   - agentPageName: Agent 页面名称
//   - agentCapability: Agent 能力描述
const HANDOFF_TEXT_FIELDS = [
  'handoffVersion',
  'problemText',
  'problemType',
  'boardFocus',
  'relatedKnowledge',
  'knowledgeAnalysis',
  'suggestedGrade',
  'uncertainItems',
  'suggestedLayout',
  'imageKind',
  'keepOriginal',
  'coordinateSpec',
  'zoneAnchors',
  'topicLayout',
  'boardPlan',
  'canvasParams',
  'stageRatioSuggestion',
  'screenshotUrl',
]

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// handoff 字段注释：和数据一起发给模型，模型读 JSON 时第一眼就看到每个字段干嘛的
// 注释字段以 _ 开头，放在对应数据字段的紧前面（像代码注释一样）
const HANDOFF_FIELD_NOTES = {
  problemText: '题目原文，一字不改，所有分析的基础',
  problemType: '题目类型，仅参考，不要硬套',
  boardFocus: '板书侧重点，参考用',
  relatedKnowledge: '【参考】关联知识点+解题思路，按需取用，不要硬塞不要照抄；和本题无关的不用；用的时候用自己的话讲出来',
  knowledgeAnalysis: '【重要】A 侧深度知识点分析\n' +
    '  · teachingFocus：教学方向锚点，整道题的讲解和总结围绕这个核心展开，别因为口语化就把重点讲散了\n' +
    '  · keyFormulaList：关键公式清单，解题真正用到的公式，分析区至少写一次\n' +
    '  · formulaHints：公式提示（公式名+内容+适用场景），cue 公式时参考\n' +
    '  · commonMistakes：易错点清单，讲解过程中顺嘴提一句做提醒（"这里行不行呀？""容易错哈！"），不是单独列出来逐条讲\n' +
    '  · coreKnowledge：知识库完整匹配记录，参考用',
  boardPlan: '四区布局规划【坐标定位与四区舞台指南】：明确题目区、分析区、解答区、总结区的可用空间范围(x/y/w/h)；起手坐标参考本区范围，落在区域内即可',
  zoneAnchors: '区域锚点【硬约束】：板书内容和动作坐标不得超出对应区域的 x/y/w/h 范围',
  canvasParams: '画布真实舞台参数（尺寸/字号/行高/速度真实值），必须以此为准感知舞台规格与每行高度，确定行间距与垂直跨度',
  screenshotUrl: '【画布舞台截图与视觉参考】本次画布舞台的截图地址/URL。若支持视觉识别，可直接观察截图中题目原图真实排布与留白，结合 canvasParams/boardPlan/zoneAnchors 做更优起手定位与避让',
  coordinateSpec: '坐标系说明（百分比坐标 0—100，原点左上），实际输出格式由 coordinateMode 决定',
  suggestedGrade: '建议年级，学段适配参考',
  suggestedLayout: '建议布局，仅参考，以 boardPlan 为准',
  stageRatioSuggestion: '题型配比建议（各 stage 占比），调整行数和内容深度的参考',
  topicLayout: '【冗余兼容字段】题目区布局，优先用 boardPlan.question 和 zoneAnchors.question',
}

function normalizeAgentBPromptHandoff(payload = {}) {
  const source = isRecord(payload) ? payload : {}
  const entries = []
  for (const key of HANDOFF_TEXT_FIELDS) {
    if (source[key] === undefined) continue
    // 在数据字段前面加注释字段（像代码注释一样，第一眼就能看到）
    if (HANDOFF_FIELD_NOTES[key]) {
      entries.push([`_${key}_说明`, HANDOFF_FIELD_NOTES[key]])
    }
    entries.push([key, source[key]])
  }
  const result = Object.fromEntries(entries)
  // ⚠️ 断言校验：确保本地存档字段绝对不发给 B（防 agent 摸鱼）
  const FORBIDDEN_FIELDS = ['knowledgeBasePath']
  for (const field of FORBIDDEN_FIELDS) {
    if (result[field] !== undefined) {
      throw new Error(`安全校验失败：${field} 不应发给 Agent B，请检查 HANDOFF_TEXT_FIELDS 白名单`)
    }
  }
  return result
}

function toAnthropicContent(content) {
  return content.flatMap((item) => {
    if (item.type === 'text') return [{ type: 'text', text: item.text }]
    const url = item.image_url?.url
    const dataUrl = typeof url === 'string' && url.match(/^data:([^;]+);base64,(.+)$/)
    if (dataUrl) {
      return [{
        type: 'image',
        source: { type: 'base64', media_type: dataUrl[1], data: dataUrl[2] },
      }]
    }
    if (typeof url === 'string') {
      return [{ type: 'image', source: { type: 'url', url } }]
    }
    return []
  })
}

export async function handleAgentBV2Request(req, res) {
  if (isOptions(req, res)) return true
  if (req.method !== 'POST') return false

  try {
    const body = await readJsonBody(req)
    let credentials
    try {
      credentials = resolveUserCredentials(body)
    } catch (error) {
      return sendJson(req, res, 400, {
        ok: false,
        error: error.message,
      })
    }
    const handoff = body.handoff || {}
    // system prompt 优先级：用户自定义 > 指定 skill > 默认 v2 prompt
    let systemMessage
    if (typeof body.systemPrompt === 'string' && body.systemPrompt.trim()) {
      systemMessage = body.systemPrompt.trim()
    } else {
      const skillId = body.skillId || DEFAULT_SKILL_ID
      const skill = getSkillById(skillId)
      systemMessage = skill ? skill.buildSystemPrompt() : AGENT_B_SYSTEM_MESSAGE
    }
    const promptHandoff = normalizeAgentBPromptHandoff(handoff)
    const userContent = [
      { type: 'text', text: `【Agent A handoff】\nfile: handoff.json\n${JSON.stringify(promptHandoff, null, 2)}` },
    ]
    // 坐标输出模式：percentage（百分比 0-100）或 pixel（像素，基于画布尺寸换算）
    // 下游生成真实画布视频时有的要像素坐标，由用户选择后告诉模型按对应格式输出
    if (body.canvasParams?.coordinateMode) {
      userContent.push({ type: 'text', text: `【坐标输出模式】\ncoordinateMode: ${body.canvasParams.coordinateMode}\n说明：board.startCoord 和 actionSpec 中的��有坐标请按此模式输出。percentage = 百分比 0-100，pixel = 像素（基于 handoff.canvasParams.canvasSize 换算）。` })
    }

    // 明确告知本次画布舞台配置与视觉参考（canvasParams, boardPlan, zoneAnchors, screenshotUrl）
    const stageSummary = []
    if (promptHandoff.canvasParams) {
      const sz = promptHandoff.canvasParams.canvasSize || {}
      stageSummary.push(`- 画布舞台真实尺寸(canvasParams)：${sz.width || 1726}×${sz.height || 980}px（以此为准感知舞台规格与每行高度）`)
    }
    if (promptHandoff.boardPlan) {
      stageSummary.push(`- 四区划分规划(boardPlan)：题目区(question)、分析区(analysis)、解答区(solution)、总结区(summary)的空间范围`)
    }
    if (promptHandoff.zoneAnchors) {
      stageSummary.push(`- 区域锚点(zoneAnchors)：各区起手与物理边界硬约束`)
    }
    if (promptHandoff.screenshotUrl) {
      stageSummary.push(`- 画布截图(screenshotUrl)：${promptHandoff.screenshotUrl}（支持视觉识别的模型可直观参考排版与真实留白）`)
    }
    stageSummary.push(`- 起手坐标关键要求：每个 row 是一个不可拆分的小组（口播 speech + 对应板书 board + 对应动作 actionSpec），三者必须描述同一个教学时刻；row 与 row 之间要有自然距离，不能粘在一起。`)
    stageSummary.push(`- 坐标排版硬规则：同一 region 内相邻有板书内容的 row，起手 y 至少间隔一行手写字高；起手 x 至少保留一个字高的水平安全距离，优先使用 handoff 的 boardPlan/zoneAnchors，不要自行另造坐标真相。`)
    stageSummary.push(`- 只有一份真相：handoff 的 boardPlan、zoneAnchors、canvasParams 是布局输入；当前 row 的 board.startCoord 是该行最终起手点；导出 speech/handoff/结果文件只能同步这些字段，不得各自推导另一套坐标或改写字符转义规则。`)
    stageSummary.push(`- 板书风格：板书内容可以乱一些都没事，达芬奇手稿那种微微乱感就很好。无需过度紧绷，代码层会自动进行行间距防重叠与边界兜底。`)

    userContent.push({
      type: 'text',
      text: `【画布舞台感知与起手布局特别提醒】\n${stageSummary.join('\n')}`,
    })

    // 支持视觉识别的模型：若有本地截图文件，安全提供视觉多模态输入
    let screenshotDataUrl = null
    if (promptHandoff.screenshotUrl) {
      try {
        const rawUrl = String(promptHandoff.screenshotUrl).trim()
        if (rawUrl.startsWith('data:image/')) {
          screenshotDataUrl = rawUrl
        } else {
          const cleanPath = rawUrl.replace(/^\//, '')
          const fullPath = path.resolve(process.cwd(), 'public', cleanPath)
          if (fs.existsSync(fullPath)) {
            const ext = path.extname(fullPath).toLowerCase().slice(1) || 'jpeg'
            const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
            const base64 = fs.readFileSync(fullPath).toString('base64')
            screenshotDataUrl = `data:${mime};base64,${base64}`
          }
        }
      } catch (err) {
        console.warn('[Agent B] 截图读取跳过:', err.message)
      }
    }
    const isAnthropic = body.apiType === 'anthropic-messages'
    const modelLower = String(credentials.model || '').toLowerCase()
    const isVisionModel = isAnthropic || modelLower.includes('vision') || modelLower.includes('4o') || modelLower.includes('claude') || modelLower.includes('gemini')
    if (screenshotDataUrl && isVisionModel) {
      userContent.push({
        type: 'image_url',
        image_url: { url: screenshotDataUrl },
      })
    }

    const MAX_RETRIES = 1
    let parsed = null
    let lastText = ''
    let lastData = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const currentUserContent = attempt === 0
        ? userContent
        : [
            ...userContent,
            { type: 'text', text: `【上一次输出错误】${parsed.error}。请严格按照 stage 仅限"题目/分析/解答/总结"四种值重新输出完整五字段表，禁止使用"思路""讲解""过程""步骤""方法""计算""答案"等同义词。` },
          ]

      const { response, data } = isAnthropic
        ? await requestAnthropicMessage({
            ...credentials,
            timeoutMs: 90000,
            body: {
              system: systemMessage,
              max_tokens: 8192,
              temperature: Number(body.temperature ?? 0.7),
              messages: [{ role: 'user', content: toAnthropicContent(currentUserContent) }],
            },
          })
        : await requestChatCompletion({
            ...credentials,
            timeoutMs: 300000,
            body: {
              temperature: Number(body.temperature ?? 0.7),
              stream: false,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: currentUserContent },
              ],
            },
          })

      if (!response.ok) {
        return sendJson(req, res, response.status, {
          ok: false,
          error: data?.error?.message || data?.message || `上游失败 ${response.status}`,
        })
      }

      lastText = isAnthropic
        ? getChatMessageText(data)
        : getChatMessageText(data?.choices?.[0]?.message)
      lastData = data
      parsed = parseAgentBV2Response(lastText, {
        problemType: handoff?.problemType,
        allowSynonyms: attempt === MAX_RETRIES,
        boardPlan: handoff?.boardPlan,
        canvasParams: handoff?.canvasParams,
        coordinateMode: body.canvasParams?.coordinateMode,
      })

      if (parsed.ok) break
      // 只有 INVALID_STAGE 错误才自动重试，其他错误（JSON格式错等）直接返回
      if (parsed.code !== 'INVALID_STAGE') break
    }

    if (!parsed.ok) {
      // 软降级：解析失败时尽量提取能用的 rows，不直接报错
      // 只有完全拿不到 rows 时才返回错误
      const rawFallback = tryExtractFallbackRows(lastText)
      if (rawFallback && rawFallback.length) {
        const fallbackRows = sanitizeRowLayout(rawFallback, {
          boardPlan: handoff?.boardPlan,
          canvasParams: handoff?.canvasParams,
          coordinateMode: body.canvasParams?.coordinateMode,
        })
        const resultPayload = {
          rows: fallbackRows,
          model: credentials.model,
          skillId: body.skillId || DEFAULT_SKILL_ID,
          handoff: handoff || null,
          usage: lastData?.usage || null,
          finishReason: lastData?.stop_reason || lastData?.choices?.[0]?.finish_reason || '',
          createdAt: new Date().toISOString(),
          degraded: true,
          degradeReason: parsed.error,
          degradeCode: parsed.code || 'AGENT_B_V2_CONTRACT_INVALID',
        }
        const { projectCode, filename } = writeResultFile(resultPayload)
        return sendJson(req, res, 200, {
          ok: true,
          model: credentials.model,
          rows: fallbackRows,
          projectCode,
          filename,
          finishReason: lastData?.stop_reason || lastData?.choices?.[0]?.finish_reason || '',
          usage: lastData?.usage || null,
          degraded: true,
          degradeReason: parsed.error,
          degradeCode: parsed.code || 'AGENT_B_V2_CONTRACT_INVALID',
          warning: 'Agent B 输出格式不完全符合规范，已尽力提取可用内容，建议检查或重新生成',
        })
      }
      // 完全提取不出来才返回错误
      return sendJson(req, res, 422, {
        ok: false,
        code: parsed.code || 'AGENT_B_V2_CONTRACT_INVALID',
        error: parsed.error,
        finishReason: lastData?.stop_reason || lastData?.choices?.[0]?.finish_reason || '',
        usage: lastData?.usage || null,
        diagnostic: { rawTextHead: lastText.slice(0, 500), retried: parsed.code === 'INVALID_STAGE' },
      })
    }
    // 写入实体文件存档（B 生成结果的唯一真相源）
    const resultPayload = {
      rows: parsed.value,
      model: credentials.model,
      skillId: body.skillId || DEFAULT_SKILL_ID,
      handoff: handoff || null,
      usage: lastData?.usage || null,
      finishReason: lastData?.stop_reason || lastData?.choices?.[0]?.finish_reason || '',
      createdAt: new Date().toISOString(),
    }
    const { projectCode, filename } = writeResultFile(resultPayload)
    return sendJson(req, res, 200, {
      ok: true,
      model: credentials.model,
      rows: parsed.value,
      projectCode,
      filename,
      finishReason: lastData?.stop_reason || lastData?.choices?.[0]?.finish_reason || '',
      usage: lastData?.usage || null,
    })
  } catch (error) {
    const status = error?.name === 'AbortError' ? 504 : 500
    return sendJson(req, res, status, {
      ok: false,
      error: error?.name === 'AbortError' ? 'Agent B 上游大模型响应超时（已为您持续等待 300 秒），请检查网络或更换响应更快的大模型' : error?.message || String(error),
    })
  }
}

export function agentBV2ProxyPlugin() {
  return {
    name: 'agent-b-v2-direct-proxy',
    configureServer(server) {
      server.middlewares.use('/api/agent-b-v2/generate', (req, res, next) => {
        Promise.resolve(handleAgentBV2Request(req, res)).then((handled) => {
          if (!handled) next()
        }).catch(next)
      })
    },
  }
}
