/* @qh-core LANE=B-V2 POINT=CONTRACT_NORMALIZE model rows into board-readable fields */
import { validateBoardToolAction } from '../board-tools/boardToolCatalog.js'
import { BOARD_LAYOUT } from '../utils/boardLayout.js'
export const AGENT_B_V2_COLUMNS = Object.freeze([
  'stage',
  'speech',
  'board',
  'actionSpec',
])

export const AGENT_B_V2_STAGES = Object.freeze(['题目', '分析', '解答', '总结'])

// 环节别名容错表（温和吸附，防止大模型在长篇生成中因同义词导致整表抛弃）
const STAGE_SYNONYMS = Object.freeze({
  '思路': '分析',
  '讲解': '分析',
  '过程': '解答',
  '步骤': '解答',
  '计算': '解答',
  '答案': '解答',
  '题面': '题目',
  '题干': '题目',
  '小结': '总结',
  '回顾': '总结',
})

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStage(stage, index) {
  const clean = String(stage || '').trim()
  if (AGENT_B_V2_STAGES.includes(clean)) return clean
  if (STAGE_SYNONYMS[clean]) return STAGE_SYNONYMS[clean]

  const fallback = index === 0 ? '题目' : '分析'
  console.warn(`[AgentB contract] 非法 stage 值：${JSON.stringify(stage)}（第${index + 1}行），已温和校正为"${fallback}"。合法值仅限：题目/分析/解答/总结`)
  return fallback
}

// board 双兼容：v1.0 字符串 / v2.0 对象 {startCoord, content, startDelay}
// 统一归一化为 v2.0 对象格式输出（含起手延时 startDelay，单位：秒）
export function normalizeBoard(board) {
  if (isRecord(board)) {
    let startDelay = 0
    if (typeof board.startDelay === 'number' && Number.isFinite(board.startDelay) && board.startDelay >= 0) {
      startDelay = Number(board.startDelay.toFixed(2))
    } else if (typeof board.startDelay === 'string') {
      const match = board.startDelay.match(/[\d.]+/)
      if (match) {
        const val = parseFloat(match[0])
        if (Number.isFinite(val) && val >= 0) startDelay = Number(val.toFixed(2))
      }
    }
    return {
      startCoord: typeof board.startCoord === 'string' ? board.startCoord : '',
      content: typeof board.content === 'string' ? board.content : '',
      startDelay,
    }
  }
  if (typeof board === 'string') {
    return { startCoord: '', content: board, startDelay: 0 }
  }
  return { startCoord: '', content: '', startDelay: 0 }
}

function tryParseCandidate(str) {
  try {
    return JSON.parse(str)
  } catch {
    // 尝试修补常见的字符串内未转义换行与尾部残缺
    try {
      let patched = str.trim()
      if (patched.startsWith('{') && !patched.endsWith('}')) {
        if (patched.lastIndexOf(']') < patched.lastIndexOf('[')) {
          patched += ']}'
        } else {
          patched += '}'
        }
      }
      return JSON.parse(patched)
    } catch {
      return null
    }
  }
}

function parseJsonObject(text) {
  const source = String(text || '').trim()
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || source
  
  let res = tryParseCandidate(candidate)
  if (res && isRecord(res)) return res

  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    res = tryParseCandidate(candidate.slice(start, end + 1))
    if (res && isRecord(res)) return res
  }

  // 尝试在最深层的 { "rows" 块处截取
  const rowsIdx = candidate.indexOf('"rows"')
  if (rowsIdx > 0) {
    const subStart = candidate.lastIndexOf('{', rowsIdx)
    if (subStart >= 0) {
      res = tryParseCandidate(candidate.slice(subStart))
      if (res && isRecord(res)) return res
    }
  }

  return null
}

export function normalizeAgentBV2ActionSpec(actionSpec) {
  return (Array.isArray(actionSpec) ? actionSpec : []).flatMap((entry) => {
    if (!isRecord(entry)) return []
    if (entry.capabilityGap) return [{ ...entry }]

    const action = validateBoardToolAction(entry.action)
    if (!action.ok) return []
    return [{ ...entry, action: action.value }]
  })
}

export function normalizeAgentBV2BoardCells(rows) {
  return (Array.isArray(rows) ? rows : []).flatMap((row, index) => {
    if (!isRecord(row)) return []
    return [{
      stage: normalizeStage(row.stage, index),
      speech: typeof row.speech === 'string' ? row.speech : '',
      board: normalizeBoard(row.board),
      // 模型偶尔漏写 actionSpec 或动作不合规，保留该行而不是卡死整表。
      actionSpec: normalizeAgentBV2ActionSpec(row.actionSpec),
    }]
  })
}

