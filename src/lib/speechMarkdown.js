import { polishSpeechText } from '../check-agent/asrPolish.js'

export function buildElementsMarkdown(rows, meta = {}) {
  const sourceRows = Array.isArray(rows) ? rows : []
  const escapeCell = (value) => String(value ?? '')
    .replace(/\|/g, '&#124;')
    .replace(/\r?\n/g, '<br>')
  const formatActionSpec = (actionSpec) => {
    if (!Array.isArray(actionSpec) || !actionSpec.length) return '[]'
    return JSON.stringify(actionSpec, null, 2)
  }
  const title = String(meta.title || '讲题完整要素表')
  const metadata = [
    meta.problemText ? `- 题目：${String(meta.problemText).replace(/\r?\n/g, ' ')}` : '',
    meta.model ? `- 模型：${meta.model}` : '',
    meta.generatedAt ? `- 生成时间：${meta.generatedAt}` : '',
  ].filter(Boolean)

  // 画布参数 section
  const cp = meta.canvasParams
  const hcp = meta.handoffCanvasParams
  const hbp = meta.handoffBoardPlan

  const regionLabels = { question: '题目区', analysis: '分析区', solution: '解答区', summary: '总结区' }

  const canvasParamsSection = [
    '',
    '## 画布参数',
    '',
    '> 布局参数从 handoff 文件动态读取（Agent A 根据题目实时判断），为唯一真相源。',
    '',
  ]

  // handoff 画布参数（真相源）
  if (hcp) {
    canvasParamsSection.push(
      '### handoff 画布参数（真相源）',
      '',
      `| 参数 | 值 |`,
      `| --- | --- |`,
      `| 画布宽度 | ${hcp.canvasSize?.width ?? ''}px |`,
      `| 画布高度 | ${hcp.canvasSize?.height ?? ''}px |`,
      `| 坐标系统 | ${hcp.coordinateSystem || '百分比坐标 0-100'} |`,
      `| 题目区字号 | ${hcp.fontSize?.question?.px ?? ''}px |`,
      `| 题目区字体 | \`${hcp.fontSize?.question?.family || ''}\` |`,
      `| 题目区颜色 | ${hcp.fontSize?.question?.color || ''} |`,
      `| 分析区字号 | ${hcp.fontSize?.analysis?.px ?? ''}px |`,
      `| 分析区字体 | \`${hcp.fontSize?.analysis?.family || ''}\` |`,
      `| 分析区颜色 | ${hcp.fontSize?.analysis?.color || ''} |`,
      `| 解答区字号 | ${hcp.fontSize?.solution?.px ?? ''}px |`,
      `| 解答区字体 | \`${hcp.fontSize?.solution?.family || ''}\` |`,
      `| 解答区颜色 | ${hcp.fontSize?.solution?.color || ''} |`,
      `| 总结区字号 | ${hcp.fontSize?.summary?.px ?? ''}px |`,
      `| 总结区字体 | \`${hcp.fontSize?.summary?.family || ''}\` |`,
      `| 总结区颜色 | ${hcp.fontSize?.summary?.color || ''} |`,
      `| 题目区行高 | ${hcp.lineHeight?.question ?? ''} |`,
      `| 其他区行高 | ${hcp.lineHeight?.others ?? ''} |`,
      `| 板书速度 | ${hcp.boardSpeed || ''} |`,
      `| 动作速度 | ${hcp.actionSpeed || ''} |`,
      '',
    )
  }

  // handoff 四区布局（真相源）
  if (hbp) {
    canvasParamsSection.push(
      '### handoff 四区布局（真相源）',
      '',
      `| 区域 | 左% | 上% | 宽% | 高% |`,
      `| --- | ---: | ---: | ---: | ---: |`,
      ...['question', 'analysis', 'solution', 'summary'].map((key) => {
        const z = hbp[key] || {}
        return `| ${regionLabels[key] || key} | ${z.x ?? ''} | ${z.y ?? ''} | ${z.w ?? ''} | ${z.h ?? ''} |`
      }),
      '',
    )
  }

  // UI 可调参数
  if (cp) {
    canvasParamsSection.push(
      '### UI 可调参数（B 页面设置）',
      '',
      `| 参数 | 值 |`,
      `| --- | --- |`,
      `| 坐标计算方式 | ${cp.coordinateMode === 'percentage' ? '百分比' : (cp.coordinateMode || '百分比')} |`,
      `| 题目字号（UI） | ${cp.questionFontSize || 30}px |`,
      `| 题目字体（UI） | \`${cp.questionFontFamily || ''}\` |`,
      `| 题目行高（UI） | ${cp.questionLineHeight || 1.65} |`,
      `| 行间隔时长 | ${cp.rowGapMs || 1500}ms |`,
      `| 音频速度 | ${cp.speechSpeed || 160}字/分 |`,
      '',
    )
  }

  // 计算每个 stage 内的行号
  const stageRowCounts = {}
  const rowsWithRowInStage = sourceRows.map((row) => {
    const stage = row?.stage || '分析'
    stageRowCounts[stage] = (stageRowCounts[stage] || 0) + 1
    return { ...row, rowInStage: stageRowCounts[stage] }
  })

  const rowsText = rowsWithRowInStage.map((row, index) => {
    const { startCoord, content } = parseBoardField(row?.board)
    const boardText = startCoord ? `${startCoord} ${content}` : content
    return [
      index + 1,
      `${row?.stage || ''}第${row.rowInStage}行`,
      row?.speech,
      boardText,
      formatActionSpec(row?.actionSpec),
    ].map(escapeCell).join(' | ')
  })
  return [
    `# ${title}`,
    ...(metadata.length ? ['', ...metadata] : []),
    ...canvasParamsSection,
    '',
    '| 序号 | 行标识 | 口播稿 | 板书内容 | 动作参数（完整 JSON） |',
    '| ---: | --- | --- | --- | --- |',
    ...rowsText.map((row) => `| ${row} |`),
    '',
  ].join('\n')
}

