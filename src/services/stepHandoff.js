/* @qh-core LANE=STEP1 POINT=HANDOFF_OWNER payload from Agent A to Agent B */
/**
 * 第1步 → 板书参数书稿页 交接
 * 信号：用户点击「确定进入生成表」
 * 核心：题目内容、题型、板书侧重 + 第1步已定题目坐标
 */
export function hasUsableAgentAKnowledge(analysis) {
  return Array.isArray(analysis?.coreKnowledge) && analysis.coreKnowledge.length > 0
}

/* 题型比例判断（SK-06 绑定CU）
 * 根据题型、知识点、题目文本判断属于 a/b/c/d/e 哪类，给出各stage时间占比建议
 * a 计算确定：整数/小数/分数计算、竖式、口算 → 解答50-78%为主
 * b 方法确定：图形面积/周长、植树、鸡兔同笼、归一、税率、利率、比和比例 → 解答55-65%
 * c 答案不确定：最值、规律、列举组合、开放应用 → 分析≈解答25-50%
 * d 建模推导：行程、工程、浓度、等量代换、列方程 → 边画边讲，解答55-70%
 * e 概念确定：图形认识、概念辨析、单位换算、定义判定 → 读题+直接判定，分析可近0
 */
const STAGE_RATIO_TABLE = {
  a: {
    cuCode: 'CU-02',
    category: '计算确定',
    topicExamples: '整数计算、小数宝典(加减乘除)、分数计算、竖式/口算',
    analysisPct: '4-12%',
    solutionPct: '50-78%',
    summaryPct: '15-28%',
    introPct: '7%',
    essence: '解答绝对主体+收尾必做法则/方法大总结；读题/寒暄极短',
    keywords: ['计算', '整数', '小数', '分数', '竖式', '口算', '加减乘除', '四则运算'],
  },
  b: {
    cuCode: 'CU-03',
    category: '方法确定',
    topicExamples: '长方形&正方形(面积/周长)、平行四边形/梯形(面积)、植树、鸡兔同笼(假设)、归一、税率、利润利率、比和比例',
    analysisPct: '5-15%',
    solutionPct: '55-65%',
    summaryPct: '5-10%',
    introPct: '23%',
    essence: '解答绝对主体，标准结构',
    keywords: ['长方形', '正方形', '平行四边形', '梯形', '面积', '周长', '植树', '鸡兔同笼', '归一', '税率', '利润', '利率', '比和比例', '比例'],
  },
  c: {
    cuCode: 'CU-01',
    category: '答案不确定',
    topicExamples: '最值(开放)、规律&算式规律(探索)、列举与组合(方案)、开放应用',
    analysisPct: '25-40%',
    solutionPct: '38-50%',
    summaryPct: '8-14%',
    introPct: '13%',
    essence: '分析≈解答，试错链承载决策（分析=试错探索含否定/重选；解答=收敛结论）',
    keywords: ['最值', '最大', '最小', '规律', '找规律', '列举', '组合', '开放', '至少', '至多', '可能'],
  },
  d: {
    cuCode: 'CU-04',
    category: '建模推导',
    topicExamples: '行程、工程、浓度、等量代换与应用、列方程解应用',
    analysisPct: '5-15%',
    solutionPct: '55-70%',
    summaryPct: '5-10%',
    introPct: '20%',
    essence: '边画边讲，模型即分析载体',
    keywords: ['行程', '相遇', '追及', '工程', '浓度', '等量代换', '列方程', '解方程', '方程'],
  },
  e: {
    cuCode: 'CU-05',
    category: '概念确定',
    topicExamples: '图形认识与分类、概念辨析(质数合数/奇偶/因数倍数)、单位换算判定、定义判定',
    analysisPct: '0-8%',
    solutionPct: '55-65%',
    summaryPct: '5-10%',
    introPct: '29%',
    essence: '读题+直接判定，分析可近0',
    keywords: ['图形认识', '分类', '概念辨析', '单位换算', '定义', '判断', '比较', '辨认'],
  },
}