/**
 * 代码层自动间距与容器高度防溢出兜底：
 * 1. 确保 row 与 row 之间有自然垂直距离，绝不粘在一起
 * 2. 依据 boardPlan 对应区域的 y + h 范围防止下界溢出
 * 3. 智能补充自适应 startDelay，不给 Agent B 增加繁琐物理计算负担
 */
export function sanitizeRowLayout(rows, options = {}) {
  if (!Array.isArray(rows) || !rows.length) return rows
  const boardPlan = options.boardPlan || {}
  const coordinateMode = options.coordinateMode || 'percentage'
  const isPixel = coordinateMode === 'pixel'

  // 四区缺省坐标基准 (百分比)
  // 只有 handoff.boardPlan 是动态布局输入；这里仅把已验证的公共布局作为兜底，
  // 避免合同层再维护一套会覆盖真实 boardPlan 的坐标真相。
  const defaultZoneBounds = {
    question: BOARD_LAYOUT.question,
    analysis: BOARD_LAYOUT.analysis,
    solution: BOARD_LAYOUT.solution,
    summary: BOARD_LAYOUT.summary,
  }

  const getBounds = (stageKey) => {
    const plan = boardPlan[stageKey] || defaultZoneBounds[stageKey] || defaultZoneBounds.analysis
    let x = typeof plan.x === 'number' ? plan.x : parseFloat(plan.x) || defaultZoneBounds[stageKey]?.x || 8
    let y = typeof plan.y === 'number' ? plan.y : parseFloat(plan.y) || defaultZoneBounds[stageKey]?.y || 38
    let w = typeof plan.w === 'number' ? plan.w : parseFloat(plan.w) || defaultZoneBounds[stageKey]?.w || 40
    let h = typeof plan.h === 'number' ? plan.h : parseFloat(plan.h) || defaultZoneBounds[stageKey]?.h || 50
    return { x, y, w, h }
  }

  const stageToKey = {
    '题目': 'question',
    '分析': 'analysis',
    '解答': 'solution',
    '总结': 'summary',
  }

  const zoneTracker = {
    question: { lastX: null, lastY: null, count: 0 },
    analysis: { lastX: null, lastY: null, count: 0 },
    solution: { lastX: null, lastY: null, count: 0 },
    summary: { lastX: null, lastY: null, count: 0 },
  }

  const canvasParams = options.canvasParams || {}
  const fontSizePx = Number(canvasParams?.fontSize?.analysis || canvasParams?.fontSize?.solution || 38)
  const lineHeight = Number(canvasParams?.lineHeight?.others || 1.7)
  const canvasHeight = Number(canvasParams?.canvasSize?.height || 980)
  // 相邻 row 至少留出一行手写字高；不能用固定 12% 覆盖真实区域高度。
  const lineHeightPct = Number.isFinite(fontSizePx) && Number.isFinite(lineHeight) && canvasHeight > 0
    ? (fontSizePx * lineHeight / canvasHeight) * 100
    : 6.6
  const minRowGap = isPixel ? Math.max(120, Math.round(fontSizePx * lineHeight)) : Number(Math.max(6.6, lineHeightPct).toFixed(2))
  const minHorizontalGap = isPixel ? Math.max(38, Math.round(fontSizePx)) : Number(Math.max(2.2, (fontSizePx / 1726) * 100).toFixed(2))

  return rows.map((row, index) => {
    if (!isRecord(row)) return row
    const stage = row.stage || (index === 0 ? '题目' : '分析')
    const zoneKey = stageToKey[stage] || 'analysis'
    const bounds = getBounds(zoneKey)
    const board = normalizeBoard(row.board)
    const content = board.content.trim()

    // 读题阶段通常无板书起手点
    if (stage === '题目' || !content) {
      return {
        ...row,
        board: {
          ...board,
          startCoord: stage === '题目' ? '' : board.startCoord,
        },
      }
    }

    let coordX = null
    let coordY = null
    let hasCoord = false
    const match = board.startCoord.match(/\[?\s*([\d.]+)(?:%|px)?\s*,\s*([\d.]+)(?:%|px)?\s*\]?/)
    if (match) {
      coordX = parseFloat(match[1])
      coordY = parseFloat(match[2])
      hasCoord = Number.isFinite(coordX) && Number.isFinite(coordY)
    }

    const tracker = zoneTracker[zoneKey]
    if (!hasCoord) {
      coordX = bounds.x
      coordY = tracker.lastY === null ? (bounds.y + (isPixel ? 20 : 2.0)) : (tracker.lastY + minRowGap)
    } else {
      // 若与上一行距离过近或发生倒流（坐标粘在一起/重叠）：代码层自动留出自然垂直距离
      if (tracker.lastY !== null) {
        if (coordY <= tracker.lastY || (coordY - tracker.lastY) < (isPixel ? 75 : 7.5)) {
          coordY = Number((tracker.lastY + minRowGap).toFixed(1))
        }
      } else {
        if (coordY < bounds.y) coordY = bounds.y
      }
    }

    // 同一 region 的 row 起手点必须在 x 轴保留至少一个字高的安全距离。
    // 若右移会越过区域，则保留真实 x，依靠 y 轴字高间距排版，不覆盖模型有效坐标。
    if (tracker.lastX !== null && Math.abs(coordX - tracker.lastX) < minHorizontalGap) {
      const shiftedX = tracker.lastX + minHorizontalGap
      if (shiftedX <= bounds.x + bounds.w - minHorizontalGap) coordX = shiftedX
    }

    // 容器高度防溢出：仅在区域仍有可落座空间时限位，不能把当前 row 拉回上一行造成重叠。
    const maxBottom = bounds.y + bounds.h - (isPixel ? 50 : 5.0)
    if (coordY > maxBottom && maxBottom > bounds.y && (tracker.lastY === null || maxBottom >= tracker.lastY + minRowGap)) {
      coordY = Number(maxBottom.toFixed(1))
    }

    // 智能补充 startDelay：若非题目阶段且有板书、但 startDelay 缺失或为 0，依口播长度自适应赋予 1.2s~2.0s
    let startDelay = board.startDelay
    if ((!startDelay || startDelay <= 0) && content && stage !== '题目') {
      const speechLen = (row.speech || '').length
      startDelay = Number(Math.min(2.2, Math.max(1.0, speechLen * 0.08)).toFixed(1))
    }

    // 估算本行板书所占高度（换行数）
    const lineCount = Math.max(1, content.split('\n').length)
    const estHeight = isPixel ? (lineCount * 40 + 25) : (lineCount * 4.0 + 2.5)
    tracker.lastX = coordX
    tracker.lastY = coordY + estHeight
    tracker.count += 1

    const finalCoordStr = isPixel
      ? `[${Math.round(coordX)}, ${Math.round(coordY)}]`
      : `[${coordX.toFixed(1)}%, ${coordY.toFixed(1)}%]`

    return {
      ...row,
      board: {
        ...board,
        startCoord: finalCoordStr,
        startDelay,
      },
    }
  })
}