export function exportElementsMarkdown(rows, meta = {}) {
  const markdown = buildElementsMarkdown(rows, meta)
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFilename(meta.problemText)}-完整要素表.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function buildSpeechMarkdown(rows, _meta = {}) {
  const speeches = (Array.isArray(rows) ? rows : [])
    .map((row) => polishSpeechText(String(row?.speech || '')))
    .filter(Boolean)
  return speeches.join('\n\n').trimEnd() + '\n'
}

function safeFilename(problemText) {
  const name = String(problemText || '讲题')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 20)
  return name || '讲题'
}

export function exportSpeechMarkdown(rows, meta = {}) {
  const markdown = buildSpeechMarkdown(rows, meta)
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFilename(meta.problemText)}-口播稿.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// ---- 时序分镜表：按小环节分块，全局时间码，动作折叠为可读摘要 ----

function summarizeActionSpec(actionSpec) {
  if (!Array.isArray(actionSpec) || !actionSpec.length) return '—'
  return actionSpec.map((entry) => {
    const action = entry?.action
    if (!action) return '能力缺口'
    if (action.tool === 'rough-notation') {
      const label = action.action === 'highlight' ? '高亮' : '下划线'
      const text = action.target?.exactText || action.targetId || '?'
      return `${label}「${text}」`
    }
    if (action.tool === 'rough-line' || action.tool === 'rough-arrow') {
      const label = action.tool === 'rough-arrow' ? '箭头' : '辅助线'
      const region = action.region ? `[${action.region}]` : ''
      const start = Array.isArray(action.start) ? `(${action.start[0]},${action.start[1]})` : ''
      const end = Array.isArray(action.end) ? `→(${action.end[0]},${action.end[1]})` : ''
      return `${label}${region}${start}${end}`
    }
    return action.tool || '未知动作'
  }).join('｜')
}

// 解析 board 字段，兼容 v1.0(string) 和 v2.0(object {startCoord, content})
function parseBoardField(board) {
  if (board == null) return { startCoord: '', content: '' }
  if (typeof board === 'string') {
    const match = board.match(/^\[(\d+(?:\.\d+)?%\s*,\s*\d+(?:\.\d+)?%)\]\s*/)
    if (match) return { startCoord: '[' + match[1] + ']', content: board.slice(match[0].length) }
    return { startCoord: '', content: board }
  }
  if (typeof board === 'object') {
    return { startCoord: board.startCoord || '', content: board.content || '' }
  }
  return { startCoord: '', content: String(board) }
}