export function detectStageRatio(problemType, relatedKnowledge, problemText) {
  const text = `${problemType || ''} ${(relatedKnowledge || []).map(k => typeof k === 'string' ? k : (k.knowledgePoint || k.name || '')).join(' ')} ${problemText || ''}`
  let bestMatch = null
  let bestScore = 0
  for (const [key, rule] of Object.entries(STAGE_RATIO_TABLE)) {
    let score = 0
    for (const kw of rule.keywords) {
      if (text.includes(kw)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      bestMatch = key
    }
  }
  if (!bestMatch) return null
  const rule = STAGE_RATIO_TABLE[bestMatch]
  return {
    type: bestMatch,
    cuCode: rule.cuCode,
    category: rule.category,
    topicExamples: rule.topicExamples,
    suggestedRatio: {
      analysis: rule.analysisPct,
      solution: rule.solutionPct,
      summary: rule.summaryPct,
      introAndClosing: rule.introPct,
    },
    essence: rule.essence,
    confidence: bestScore >= 2 ? 'high' : 'medium',
  }
}

export function buildStep1Handoff(input = {}) {
  const problemText = String(input.problemText || '').trim()
  const problemType = input.problemType || null
  const boardFocus = input.boardFocus || null
  const imageKind = input.imageKind || (input.keepOriginal ? 'has_diagram' : 'text_only')
  const topicLayout = roundLayoutNumbers(input.topicLayout ? JSON.parse(JSON.stringify(input.topicLayout)) : null)
  const relatedKnowledge = Array.isArray(input.relatedKnowledge)
    ? JSON.parse(JSON.stringify(input.relatedKnowledge))
    : null

  // Agent A 深度知识点分析结果（识别时 LLM 直接产出）
  const knowledgeAnalysis = hasUsableAgentAKnowledge(input.knowledgeAnalysis)
    ? JSON.parse(JSON.stringify(input.knowledgeAnalysis))
    : null

  // 从 knowledgeAnalysis 提取参考年级（供 Agent B 参考）
  const suggestedGrade = String(input.suggestedGrade || knowledgeAnalysis?.suggestedGrade || '').trim()

  // Agent A 与 Agent B 只使用同一套百分比坐标。
  const coordinateSpec = {
    coordinateSystem: '百分比坐标（0—100），原点左上',
    format: {
      region: '区域：[左%, 上%, 宽%, 高%]，所有百分比最多保留 2 位小数',
      point: '起点/终点：[x%, y%]',
    },
    example: '若分析区起手坐标为 (6%, 41%)，则动作点为 [6, 41]',
  }

  // 从 boardPlan 提取各区域起手坐标（落座标签 + 区域起点）
  const boardPlan = roundLayoutNumbers(input.boardPlan ? JSON.parse(JSON.stringify(input.boardPlan)) : null)
  const zoneAnchors = extractZoneAnchors(boardPlan, topicLayout)

  // 画布参数（Agent B 计算起手坐标的依据，固定值不随题目变化）
  const canvasParams = {
    canvasSize: { width: 1726, height: 980, unit: 'px', origin: '左上角(0,0), X向右Y向下' },
    coordinateSystem: '百分比坐标 0-100',
    fontSize: {
      question: { px: 30, family: 'Segoe UI/PingFang SC/Microsoft YaHei（印刷体）', color: '黑色' },
      analysis: { px: 38, family: 'LikeJianJianTi（手写尖尖体）', color: '红色' },
      solution: { px: 38, family: 'LikeJianJianTi（手写尖尖体）', color: '黑色' },
      summary: { px: 38, family: 'LikeJianJianTi（手写尖尖体）', color: '黑色' },
    },
    lineHeight: {
      question: 1.65,
      others: '约 1.7（下游渲染会做 1.55-1.85 微小随机，B 按平均值估算即可）',
    },
    letterSpacing: {
      question: '0',
      others: '下游渲染参数：0-2px 微小随机（模拟手写感，B 不需要处理）',
    },
    boardSpeed: '下游渲染参数：1秒约2个汉字，每行±10%轻微抖动（B 不需要处理速度细节）',
    actionSpeed: '差不多同样速度（rough-line/rough-arrow/rough-notation绘制速度）',
    lineHeightFormula: '每行高度(px)≈字号×行高；每行高度(%)=每行高度(px)/980×100。示例：32px×1.7=54.4px≈5.55%画布高度，即每写一行y约增5.5%',
  }

  return {
    handoffVersion: 1,
    confirmedAt: new Date().toISOString(),
    problemText,
    problemType,
    boardFocus,
    relatedKnowledge,
    knowledgeAnalysis,
    suggestedGrade,
    uncertainItems: Array.isArray(input.uncertainItems) ? JSON.parse(JSON.stringify(input.uncertainItems)) : [],
    suggestedLayout: input.suggestedLayout || null,
    imageKind,
    keepOriginal: Boolean(input.keepOriginal),
    coordinateSpec,
    zoneAnchors,
    topicLayout,
    boardPlan,
    canvasParams,
    showGrid: Boolean(input.showGrid),
    // B 图片传输冻结：甲方后续确认该能力并追加预算后，再恢复原图/快照交接。
    // 当前 B 只接收题干文字和 Agent A 的结构化布局信息。
    agentPageName: input.agentPageName || '',
    agentCapability: input.agentCapability || '',
    // ⚠️⚠️⚠️ 本地存档字段，不在 HANDOFF_TEXT_FIELDS 白名单，绝对不发给 Agent B ⚠️⚠️⚠️
    // screenshotUrl: 题目截图地址（"/pic/shot-时间戳.png"），B 遇到看图题时可应急回看题目原文
    // knowledgeBasePath: 知识库文件地址，修缮 API 后端读 handoff 就能拿到，不需要前端传
    screenshotUrl: input.screenshotUrl || null,
    knowledgeBasePath: input.knowledgeBasePath || 'doc/knowledge-a.compact.json',
    // 题型比例建议（SK-06 绑定CU）：根据题型判断 a/b/c/d/e 类，给出各stage时间占比建议
    // 优化 agent 可根据此建议调整各 stage 行数和内容深度；B 生成时也可参考
    stageRatioSuggestion: detectStageRatio(problemType, relatedKnowledge, problemText),
  }
}

function roundLayoutNumbers(value) {
  if (Array.isArray(value)) return value.map(roundLayoutNumbers)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundLayoutNumbers(item)]))
  }
  return typeof value === 'number' && Number.isFinite(value)
    ? Number(value.toFixed(2))
    : value
}

