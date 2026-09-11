/**
 * problemTypeClassifier — 统一题型判断 + 规范化
 * 消除 Step1Entry.suggestFromText 与 recognitionClient.normalizeType 的重复 regex
 *
 * 夏夏说明：粗判断，后续整理「题型分类库」再细接
 */

const GEOMETRY_RE = /梯形|平行四边形|矩形|正方形|菱形|三角|圆|扇形|几何|图形|如图|作图|证明|∠|°|底边|高|对角线|相似|全等|平行|垂直|面积|周长|体积|边长|长|宽|角度|求角|夹角|圆心角|半径|直径|弦|弧|面积是多少|边长是多少/
const CALCULATION_RE = /方程|计算|求值|化简|运算|简便|竖式/
const WORD_RE = /应用题|场景|小船|顺水|逆水|鸡兔同笼|鸡|兔|行程|工程|速度|工作效率|买|卖|原价|折扣|余下|还剩|一共|多少人|多少钱|果园|工厂|水池/

/** 模型返回值规范化（也做本地别名映射） */
const MODEL_ALIAS_RE = {
  geometry: /几何|图形|平面几何|梯形|平行四边|三角|圆|面积|周长|体积|边长|角度|长|宽|高|底边/,
  calculation: /计算|运算|化简|求值/,
  word: /应用|行程|工程/,
}

const VALID_TYPES = new Set(['geometry', 'calculation', 'word', 'other'])
const FOCUS_MAP = {
  geometry: 'geometry_diagram',
  calculation: 'calculation_process',
  word: 'relation_understanding',
}

/**
 * 从题目文本本地粗判题型（用于本地纠偏或兜底）
 * @param {string} text
 * @returns {{ type: string | undefined, focus: string | undefined }}
 */
export function classifyProblemType(text) {
  const raw = text || ''
  if (GEOMETRY_RE.test(raw)) return { type: 'geometry', focus: 'geometry_diagram' }
  if (CALCULATION_RE.test(raw)) return { type: 'calculation', focus: 'calculation_process' }
  if (WORD_RE.test(raw)) return { type: 'word', focus: 'relation_understanding' }
  return { type: undefined, focus: undefined }
}

/**
 * 规范化模型返回的 problemType 字符串
 * @param {string} value
 * @returns {string | undefined}
 */
export function normalizeProblemType(value) {
  const v = String(value || '').toLowerCase()
  if (VALID_TYPES.has(v)) return v
  for (const [type, re] of Object.entries(MODEL_ALIAS_RE)) {
    if (re.test(v)) return type
  }
  return undefined
}

/**
 * 规范化 boardFocus（可依赖 normalizeProblemType 结果）
 * @param {string} focus
 * @param {string} type 已规范化的 problemType
 * @returns {string | undefined}
 */
export function normalizeBoardFocus(focus, type) {
  const v = String(focus || '').toLowerCase()
  if (['geometry_diagram', 'calculation_process', 'relation_understanding', 'mixed'].includes(v)) return v
  return FOCUS_MAP[type] ?? undefined
}