function formatBoardBlock(board) {
  const { startCoord, content } = parseBoardField(board)
  const text = String(content || '').trim()
  if (!text) return '> （空）'
  const coordLine = startCoord ? `> 起手坐标：${startCoord}\n` : ''
  return coordLine + text
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

export function buildStoryboardMarkdown(rows, meta = {}) {
  const sourceRows = Array.isArray(rows) ? rows : []
  const title = String(meta.title || '讲题分镜表')
  const metadata = [
    meta.problemText ? `- 题目：${String(meta.problemText).replace(/\r?\n/g, ' ')}` : '',
    meta.model ? `- 模型：${meta.model}` : '',
    meta.generatedAt ? `- 生成时间：${meta.generatedAt}` : '',
  ].filter(Boolean)

  const hcp = meta.handoffCanvasParams
  const hbp = meta.handoffBoardPlan
  const regionLabels = { question: '题目区', analysis: '分析区', solution: '解答区', summary: '总结区' }

  const paramsSection = []
  if (hcp) {
    paramsSection.push(
      '',
      '## 画布参数（来自 handoff，真相源）',
      '',
      `| 参数 | 值 |`,
      `| --- | --- |`,
      `| 画布尺寸 | ${hcp.canvasSize?.width ?? ''}×${hcp.canvasSize?.height ?? ''}px |`,
      `| 题目区 | ${hcp.fontSize?.question?.px ?? ''}px / ${hcp.fontSize?.question?.color || ''} |`,
      `| 分析区 | ${hcp.fontSize?.analysis?.px ?? ''}px / ${hcp.fontSize?.analysis?.color || ''} |`,
      `| 解答区 | ${hcp.fontSize?.solution?.px ?? ''}px / ${hcp.fontSize?.solution?.color || ''} |`,
      `| 总结区 | ${hcp.fontSize?.summary?.px ?? ''}px / ${hcp.fontSize?.summary?.color || ''} |`,
      `| 板书速度 | ${hcp.boardSpeed || ''} |`,
      `| 动作速度 | ${hcp.actionSpeed || ''} |`,
      '',
    )
  }
  if (hbp) {
    paramsSection.push(
      '### 四区布局（来自 handoff）',
      '',
      `| 区域 | 左% | 上% | 宽% | 高% |`,
      `| --- | ---: | ---: | ---: | ---: |`,
      ...['question', 'analysis', 'solution', 'summary'].map((key) => {
        const z = hbp[key] || {}
        return `| ${regionLabels[key] || key} | ${z.x ?? ''} | ${z.y ?? ''} | ${z.w ?? ''} | ${z.h ?? ''} |`
      }),
      '',
    )
  }

  const stageLabels = {
    '题目': '题目环节',
    '分析': '分析环节',
    '解答': '解答环节',
    '总结': '总结环节',
  }

  let lastStage = null
  let rowInStage = 0
  const blocks = sourceRows.map((row) => {
    const stage = row?.stage || '分析'

    if (stage !== lastStage) {
      lastStage = stage
      rowInStage = 0
    }
    rowInStage += 1

    const speech = String(row?.speech || '').trim() || '（空）'
    const board = formatBoardBlock(row?.board)
    const actions = summarizeActionSpec(row?.actionSpec)

    const stageHeader = rowInStage === 1
      ? `\n## ${stageLabels[stage] || stage}\n`
      : ''

    return `${stageHeader}### ${stage}-第${rowInStage}行
**口播**：${speech}
**板书**：
${board}
**动作**：${actions}`
  })

  return [
    `# ${title}`,
    ...(metadata.length ? ['', ...metadata, ''] : []),
    ...paramsSection,
    blocks.join('\n\n'),
    '',
  ].join('\n')
}

export function exportStoryboardMarkdown(rows, meta = {}) {
  const markdown = buildStoryboardMarkdown(rows, meta)
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFilename(meta.problemText)}-分镜表.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