/**
 * 从 boardPlan + topicLayout 提取各区域的标签位置和起手坐标。
 * 这些坐标会传给 Agent B，让它在生成 draw 动作时有明确的落点参考。
 */
function extractZoneAnchors(boardPlan, _topicLayout) {
  if (!boardPlan) return null
  const anchors = {}
  // 题目区
  if (boardPlan.topicLabel || boardPlan.question) {
    anchors.question = {
      label: boardPlan.topicLabel || null,
      labelStartCoord: boardPlan.topicLabel
        ? { x: boardPlan.topicLabel.x, y: boardPlan.topicLabel.y }
        : null,
      regionStartCoord: boardPlan.question
        ? { x: boardPlan.question.x, y: boardPlan.question.y, w: boardPlan.question.w, h: boardPlan.question.h || null }
        : null,
    }
  }
  // 分析区、解答区、总结区
  const zones = ['analysis', 'solution', 'summary']
  const labelZones = ['analysisLabel', 'solutionLabel', 'summaryLabel']
  for (let i = 0; i < zones.length; i += 1) {
    const zone = zones[i]
    const labelKey = labelZones[i]
    const label = boardPlan[labelKey]
    const region = boardPlan[zone]
    if (label || region) {
      anchors[zone] = {
        label: label || null,
        labelStartCoord: label
          ? { x: label.x, y: label.y }
          : null,
        regionStartCoord: region
          ? { x: region.x, y: region.y, w: region.w, h: region.h || null }
          : null,
      }
    }
  }
  return anchors
}