export function validateAgentBV2Rows(rows, _options = {}) {
  let normalizedRows = normalizeAgentBV2BoardCells(rows)
  if (!normalizedRows.length) {
    return { ok: false, error: 'Agent B 必须返回至少一行五字段数据' }
  }
  normalizedRows = sanitizeRowLayout(normalizedRows, _options)
  return { ok: true, value: normalizedRows }
}

export function parseAgentBV2Response(text, _options = {}) {
  const parsed = parseJsonObject(text)
  if (!isRecord(parsed)) return { ok: false, error: 'Agent B 返回内容不是 JSON 对象' }
  if (!Array.isArray(parsed.rows)) return { ok: false, error: 'Agent B 返回内容没有可用的 rows 数组' }

  // 归一化前先检查原始 stage：先清除首尾空格；在兜底模式（allowSynonyms）下允许温和吸附
  const allowSynonyms = Boolean(_options?.allowSynonyms)
  const invalidStageRows = parsed.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      const clean = String(row?.stage || '').trim()
      if (AGENT_B_V2_STAGES.includes(clean)) return false
      if (allowSynonyms && STAGE_SYNONYMS[clean]) return false
      return true
    })
  if (invalidStageRows.length > 0) {
    const details = invalidStageRows
      .map(({ row, index }) => `第${index + 1}行 stage=${JSON.stringify(row?.stage)}`)
      .join('；')
    return {
      ok: false,
      code: 'INVALID_STAGE',
      error: `非法 stage 值（${details}）。stage 仅限四种："题目""分析""解答""总结"。禁止使用"思路""讲解""过程""步骤""方法""计算""答案"等同义词，请重新输出完整五字段表。`,
    }
  }

  return validateAgentBV2Rows(parsed.rows, _options)
}
