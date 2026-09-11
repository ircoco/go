import katex from 'katex'

function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderMath(text) {
  if (!text) return ''
  let result = String(text)
  // Display math $$...$$
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (match, expr) => {
    try {
      return katex.renderToString(expr.trim(), { throwOnError: false, displayMode: true, strict: 'ignore' })
    } catch {
      return `<span class="raw-math">${escapeHtml(match)}</span>`
    }
  })
  // Inline math $...$
  result = result.replace(/\$([^\$\n]+?)\$/g, (match, expr) => {
    try {
      return katex.renderToString(expr.trim(), { throwOnError: false, strict: 'ignore' })
    } catch {
      return `<span class="raw-math">${escapeHtml(match)}</span>`
    }
  })
  // Raw LaTeX formulas without $ signs
  if (/\\(frac|sqrt|times|div|pm|leq|geq|neq|alpha|beta|pi|sum|int|begin|text)/.test(result) && !result.includes('<span class="katex">')) {
    try {
      return katex.renderToString(result, { throwOnError: false, strict: 'ignore' })
    } catch {
      // fallback
    }
  }
  return result
}

function parseBoardCoordinate(boardInput) {
  if (!boardInput) return { x: null, y: null, text: '', startDelay: 0, hasExplicitCoord: false }
  let rawCoord = ''
  let text = ''
  let startDelay = 0

  if (typeof boardInput === 'object') {
    rawCoord = String(boardInput.startCoord || '').trim()
    text = String(boardInput.content || '').trim()
    if (typeof boardInput.startDelay === 'number') {
      startDelay = boardInput.startDelay
    } else if (typeof boardInput.startDelay === 'string') {
      const parsed = parseFloat(boardInput.startDelay.replace(/[^\d.]/g, ''))
      if (Number.isFinite(parsed)) startDelay = parsed
    }
  } else {
    text = String(boardInput || '').trim()
    const match = text.match(/^\s*[(\[]\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*[)\]]\s*(.*)$/s)
    if (match) {
      rawCoord = `[${match[1]}, ${match[2]}]`
      text = match[3] || ''
    }
  }

  let x = null
  let y = null
  let hasExplicitCoord = false

  if (rawCoord) {
    const coordMatch = rawCoord.match(/([\d.]+)%?\s*,\s*([\d.]+)%?/)
    if (coordMatch) {
      let parsedX = parseFloat(coordMatch[1])
      let parsedY = parseFloat(coordMatch[2])
      if (parsedX > 100) parsedX = Number(((parsedX / 1726) * 100).toFixed(1))
      if (parsedY > 100) parsedY = Number(((parsedY / 980) * 100).toFixed(1))
      x = parsedX
      y = parsedY
      hasExplicitCoord = true
    }
  }

  return { x, y, text, startDelay, hasExplicitCoord }
}

function getStageColorClass(stage) {
  const s = String(stage || '')
  if (s.includes('题') || s.includes('引入') || s.includes('审题')) return 'stage-topic'
  if (s.includes('知') || s.includes('链')) return 'stage-knowledge'
  if (s.includes('析') || s.includes('探') || s.includes('策略')) return 'stage-analysis'
  if (s.includes('解') || s.includes('答') || s.includes('算')) return 'stage-solution'
  if (s.includes('总') || s.includes('结') || s.includes('回顾')) return 'stage-summary'
  return 'stage-default'
}

