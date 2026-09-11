const BOARD_SLASH_FRACTION_PATTERN = /\d+\s*[\/⁄]\s*\d+/
const BOARD_SPOKEN_FRACTION_PATTERN = /\d+分之\d+/
const KATEX_CHINESE_TEXT_PATTERN = /\\text\s*\{[^}]*[\u4e00-\u9fff][^}]*\}/

export function validateBoardMathText(text) {
  const value = String(text || '')
  if (BOARD_SLASH_FRACTION_PATTERN.test(value)) {
    return { ok: false, error: '板书分数不得使用斜杠，必须使用 KaTeX \\frac{分子}{分母}' }
  }
  if (BOARD_SPOKEN_FRACTION_PATTERN.test(value)) {
    return { ok: false, error: '板书不得使用口播式“分母分之分子”，必须使用 KaTeX 上下结构' }
  }
  if (KATEX_CHINESE_TEXT_PATTERN.test(value)) {
    return { ok: false, error: '中文标题、推理和答语不得塞进 KaTeX \\text；它们使用用户选择的板书字体' }
  }
  return { ok: true }
}

export function validateAgentBBoardRows(rows, { hardFail = false } = {}) {
  const warnings = []
  const next = (Array.isArray(rows) ? rows : []).map((row, index) => {
    for (const [field, label] of [['analysisBoard', '分析区'], ['solutionBoard', '解答区']]) {
      const result = validateBoardMathText(row?.[field])
      if (!result.ok) {
        const msg = `第 ${index + 1} 行${label}板书不合规：${result.error}`
        if (hardFail) throw new Error(msg)
        warnings.push(msg)
      }
    }
    return row
  })
  if (warnings.length) {
    console.warn('[boardMathPolicy] soft warnings:', warnings)
    next.__boardMathWarnings = warnings
  }
  return next
}

export function getAgentBBoardMathPolicy() {
  return {
    responsibility: 'Agent B 提供数学语义与 KaTeX 板书表达；Agent C 后续负责真实渲染和动画',
    fractionDualRepresentation: {
      speech: '分母分之分子，例如 5/8 的口播是 8分之5',
      board: 'KaTeX 上下结构，例如 5/8 的板书是 \\frac{5}{8}',
      mixedNumber: {
        speech: '1又2分之1',
        board: '1\\frac{1}{2}',
      },
    },
    katexBoundary: {
      useFor: ['分数', '根号', '上下标', '数学公式结构'],
      doNotUseFor: ['中文标题', '推理文字', '答语', '总结文字'],
      rule: '中文板书使用用户选择的手写字体；不要用 KaTeX \\text 包住中文',
    },
  }
}
