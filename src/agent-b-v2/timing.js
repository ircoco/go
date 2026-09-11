/* @qh-core LANE=B-V2 POINT=TIMING 160cpm + 1D single-hand row-group timeline */
export const AGENT_B_V2_SPEECH_RATE = 160
export const AGENT_B_V2_ROW_GAP_MS = 1500
export const BASE_CHAR_WRITE_MS = 400 // 1秒2~3字（基准 2.5 字/秒 = 400ms/字）
export const HAND_LIFT_GAP_MS = 600   // 动作抬笔换手间隔

function normalizeSpeech(speech) {
  return String(speech || '').trim()
}

function countCharacters(speech) {
  // 语速按纯文字计算，去掉空白和中英文标点
  return [...normalizeSpeech(speech)
    .replace(/\s+/g, '')
    .replace(/[。，、；：？！""''（）《》【】……—.,!?;:'"()[\]<>~`@#$%^&*_+=|\\/]/g, '')].length
}

// 中文标点停顿时长：句号700ms / 逗号500ms / 省略号1000ms
function countPunctuationPause(speech) {
  const text = String(speech || '')
  const periodCount = (text.match(/。/g) || []).length
  const commaCount = (text.match(/，/g) || []).length
  const ellipsisCount = (text.match(/…+/g) || []).length
  return periodCount * 700 + commaCount * 500 + ellipsisCount * 1000
}

/**
 * 计算板书书写耗时预估（1秒2~3字，带微弱抖动区间）
 */
export function calculateBoardWritingDuration(content) {
  const text = String(content || '').trim()
  if (!text) return 0
  // 去除 LaTeX 结构控制符后统计实际有效笔墨字符量
  const clean = text
    .replace(/\\(begin|end)\{[^}]+\}/g, '')
    .replace(/\\(frac|times|div|aligned)/g, ' ')
    .replace(/\s+/g, '')
  const charCount = Math.max(1, [...clean].length)

  let durationMs = 0
  for (let i = 0; i < charCount; i++) {
    // 微弱抖动感：在 360ms ~ 440ms 之间轻微浮动，呈现真人书写节奏
    const jitter = ((i * 17) % 7 - 3) * 10
    durationMs += Math.max(320, BASE_CHAR_WRITE_MS + jitter)
  }
  return durationMs
}

/**
 * 单个动作的基准时长预估
 */
function estimateActionDuration(action) {
  const tool = action?.tool || action?.action?.tool || ''
  if (tool === 'rough-notation') return 1200
  if (tool === 'rough-line') return 800
  if (tool === 'rough-arrow') return 900
  return 1000
}

/**
 * 计算单个 Row 组内部的一维串行时间线（单手绝对互斥，不可重叠）
 */
export function computeRowGroupTimeline(row, options = {}) {
  const speech = normalizeSpeech(row.speech)
  const speechCharacters = countCharacters(speech)
  const punctuationPauseMs = countPunctuationPause(speech)

  // 1. 口播时长
  const speechDurationMs = speechCharacters > 0
    ? Math.max(1200, Math.round(speechCharacters * 60000 / AGENT_B_V2_SPEECH_RATE) + punctuationPauseMs)
    : 1500

  // 2. 板书起手节点与书写时长
  const boardContent = String(row.board?.content ?? (typeof row.board === 'string' ? row.board : '')).trim()
  const hasBoard = Boolean(boardContent)

  let boardStartDelayMs = 0
  let boardDurationMs = 0
  let boardEndDelayMs = 0

  if (hasBoard) {
    const rawStartDelay = row.board?.startDelay
    if (typeof rawStartDelay === 'number' && rawStartDelay > 0) {
      boardStartDelayMs = Math.round(rawStartDelay * 1000)
    } else {
      // 默认起手节点自适应：口播开始约 1.2s~2.0s 念到关键词后再开始落笔手写
      boardStartDelayMs = Math.min(2000, Math.max(1000, Math.round(speechDurationMs * 0.2)))
    }
    boardDurationMs = calculateBoardWritingDuration(boardContent)
    boardEndDelayMs = boardStartDelayMs + boardDurationMs
  }

  // 3. 动作排期：单手操作，绝对不与板书重叠，动作按顺序串行执行
  const actionSpec = Array.isArray(row.actionSpec) ? row.actionSpec : []
  let handCursorMs = hasBoard ? (boardEndDelayMs + HAND_LIFT_GAP_MS) : 500
  const actionTimeline = []

  for (let idx = 0; idx < actionSpec.length; idx++) {
    const act = actionSpec[idx]
    const dur = estimateActionDuration(act)
    const startMs = handCursorMs
    const endMs = startMs + dur
    actionTimeline.push({
      index: idx,
      action: act,
      startOffsetMs: startMs,
      durationMs: dur,
      endOffsetMs: endMs,
    })
    handCursorMs = endMs + HAND_LIFT_GAP_MS
  }

  const handWorkEndMs = actionSpec.length > 0 ? (handCursorMs - HAND_LIFT_GAP_MS) : boardEndDelayMs
  // Row 组总耗时：口播音频与黑板单手动作两者取最大值
  const rowTotalDurationMs = Math.max(speechDurationMs, handWorkEndMs)

  return {
    speechDurationMs,
    boardStartDelayMs,
    boardDurationMs,
    boardEndDelayMs,
    actionTimeline,
    handWorkEndMs,
    rowTotalDurationMs,
  }
}

/**
 * 对 rows 进行 Row 组全局一维时间线并列串联
 */
export function applyAgentBV2Timeline(rows, options = {}) {
  const rowGapMs = Number.isFinite(options.rowGapMs) && options.rowGapMs > 0
    ? options.rowGapMs
    : AGENT_B_V2_ROW_GAP_MS
  let globalCursorMs = 0 // 全局累计

  return rows.map((row) => {
    const speech = normalizeSpeech(row.speech)
    const speechCharacters = countCharacters(speech)
    const timeline = computeRowGroupTimeline(row, options)

    const estimatedDurationMs = timeline.rowTotalDurationMs
    const estimatedStartMs = globalCursorMs
    const estimatedEndMs = estimatedStartMs + estimatedDurationMs
    globalCursorMs = estimatedEndMs + rowGapMs

    return {
      ...row,
      speech,
      timingStatus: 'estimated',
      timingSource: 'agent-b-v2-1d-row-group',
      speechCharacters,
      estimatedDurationMs,
      estimatedStartMs,
      estimatedEndMs,
      rowTimeline: {
        ...timeline,
        globalStartMs: estimatedStartMs,
        globalEndMs: estimatedEndMs,
      },
    }
  })
}
