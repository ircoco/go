const STRATEGIES = Object.freeze({
  geometry: {
    id: 'geometry-diagram',
    title: '几何图解策略',
    mission: '分析区是主板书：分步骤建立图形、条件、对应关系和公式依据；解答区只承接规范计算',
    analysisRules: [
      '分析区优先承载图形轮廓、已知条件、高、辅助线、角或对应关系',
      '每发现一层新关系就新增一个分析步骤，不得把全部图形推理压成一行',
      '在分析区写清公式依据及其与图中条件的对应关系',
      '原图已经包含且足够清楚的内容不重复重画，只补教学所需标记',
      '图形动作只使用当前 availableBoardTools，缺工具就返回能力缺口',
    ],
    solutionRules: [
      '解答区只写已经分析清楚的代入、计算、单位和完整答案',
      '解答区不得取代分析区解释为什么这样列式',
    ],
    checks: ['图形条件是否对应正确', '公式依据是否正确', '长度/面积/体积单位是否正确'],
    avoid: ['只算不讲图形关系', '为了热闹重复画原图', '猜测图中不存在的尺寸'],
  },
  calculation: {
    id: 'calculation-process',
    title: '演算过程策略',
    mission: '分析区是主板书：分步骤讲清运算顺序、计算知识点、变形依据和易错点；解答区只承接规范算式',
    analysisRules: [
      '逐步写出运算顺序、同分母、约分关系、单位换算或其他本题知识点',
      '每次算式变化前先在分析区说明依据，不得直接跳到结果',
      '纯计算题不强行画图，但分析区必须承担计算方法讲解',
    ],
    solutionRules: [
      '解答区逐行写与当前分析步骤对应的规范算式，不一次出现最终全过程',
      '检查括号、运算顺序、约分、小数与 x 的逐处语义',
    ],
    checks: ['每一步等价变形是否成立', '最终结果是否最简', 'x 的每次出现是否注明语义'],
    avoid: ['跳步直接给答案', '重复抄写未变化部分造成视觉拥挤'],
  },
  word: {
    id: 'word-relation',
    title: '数量关系策略',
    mission: '分析区是主板书：分步骤让条件、问题、单位和数量关系可见；解答区只承接列式计算和答语',
    analysisRules: [
      '分析区表达关键条件之间的关系，可使用受控标记、线段或箭头工具',
      '按先求什么、为什么、得到什么拆成多个分析步骤，不得只圈条件后直接列式',
      '不把故事文字全文搬到分析区',
    ],
    solutionRules: [
      '解答区按已经讲清的数量关系写规范算式、检查单位并写完整答语',
      '答案必须回应题目问法',
    ],
    checks: ['条件是否用全', '数量关系是否与问法一致', '单位和答语是否完整'],
    avoid: ['只看到“多少”就套固定公式', '关系尚未说明就先写算式'],
  },
  general: {
    id: 'general-review',
    title: '谨慎兜底策略',
    mission: '分析区是主板书：按本题真实推理拆成多个步骤；解答区只承接规范算式和答语',
    analysisRules: ['不套固定模板，逐步写清每个判断依据、关系和知识点'],
    solutionRules: ['只写与当前分析步骤对应的规范解答'],
    checks: ['题型与板书侧重是否足够明确'],
    avoid: ['为了产出七列表而隐性假设'],
  },
})

const FOCUS_TO_STRATEGY = Object.freeze({
  geometry_diagram: 'geometry',
  calculation_process: 'calculation',
  relation_understanding: 'word',
})

const EXPECTED_FOCUS = Object.freeze({
  geometry: 'geometry_diagram',
  calculation: 'calculation_process',
  word: 'relation_understanding',
})

export function resolveAgentBTeachingStrategy({ problemType, boardFocus } = {}) {
  const typeKey = STRATEGIES[problemType] ? problemType : null
  const focusKey = FOCUS_TO_STRATEGY[boardFocus] || null
  const strategyKey = typeKey || focusKey || 'general'
  const expectedFocus = EXPECTED_FOCUS[strategyKey]
  const routingWarning = typeKey && focusKey && typeKey !== focusKey
    ? `第1步题型 ${problemType} 与板书侧重 ${boardFocus} 指向不同策略；按用户确认的题型主路执行，并保留此警告`
    : expectedFocus && boardFocus && boardFocus !== expectedFocus && boardFocus !== 'mixed'
      ? `板书侧重 ${boardFocus} 与 ${problemType} 默认侧重 ${expectedFocus} 不一致`
      : ''

  return {
    ...STRATEGIES[strategyKey],
    route: {
      source: 'step1-user-confirmed',
      problemType: problemType || 'other',
      boardFocus: boardFocus || 'mixed',
      primary: typeKey ? 'problemType' : focusKey ? 'boardFocus' : 'fallback',
    },
    routingWarning,
  }
}