export function renderDeliverableHtml(deliverable) {
  const projectCode = deliverable.projectCode || 'LATEST'
  const problemText = deliverable.problemText || ''
  const createdAt = deliverable.createdAt || new Date().toISOString()
  const formattedTime = new Date(createdAt).toLocaleString('zh-CN', { hour12: false })
  const stats = deliverable.stats || {}
  const totalDurationText = stats.totalDurationText || `${Math.round((stats.totalDuration || 0) / 60)}分${(stats.totalDuration || 0) % 60}秒`
  const stepCount = stats.stepCount || (deliverable.rows?.length || 0)
  const charCount = stats.charCount || 0
  const actionCount = stats.actionCount || 0
  const rows = Array.isArray(deliverable.rows) ? deliverable.rows : []
  const boardPlan = deliverable.boardPlan || {}
  const screenshotUrl = deliverable.screenshotUrl || deliverable.sourceImageUrl || ''
  const meta = deliverable.meta || {}

  // 渲染题目 LaTeX
  const renderedProblemHtml = renderMath(problemText)

  // 智能起手定位与垂直间距防重叠计算
  const zoneCursors = {
    'topic': { x: 6.0, y: 14.0, count: 0 },
    'analysis': { x: 8.0, y: 38.0, count: 0 },
    'solution': { x: 55.0, y: 12.0, count: 0 },
    'summary': { x: 55.0, y: 66.0, count: 0 },
  }

  const layoutedRows = rows.map((r, idx) => {
    const s = String(r.stage || '')
    const zoneKey = s.includes('解') ? 'solution' :
                    s.includes('总') ? 'summary' :
                    s.includes('题') ? 'topic' : 'analysis'
    const parsed = parseBoardCoordinate(r.board)
    let finalX = parsed.x
    let finalY = parsed.y

    if (!parsed.hasExplicitCoord || finalX === null || finalY === null) {
      finalX = zoneCursors[zoneKey].x
      finalY = zoneCursors[zoneKey].y
    } else {
      // 若大模型输出的坐标与上一行太近（垂直间距小于 8%），自动加行高下移避让
      if (zoneCursors[zoneKey].count > 0 && Math.abs(finalY - zoneCursors[zoneKey].y) < 7) {
        finalY = zoneCursors[zoneKey].y + 11
      }
    }

    const lineCount = Math.max(1, (parsed.text.match(/\n/g) || []).length + 1)
    const rowHeight = Math.max(10, lineCount * 5.5 + 4)
    zoneCursors[zoneKey].y = Number((finalY + rowHeight).toFixed(1))
    zoneCursors[zoneKey].count += 1

    return {
      ...r,
      layoutBoard: {
        ...parsed,
        x: finalX,
        y: finalY,
      }
    }
  })

  // 渲染板书行
  const boardItemsHtml = layoutedRows.map((r, idx) => {
    const b = r.layoutBoard
    const mathContent = renderMath(b.text || '')
    const coordLabel = b.x !== null && b.y !== null ? `(${b.x}%, ${b.y}%)` : ''
    const stageClass = getStageColorClass(r.stage)
    const delayBadge = b.startDelay > 0 ? `<span class="board-delay-tag">+${b.startDelay}s 起手</span>` : ''

    let style = ''
    if (b.x !== null && b.y !== null && b.text) {
      style = `style="left: ${b.x}%; top: ${b.y}%; position: absolute;"`
    } else if (!b.text) {
      style = 'style="display: none;"'
    }

    return `
      <div class="board-element ${stageClass}" ${style} data-step="${idx + 1}" id="board-step-${idx + 1}">
        <div class="board-element-header">
          <span class="board-step-pill">${r.stage || `步骤${idx + 1}`}</span>
          ${coordLabel ? `<span class="board-coord-tag">${coordLabel}</span>` : ''}
          ${delayBadge}
        </div>
        <div class="board-content-body">${mathContent}</div>
      </div>
    `
  }).join('\n')

  // 渲染表格行
  const tableRowsHtml = layoutedRows.map((r, idx) => {
    const stageClass = getStageColorClass(r.stage)
    const b = r.layoutBoard
    const renderedBoard = renderMath(b.text || '')
    const actionList = Array.isArray(r.actionSpec) ? r.actionSpec : []
    const actionsHtml = actionList.length > 0
      ? actionList.map(a => {
          const actType = a.action || a.type || 'action'
          const actTarget = a.target || a.content || ''
          const actColor = a.color || '#3b82f6'
          return `<span class="action-spec-pill" style="border-left-color: ${actColor};"><span class="act-name">${escapeHtml(actType)}</span>${actTarget ? `<span class="act-target">${escapeHtml(actTarget)}</span>` : ''}</span>`
        }).join('')
      : '<span class="text-muted-empty">— 无额外动作 —</span>'

    return `
      <tr class="table-row ${stageClass}" data-stage="${escapeHtml(r.stage || '')}">
        <td class="col-num">${idx + 1}</td>
        <td class="col-stage"><span class="stage-tag ${stageClass}">${escapeHtml(r.stage || '环节')}</span></td>
        <td class="col-dur">${escapeHtml(r.duration || '—')}</td>
        <td class="col-speech">
          <div class="speech-text">${escapeHtml(r.speech || '')}</div>
        </td>
        <td class="col-board">
          ${b.x !== null ? `<div class="board-coord-meta">起手落点: (${b.x}%, ${b.y}%) ${b.startDelay > 0 ? `· 播放+${b.startDelay}s时动笔` : ''}</div>` : ''}
          <div class="board-text-rendered">${renderedBoard || '<span class="text-muted-empty">(本步无新增板书)</span>'}</div>
        </td>
        <td class="col-action">
          <div class="actions-wrap">${actionsHtml}</div>
        </td>
      </tr>
    `
  }).join('\n')

  const jsonString = JSON.stringify(deliverable, null, 2)

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>教学视频素材参数单页 · ${escapeHtml(projectCode)}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/katex/katex.min.css" onerror="this.onerror=null;this.href='https://cdn.jsdelivr.net/npm/katex@0.18.4/dist/katex.min.css';" />
  <style>
    :root {
      --bg-canvas: #f8fafc;
      --board-bg: #fffdfa;
      --board-line: #e2e8f0;
      --text-main: #0f172a;
      --text-secondary: #475569;
      --text-muted: #94a3b8;
      --border-color: #e2e8f0;
      --card-bg: #ffffff;
      --emerald-600: #059669;
      --emerald-50: #ecfdf5;
      --blue-600: #2563eb;
      --blue-50: #eff6ff;
      --amber-600: #d97706;
      --purple-600: #7c3aed;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg-canvas);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      padding: 0;
      margin: 0;
      -webkit-font-smoothing: antialiased;
    }

    /* 顶部导航与资产信息栏 */
    .top-header {
      background: #ffffff;
      border-bottom: 1px solid var(--border-color);
      padding: 14px 24px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    }

    .header-inner {
      max-width: 1560px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .header-title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .archive-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--emerald-50);
      color: var(--emerald-600);
      border: 1px solid #a7f3d0;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
    }

    .page-title {
      font-size: 17px;
      font-weight: 700;
      color: #0f172a;
    }

    .header-meta-group {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 12.5px;
      color: var(--text-secondary);
    }

    .code-badge {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #f1f5f9;
      color: #1e293b;
      padding: 2px 7px;
      border-radius: 4px;
      font-weight: 600;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
      border: 1px solid var(--border-color);
      background: #ffffff;
      color: var(--text-main);
    }

    .btn:hover {
      background: #f8fafc;
      border-color: #cbd5e1;
    }

    .btn-primary {
      background: linear-gradient(135deg, #059669 0%, #10b981 100%);
      border-color: #059669;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);
    }

    .btn-primary:hover {
      background: linear-gradient(135deg, #047857 0%, #059669 100%);
      color: #ffffff;
    }

    /* 主内容工作区 */
    .workspace-container {
      max-width: 1560px;
      margin: 20px auto;
      padding: 0 24px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* 画布外框与比例锁定 */
    .canvas-section {
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid var(--border-color);
      box-shadow: 0 2px 8px rgba(0,0,0,0.03);
      overflow: hidden;
    }

    .section-header {
      padding: 12px 18px;
      border-bottom: 1px solid var(--border-color);
      background: #fafafa;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .section-tools {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .tool-toggle-label {
      font-size: 12px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }

    .canvas-viewport-wrapper {
      width: 100%;
      background: #334155;
      padding: 20px;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: auto;
    }

    /* 严控 1726 / 980 画布长宽比（夏夏核心要求） */
    .real-board-canvas {
      width: min(100%, calc(min(62vh, 880px) * (1726 / 980)));
      max-width: 100%;
      aspect-ratio: 1726 / 980;
      background-color: var(--board-bg);
      background-image: radial-gradient(#d1d5db 0.85px, transparent 0.85px);
      background-size: 18px 18px;
      border-radius: 8px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
      position: relative;
      overflow: hidden;
      transition: width 0.2s ease, max-height 0.2s ease;
    }

    /* 全屏演播室模式 */
    body.is-fullscreen {
      overflow: hidden;
    }

    body.is-fullscreen .top-header,
    body.is-fullscreen .params-section,
    body.is-fullscreen .section-header {
      display: none;
    }

    body.is-fullscreen .workspace-container {
      max-width: 100vw;
      margin: 0;
      padding: 0;
      height: 100vh;
    }

    body.is-fullscreen .canvas-section {
      border-radius: 0;
      border: none;
      height: 100vh;
      display: flex;
    }

    body.is-fullscreen .canvas-viewport-wrapper {
      padding: 16px;
      height: 100vh;
    }

    body.is-fullscreen .real-board-canvas {
      width: min(100%, calc((100vh - 32px) * (1726 / 980)));
      max-height: calc(100vh - 32px);
      aspect-ratio: 1726 / 980;
    }

    /* 四标签固定图钉 */
    .zone-label-pin {
      position: absolute;
      font-size: 13px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      z-index: 10;
      pointer-events: none;
    }
    .pin-topic { left: 5.7%; top: 6.6%; color: #1d4ed8; background: rgba(239, 246, 255, 0.9); border: 1px solid #bfdbfe; }
    .pin-analysis { left: 5.7%; top: 34.5%; color: #047857; background: rgba(236, 253, 245, 0.9); border: 1px solid #a7f3d0; }
    .pin-solution { left: 53.7%; top: 6.6%; color: #6d28d9; background: rgba(245, 243, 255, 0.9); border: 1px solid #ddd6fe; }
    .pin-summary { left: 53.7%; top: 62.0%; color: #b45309; background: rgba(254, 243, 199, 0.9); border: 1px solid #fde68a; }

    /* 题目区域 */
    .canvas-topic-box {
      position: absolute;
      left: 6.0%;
      top: 13.3%;
      width: 44.0%;
      z-index: 5;
    }

    .topic-question-text {
      font-size: 15px;
      line-height: 1.6;
      color: #1e293b;
      font-weight: 500;
    }

    /* 辅助线与网格线 */
    .grid-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image: 
        linear-gradient(to right, rgba(148, 163, 184, 0.15) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(148, 163, 184, 0.15) 1px, transparent 1px);
      background-size: 10% 10%;
      display: none;
    }

    .section-dividers {
      position: absolute;
      inset: 0;
      pointer-events: none;
      display: none;
    }
    .section-dividers .div-v {
      position: absolute;
      left: 50%;
      top: 4%;
      bottom: 4%;
      width: 1px;
      border-left: 1.5px dashed #cbd5e1;
    }
    .section-dividers .div-h1 {
      position: absolute;
      left: 4%;
      right: 52%;
      top: 32%;
      height: 1px;
      border-top: 1.5px dashed #cbd5e1;
    }
    .section-dividers .div-h2 {
      position: absolute;
      left: 52%;
      right: 4%;
      top: 59%;
      height: 1px;
      border-top: 1.5px dashed #cbd5e1;
    }

    /* 截图原图 */
    .board-snapshot-img {
      position: absolute;
      max-width: 40%;
      max-height: 35%;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
      border: 1px solid #cbd5e1;
    }

    /* 板书元素散落渲染 */
    .board-elements-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    .board-element {
      padding: 6px 10px;
      border-radius: 6px;
      max-width: 44%;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 14.5px;
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(4px);
      border: 1px solid rgba(203, 213, 225, 0.9);
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
      pointer-events: auto;
      transition: all 0.2s ease;
    }

    .board-element-header {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .board-delay-tag {
      font-size: 10px;
      font-weight: 600;
      color: #0284c7;
      background: #e0f2fe;
      padding: 1px 5px;
      border-radius: 3px;
      font-family: monospace;
    }

    .board-coord-tag {
      font-size: 10px;
      font-family: monospace;
      color: #64748b;
    }

    .board-step-pill {
      font-size: 10.5px;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 3px;
      align-self: flex-start;
    }

    .stage-topic .board-step-pill { background: #dbeafe; color: #1d4ed8; }
    .stage-knowledge .board-step-pill { background: #ffedd5; color: #c2410c; }
    .stage-analysis .board-step-pill { background: #dcfce7; color: #15803d; }
    .stage-solution .board-step-pill { background: #f3e8ff; color: #7e22ce; }
    .stage-summary .board-step-pill { background: #fef3c7; color: #b45309; }

    /* 下方下挖参数信息框 */
    .params-section {
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid var(--border-color);
      box-shadow: 0 2px 8px rgba(0,0,0,0.03);
      overflow: hidden;
    }

    /* 概览指标行 */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      padding: 20px;
      background: #f8fafc;
      border-bottom: 1px solid var(--border-color);
    }

    .metric-card {
      background: #ffffff;
      padding: 14px 18px;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .metric-label {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .metric-value {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
    }

    .metric-sub {
      font-size: 11px;
      color: var(--text-muted);
    }

    /* 选项卡导航 */
    .tabs-nav {
      display: flex;
      border-bottom: 1px solid var(--border-color);
      background: #ffffff;
      padding: 0 20px;
    }

    .tab-btn {
      padding: 14px 20px;
      border: none;
      background: none;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s ease;
    }

    .tab-btn:hover {
      color: var(--text-main);
    }

    .tab-btn.active {
      color: var(--emerald-600);
      border-bottom-color: var(--emerald-600);
    }

    .tab-pane {
      display: none;
      padding: 20px;
    }

    .tab-pane.active {
      display: block;
    }

    /* 五字段执行表格 */
    .table-tools {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      flex-wrap: wrap;
      gap: 10px;
    }

    .filter-group {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .filter-btn {
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      border: 1px solid var(--border-color);
      background: #ffffff;
      cursor: pointer;
      color: var(--text-secondary);
    }

    .filter-btn.active {
      background: #0f172a;
      color: #ffffff;
      border-color: #0f172a;
    }

    .table-container {
      overflow-x: auto;
      border: 1px solid var(--border-color);
      border-radius: 8px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13.5px;
      text-align: left;
    }

    th {
      background: #f8fafc;
      padding: 10px 14px;
      font-weight: 600;
      color: #475569;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }

    td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-color);
      vertical-align: top;
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background: #fafbfc;
    }

    .col-num { width: 44px; text-align: center; color: var(--text-muted); font-weight: 600; }
    .col-stage { width: 100px; white-space: nowrap; }
    .col-dur { width: 68px; white-space: nowrap; font-family: monospace; color: #475569; }
    .col-speech { min-width: 320px; line-height: 1.6; }
    .col-board { min-width: 260px; line-height: 1.5; }
    .col-action { min-width: 180px; }

    .stage-tag {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11.5px;
      font-weight: 600;
    }
    .stage-tag.stage-topic { background: #eff6ff; color: #1d4ed8; }
    .stage-tag.stage-knowledge { background: #fff7ed; color: #c2410c; }
    .stage-tag.stage-analysis { background: #f0fdf4; color: #15803d; }
    .stage-tag.stage-solution { background: #faf5ff; color: #7e22ce; }
    .stage-tag.stage-summary { background: #fefce8; color: #a16207; }

    .speech-text {
      color: #1e293b;
    }

    .board-coord-meta {
      font-size: 11px;
      font-family: monospace;
      color: #2563eb;
      margin-bottom: 3px;
    }

    .board-text-rendered {
      color: #0f172a;
    }

    .actions-wrap {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .action-spec-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left-width: 3px;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
    }

    .act-name { font-weight: 600; color: #334155; }
    .act-target { color: #64748b; }
    .text-muted-empty { font-size: 12px; color: #94a3b8; font-style: italic; }

    /* 四区坐标参数面板 */
    .zones-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-top: 14px;
    }

    .zone-info-card {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
      background: #fafafa;
    }

    .zone-card-title {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .coord-item {
      font-size: 12.5px;
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px dashed #e2e8f0;
    }

    .coord-item:last-child {
      border-bottom: none;
    }

    .coord-lbl { color: var(--text-secondary); }
    .coord-val { font-family: monospace; font-weight: 600; color: #0f172a; }

    /* JSON 代码高亮框 */
    .json-code-box {
      background: #0f172a;
      color: #f8fafc;
      padding: 18px;
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12.5px;
      line-height: 1.5;
      max-height: 600px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* 录屏专属样式（夏夏纯客户端录屏，零服务器开销） */
    .btn-record {
      border-color: #fca5a5 !important;
      background: #fff1f2 !important;
      color: #b91c1c !important;
      font-weight: 600 !important;
      transition: all 0.2s ease;
    }
    .btn-record:hover {
      background: #ffe4e6 !important;
      border-color: #f87171 !important;
      color: #991b1b !important;
    }
    .btn-record.is-recording {
      background: #fee2e2 !important;
      border-color: #ef4444 !important;
      color: #dc2626 !important;
      animation: pulse-border 1.5s infinite;
    }
    .record-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
      margin-right: 2px;
    }
    .btn-record.is-recording .record-dot {
      animation: blink 0.8s infinite alternate;
    }
    @keyframes blink {
      0% { opacity: 1; transform: scale(1); }
      100% { opacity: 0.3; transform: scale(0.8); }
    }
    @keyframes pulse-border {
      0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
      50% { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0.15); }
    }

    /* 浮动录屏状态栏（全屏/常规均置顶） */
    .recording-floating-bar {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10000;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(10px);
      color: #ffffff;
      padding: 7px 18px;
      border-radius: 30px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
      border: 1.5px solid rgba(239, 68, 68, 0.65);
      display: none;
      align-items: center;
      gap: 12px;
      font-size: 13px;
    }
    .recording-pulse {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ef4444;
      box-shadow: 0 0 10px #ef4444;
      animation: blink 0.7s infinite alternate;
    }
    .recording-timer {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.8px;
      color: #fca5a5;
    }
    .btn-rec-stop {
      background: #ef4444;
      color: #ffffff;
      border: none;
      padding: 4px 12px;
      border-radius: 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s;
    }
    .btn-rec-stop:hover { background: #dc2626; }
    .btn-rec-cancel {
      background: transparent;
      color: #cbd5e1;
      border: 1px solid rgba(255,255,255,0.25);
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      cursor: pointer;
    }
    .btn-rec-cancel:hover { color: #ffffff; border-color: #ffffff; }

    /* 录屏完成提示 Toast */
    .deliverable-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0f172a;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13.5px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.1);
      z-index: 10001;
      opacity: 0;
      transform: translateY(12px);
      transition: all 0.25s ease;
      pointer-events: none;
    }
    .deliverable-toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    /* 浮动全屏退出按钮 */
    .exit-fullscreen-btn {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9999;
      display: none;
      background: rgba(15, 23, 42, 0.85);
      color: #ffffff;
      border: 1px solid rgba(255,255,255,0.2);
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      backdrop-filter: blur(4px);
    }

    body.is-fullscreen .exit-fullscreen-btn {
      display: inline-flex;
    }

    /* 打印样式支持 */
    @media print {
      .top-header, .section-tools, .filter-group, .exit-fullscreen-btn, .recording-floating-bar { display: none !important; }
      body { background: #ffffff !important; }
      .workspace-container { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
      .tab-pane { display: block !important; }
      .real-board-canvas { box-shadow: none !important; border: 1px solid #000000 !important; }
    }
  </style>
</head>
<body>
  <!-- 录屏状态浮动条 -->
  <div class="recording-floating-bar" id="recording-bar">
    <div class="recording-pulse"></div>
    <span style="font-weight: 600;">正在录制画布演播</span>
    <span class="recording-timer" id="recording-timer">00:00</span>
    <button class="btn-rec-stop" onclick="stopScreenRecording()">⏹ 结束并下载</button>
    <button class="btn-rec-cancel" onclick="cancelScreenRecording()">✕ 取消</button>
  </div>

  <!-- 退出全屏按钮 -->
  <button class="exit-fullscreen-btn" onclick="toggleFullscreen()">✕ 退出全屏演播</button>

  <!-- 顶部导航与状态栏 -->
  <header class="top-header">
    <div class="header-inner">
      <div class="header-title-group">
        <span class="archive-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          实体归档物
        </span>
        <h1 class="page-title">教学视频素材参数交付单页</h1>
        <span class="code-badge">deliverable-${escapeHtml(projectCode)}</span>
      </div>

      <div class="header-meta-group">
        <span>归档时间: <strong>${escapeHtml(formattedTime)}</strong></span>
        <span>画布规格: <strong>1726 × 980 (16:9 锁定)</strong></span>
      </div>

      <div class="header-actions">
        <!-- 夏夏录屏按钮（纯客户端录屏，零服务器开销） -->
        <button class="btn btn-record" id="btn-screen-record" onclick="toggleScreenRecording()" title="点击调起浏览器录屏，可录制画布、板书动作与声音，免去后台渲染开销">
          <span class="record-dot"></span>
          <span id="record-btn-text">录制演播视频</span>
        </button>

        <button class="btn" onclick="toggleFullscreen()" title="切换全屏纯净预览">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
          全屏演播
        </button>
        <a class="btn" href="/deliverable/deliverable-${escapeHtml(projectCode)}.json" download="deliverable-${escapeHtml(projectCode)}.json" title="下载配套实体 JSON 文件">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          下载 JSON
        </a>
        <button class="btn" onclick="copyJson()" id="copy-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          复制规格
        </button>
        <button class="btn btn-primary" onclick="window.print()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          打印 / 导出 PDF
        </button>
      </div>
    </div>
  </header>

  <!-- 工作区 -->
  <main class="workspace-container">
    <!-- 上半部：真板书演播室（1726 × 980 严格比例锁定） -->
    <section class="canvas-section">
      <div class="section-header">
        <div class="section-title">
          <span>🎬 真板书演播室画布</span>
          <span style="font-size: 11.5px; font-weight: normal; color: #64748b;">(1726 × 980 比例锁定 · 无论缩放或全屏绝不畸变)</span>
        </div>
        <div class="section-tools">
          <button class="btn btn-record" onclick="toggleScreenRecording()" style="padding: 3px 9px; font-size: 12px; margin-right: 6px;">
            <span class="record-dot"></span>
            <span>录制画布</span>
          </button>
          <label class="tool-toggle-label">
            <input type="checkbox" id="toggle-grid" onchange="toggleGrid(this.checked)" />
            网格参考线
          </label>
          <label class="tool-toggle-label">
            <input type="checkbox" id="toggle-dividers" onchange="toggleDividers(this.checked)" />
            四区分割线
          </label>
          <label class="tool-toggle-label">
            <input type="checkbox" id="toggle-labels" checked onchange="toggleLabels(this.checked)" />
            显示四标签
          </label>
        </div>
      </div>

      <div class="canvas-viewport-wrapper">
        <div class="real-board-canvas" id="real-board-canvas">
          <!-- 网格线层 -->
          <div class="grid-overlay" id="grid-overlay"></div>
          <div class="section-dividers" id="section-dividers">
            <div class="div-v"></div>
            <div class="div-h1"></div>
            <div class="div-h2"></div>
          </div>

          <!-- 四大区域图钉标签 -->
          <div class="zone-labels-group" id="zone-labels-group">
            <div class="zone-label-pin pin-topic">【题目】</div>
            <div class="zone-label-pin pin-analysis">【分析】</div>
            <div class="zone-label-pin pin-solution">【解答】</div>
            <div class="zone-label-pin pin-summary">【总结】</div>
          </div>

          <!-- 题目文本层 -->
          <div class="canvas-topic-box">
            <div class="topic-question-text">${renderedProblemHtml}</div>
          </div>

          <!-- 题目快照或图片（如果有） -->
          ${screenshotUrl ? `<img src="${escapeHtml(screenshotUrl)}" class="board-snapshot-img" style="right: 54%; top: 13.5%;" alt="题目原图" />` : ''}

          <!-- 板书元素渲染层 -->
          <div class="board-elements-layer">
            ${boardItemsHtml}
          </div>
        </div>
      </div>
    </section>

    <!-- 下半部：挖出的参数信息框（板书教学视频素材对接） -->
    <section class="params-section">
      <!-- 概览指标卡片 -->
      <div class="metrics-grid">
        <div class="metric-card">
          <span class="metric-label">预估视频时长</span>
          <span class="metric-value" style="color: var(--emerald-600);">${escapeHtml(totalDurationText)}</span>
          <span class="metric-sub">${stats.totalDuration || 0} 秒 · 标准160字/分语速</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">讲题执行步数</span>
          <span class="metric-value" style="color: var(--blue-600);">${stepCount} <span style="font-size: 14px; font-weight: normal;">步</span></span>
          <span class="metric-sub">覆盖四环一体全流程</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">口播稿总字数</span>
          <span class="metric-value" style="color: var(--purple-600);">${charCount} <span style="font-size: 14px; font-weight: normal;">字</span></span>
          <span class="metric-sub">纯净语音 · 自然断句节奏</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">板书动作指令</span>
          <span class="metric-value" style="color: var(--amber-600);">${actionCount} <span style="font-size: 14px; font-weight: normal;">项</span></span>
          <span class="metric-sub">动态高亮、划线、框选</span>
        </div>
      </div>

      <!-- 选项卡导航 -->
      <div class="tabs-nav">
        <button class="tab-btn active" onclick="switchTab('tab-five-fields', this)">
          📋 讲题五字段时序执行表 (${rows.length})
        </button>
        <button class="tab-btn" onclick="switchTab('tab-layout-params', this)">
          📐 真画布四区与落点坐标
        </button>
        <button class="tab-btn" onclick="switchTab('tab-json-spec', this)">
          🤖 自动化视频对接 (JSON)
        </button>
      </div>

      <!-- Tab 1: 讲题五字段时序执行表 -->
      <div class="tab-pane active" id="tab-five-fields">
        <div class="table-tools">
          <div class="filter-group">
            <button class="filter-btn active" onclick="filterTable('all', this)">全部 (${rows.length})</button>
            <button class="filter-btn" onclick="filterTable('题', this)">题目/引入</button>
            <button class="filter-btn" onclick="filterTable('知', this)">知识链接</button>
            <button class="filter-btn" onclick="filterTable('析', this)">核心分析</button>
            <button class="filter-btn" onclick="filterTable('解', this)">解答计算</button>
            <button class="filter-btn" onclick="filterTable('总', this)">总结反思</button>
          </div>
          <div class="table-actions">
            <button class="btn" onclick="exportSpeechTxt()">导出口播稿 (TXT)</button>
          </div>
        </div>

        <div class="table-container">
          <table id="five-fields-table">
            <thead>
              <tr>
                <th class="col-num">#</th>
                <th class="col-stage">环节</th>
                <th class="col-dur">用时</th>
                <th class="col-speech">口播文本 (TTS 发音优化)</th>
                <th class="col-board">板书内容与落点坐标</th>
                <th class="col-action">动作规范 (actionSpec)</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Tab 2: 真画布四区与落点坐标 -->
      <div class="tab-pane" id="tab-layout-params">
        <div class="zone-info-card" style="margin-bottom: 16px;">
          <div class="zone-card-title">📝 题目完整内容与 LaTeX 渲染</div>
          <div style="font-size: 14px; line-height: 1.7; color: #1e293b; background: #ffffff; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
            ${renderedProblemHtml}
          </div>
        </div>

        <div class="zones-grid">
          <div class="zone-info-card">
            <div class="zone-card-title" style="color: #1d4ed8;">📌 【题目区】参数</div>
            <div class="coord-item"><span class="coord-lbl">相对百分比:</span><span class="coord-val">x: 5.7% ~ 50.0%, y: 6.6% ~ 32.0%</span></div>
            <div class="coord-item"><span class="coord-lbl">1726×980 绝对像素:</span><span class="coord-val">X: 98px ~ 863px, Y: 65px ~ 314px</span></div>
            <div class="coord-item"><span class="coord-lbl">可用宽度 / 高度:</span><span class="coord-val">W: 765px, H: 249px</span></div>
            <div class="coord-item"><span class="coord-lbl">字号基准:</span><span class="coord-val">28px ~ 32px · 最多容纳 4 行</span></div>
          </div>

          <div class="zone-info-card">
            <div class="zone-card-title" style="color: #047857;">📌 【分析区】参数</div>
            <div class="coord-item"><span class="coord-lbl">相对百分比:</span><span class="coord-val">x: 5.7% ~ 50.0%, y: 34.5% ~ 95.0%</span></div>
            <div class="coord-item"><span class="coord-lbl">1726×980 绝对像素:</span><span class="coord-val">X: 98px ~ 863px, Y: 338px ~ 931px</span></div>
            <div class="coord-item"><span class="coord-lbl">可用宽度 / 高度:</span><span class="coord-val">W: 765px, H: 593px</span></div>
            <div class="coord-item"><span class="coord-lbl">设计规划:</span><span class="coord-val">关系拆解、示意图形、条件连线</span></div>
          </div>

          <div class="zone-info-card">
            <div class="zone-card-title" style="color: #6d28d9;">📌 【解答区】参数</div>
            <div class="coord-item"><span class="coord-lbl">相对百分比:</span><span class="coord-val">x: 53.7% ~ 96.0%, y: 6.6% ~ 59.0%</span></div>
            <div class="coord-item"><span class="coord-lbl">1726×980 绝对像素:</span><span class="coord-val">X: 927px ~ 1657px, Y: 65px ~ 578px</span></div>
            <div class="coord-item"><span class="coord-lbl">可用宽度 / 高度:</span><span class="coord-val">W: 730px, H: 513px</span></div>
            <div class="coord-item"><span class="coord-lbl">设计规划:</span><span class="coord-val">分步算式、规范等式、单位与答语</span></div>
          </div>

          <div class="zone-info-card">
            <div class="zone-card-title" style="color: #b45309;">📌 【总结区】参数</div>
            <div class="coord-item"><span class="coord-lbl">相对百分比:</span><span class="coord-val">x: 53.7% ~ 96.0%, y: 62.0% ~ 95.0%</span></div>
            <div class="coord-item"><span class="coord-lbl">1726×980 绝对像素:</span><span class="coord-val">X: 927px ~ 1657px, Y: 608px ~ 931px</span></div>
            <div class="coord-item"><span class="coord-lbl">可用宽度 / 高度:</span><span class="coord-val">W: 730px, H: 323px</span></div>
            <div class="coord-item"><span class="coord-lbl">设计规划:</span><span class="coord-val">方法口诀、易错警示、解题通法</span></div>
          </div>
        </div>
      </div>

      <!-- Tab 3: 自动化视频对接 (JSON) -->
      <div class="tab-pane" id="tab-json-spec">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-size: 13px; color: var(--text-secondary);">
            下游自动化教学视频合成引擎直接消费的标准 JSON 架构：
          </span>
          <button class="btn btn-primary" onclick="copyJson()">一键复制完整 JSON</button>
        </div>
        <pre class="json-code-box" id="json-code-block">${escapeHtml(jsonString)}</pre>
      </div>
    </section>
  </main>

  <!-- 嵌入完整的原始交付数据，离线打开或脚本读取均 100% 完整 -->
  <script id="deliverable-raw-data" type="application/json">
${JSON.stringify(deliverable)}
  </script>

  <script>
    window.__DELIVERABLE__ = JSON.parse(document.getElementById('deliverable-raw-data').textContent);

    function switchTab(tabId, btn) {
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const pane = document.getElementById(tabId);
      if (pane) pane.classList.add('active');
      if (btn) btn.classList.add('active');
    }

    function toggleFullscreen() {
      document.body.classList.toggle('is-fullscreen');
    }

    function toggleGrid(show) {
      document.getElementById('grid-overlay').style.display = show ? 'block' : 'none';
    }

    function toggleDividers(show) {
      document.getElementById('section-dividers').style.display = show ? 'block' : 'none';
    }

    function toggleLabels(show) {
      document.getElementById('zone-labels-group').style.display = show ? 'block' : 'none';
    }

    function filterTable(keyword, btn) {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      const rows = document.querySelectorAll('#five-fields-table tbody tr');
      rows.forEach(tr => {
        const stage = tr.getAttribute('data-stage') || '';
        if (keyword === 'all' || stage.includes(keyword)) {
          tr.style.display = '';
        } else {
          tr.style.display = 'none';
        }
      });
    }

    function copyJson() {
      const text = JSON.stringify(window.__DELIVERABLE__, null, 2);
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copy-btn');
        if (btn) {
          const old = btn.innerHTML;
          btn.innerHTML = '✓ 已复制到剪贴板';
          setTimeout(() => { btn.innerHTML = old; }, 2000);
        }
      }).catch(err => {
        alert('复制失败，请手动复制');
      });
    }

    function exportSpeechTxt() {
      const rows = window.__DELIVERABLE__?.rows || [];
      const lines = rows.map((r, i) => \`[\${r.stage || '步骤' \${i+1}}] (\${r.duration || ''})\\n\${r.speech || ''}\\n\`);
      const blob = new Blob([lines.join('\\n')], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`speech-\${window.__DELIVERABLE__?.projectCode || 'deliverable'}.txt\`;
      a.click();
      URL.revokeObjectURL(url);
    }

    /* 客户端原生录屏（纯浏览器交互授权，录制画布/动作/音频，0后端服务器开销） */
    let mediaRecorder = null;
    let recordedChunks = [];
    let recordingStream = null;
    let recordingTimerInterval = null;
    let recordingSeconds = 0;

    async function toggleScreenRecording() {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopScreenRecording();
      } else {
        await startScreenRecording();
      }
    }

    async function startScreenRecording() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          alert('您的浏览器当前不支持或禁用了屏幕录制 API (getDisplayMedia)。请使用 Chrome、Edge 或在独立浏览器窗口中打开本页面。');
          return;
        }

        // 优先请求包含音频的共享（提示用户可选择当前标签页或窗口，勾选共享标签页音频）
        let stream = null;
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              displaySurface: 'browser',
              frameRate: 30,
            },
            audio: true,
          });
        } catch (e) {
          // 若用户或环境不支持音频捕获，自动降级为纯视频录制
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 30 },
          });
        }

        if (!stream) return;
        recordingStream = stream;

        // 智能探测浏览器支持的最优录制格式
        let mimeType = 'video/webm;codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm;codecs=vp8,opus';
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm';
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = '';
        }

        recordedChunks = [];
        const options = mimeType ? { mimeType } : undefined;
        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          cleanupRecordingUI();
          if (recordedChunks.length > 0) {
            const actualType = mimeType || 'video/webm';
            const blob = new Blob(recordedChunks, { type: actualType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const projectCode = window.__DELIVERABLE__?.projectCode || 'deliverable';
            a.href = url;
            a.download = \`board-video-\${projectCode}.webm\`;
            a.click();
            URL.revokeObjectURL(url);

            const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);
            showToast(\`🎉 演播录屏已保存！时长: \${formatTimer(recordingSeconds)}，文件大小: \${sizeMb} MB\`);
          }
        };

        // 监听用户点击浏览器底部原生悬浮条的“停止共享”按钮
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
          };
        }

        mediaRecorder.start(1000);

        recordingSeconds = 0;
        updateRecordingTimerText();
        recordingTimerInterval = setInterval(() => {
          recordingSeconds++;
          updateRecordingTimerText();
        }, 1000);

        const btn = document.getElementById('btn-screen-record');
        if (btn) btn.classList.add('is-recording');
        const btnText = document.getElementById('record-btn-text');
        if (btnText) btnText.textContent = '正在录制 (点击停止)';

        const bar = document.getElementById('recording-bar');
        if (bar) bar.style.display = 'flex';

        showToast('🔴 录屏已开始！请演播您的板书、动作与口播');
      } catch (err) {
        if (err.name !== 'NotAllowedError') {
          alert('拉起录屏失败: ' + (err.message || String(err)));
        }
      }
    }

    function stopScreenRecording() {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
      }
    }

    function cancelScreenRecording() {
      recordedChunks = [];
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
      }
      cleanupRecordingUI();
      showToast('录屏已取消');
    }

    function cleanupRecordingUI() {
      if (recordingTimerInterval) {
        clearInterval(recordingTimerInterval);
        recordingTimerInterval = null;
      }
      const btn = document.getElementById('btn-screen-record');
      if (btn) btn.classList.remove('is-recording');
      const btnText = document.getElementById('record-btn-text');
      if (btnText) btnText.textContent = '录制演播视频';
      const bar = document.getElementById('recording-bar');
      if (bar) bar.style.display = 'none';
    }

    function formatTimer(sec) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return \`\${String(m).padStart(2, '0')}:\${String(s).padStart(2, '0')}\`;
    }

    function updateRecordingTimerText() {
      const el = document.getElementById('recording-timer');
      if (el) el.textContent = formatTimer(recordingSeconds);
    }

    function showToast(msg) {
      const t = document.createElement('div');
      t.className = 'deliverable-toast';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => { t.classList.add('show'); }, 10);
      setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 300);
      }, 4000);
    }
  </script>
</body>
</html>
`
}
