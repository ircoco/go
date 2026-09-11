/**
 * draw — 画图意图工具
 *
 * Agent B 编剧：写清楚 startCoord + intent（半结构化格式）。
 * Agent C 执行：直接解析 intent 的 key:value 段，不做自然语言猜测。
 *
 * startCoord 语义（画布百分比，左上角为0%,0%）：
 *   画图      → 图形的起笔点或左上角参考点
 *   标注      → 文字/符号/顶点编号的落点
 *   连线/辅助线→ 线段起点
 *   圈出/框出 → 包围对象的中心或起始定位点
 *
 * intent 格式规范（分号分隔，key:value，Agent C 可直接解析）：
 *   动作:画图|标注|写条件|画线|圈出
 *   图形:梯形|矩形|三角形|线段|椭圆（画图时必填）
 *   顶点:A左上,B右上,C右下,D左下（有顶点时填，逗号分隔）
 *   上底:6dm; 下底:9dm; 高:4dm（具体尺寸，有几个写几个）
 *   颜色:石墨灰|蓝色|红色|黑色
 *   说明:补充文字，不超过20字
 */

export const DRAW_INTENT_TOOL_ID = 'draw'

/**
 * Agent 工具描述（注入 userPayload.availableBoardTools）
 */
export function getDrawIntentAgentTool() {
  return {
    id: DRAW_INTENT_TOOL_ID,
    purpose: '描述要画的内容 + 起手坐标 + 时长；intent 按固定顺序用分号分隔 key:value，Agent C 可直接解析执行',
    actionSchema: {
      tool: DRAW_INTENT_TOOL_ID,
      region: '"analysis" | "solution" | "summary" — 对应环节（分析/解答/总结）',
      startCoord: '"x%,y%" 画布百分比；画图=左上参考点，标注=落点，连线=起点，圈出=中心',
      intent: '按顺序：动作:画图|板书|标注|划重点|画线|圈出; 时长:Xs; 然后是具体内容（图形/顶点/尺寸/颜色等）',
    },
    example: {
      tool: DRAW_INTENT_TOOL_ID,
      region: 'analysis',
      startCoord: '10%,20%',
      intent: '动作:画图; 时长:3s; 图形:梯形; 顶点:A左上10%20%,B右上30%20%,C右下38%35%,D左下5%35%; 上底AB:6dm; 颜色:石墨灰',
    },
  }
}

/**
 * 校验 draw action 结构
 */
export function validateDrawIntentAction(action) {
  if (action?.tool !== DRAW_INTENT_TOOL_ID) {
    return { ok: false, error: `tool 必须是 "${DRAW_INTENT_TOOL_ID}"` }
  }
  const VALID_REGIONS = new Set(['analysis', 'solution', 'summary'])
  if (!VALID_REGIONS.has(action?.region)) {
    return { ok: false, error: `region 必须是 analysis/solution/summary，当前：${action?.region}` }
  }
  if (typeof action?.intent !== 'string' || !action.intent.trim()) {
    return { ok: false, error: 'intent 不能为空，必须描述要画的内容' }
  }
  return {
    ok: true,
    value: {
      tool: DRAW_INTENT_TOOL_ID,
      region: action.region,
      startCoord: action.startCoord || null,
      intent: action.intent,
      order: null,
    },
  }
}
