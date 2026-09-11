export const SPEECH_RATE_CHARACTERS_PER_MINUTE = 170
export const SPEECH_MS_PER_CHARACTER = Math.round(60000 / SPEECH_RATE_CHARACTERS_PER_MINUTE)
export const SPEECH_TIMING_SOURCE = 'speech-estimate-170-cpm'
export const SPEECH_ROW_GAP_MS = 300

const GENERATE_AUDIO_LABEL = '【点击生成语音】'
const FRACTION_SLASH_PATTERN = /\d+\s*[\/⁄]\s*\d+/
const CHINESE_FRACTION_PATTERN = /(?:[零〇一二两三四五六七八九十百千万亿]+分之|分之[零〇一二两三四五六七八九十百千万亿]+)/
const RAW_DECIMAL_PATTERN = /\d+\.\d+/
const ARABIC_DECIMAL_PART_PATTERN = /\d+点\d+/
const COMBINED_CHINESE_DECIMAL_PATTERN = /\d+点[零〇一二两三四五六七八九]*[十百千万亿]/
const KATEX_SPEECH_PATTERN = /(?:\\(?:d?frac|sqrt|text)|\$)/

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export function normalizeSpeechForTiming(speech) {
  return String(speech || '')
    .replaceAll(GENERATE_AUDIO_LABEL, '')
    .replace(/\s+/g, '')
}

export function normalizeSpeechText(speech) {
  return String(speech || '').replaceAll(GENERATE_AUDIO_LABEL, '').trim()
}

export function countSpeechCharacters(speech) {
  return [...normalizeSpeechForTiming(speech)].length
}

export function estimateSpeechDurationMs(speech) {
  return countSpeechCharacters(speech) * SPEECH_MS_PER_CHARACTER
}

export function validateSpeechFractionReading(speech) {
  const text = String(speech || '')
  if (FRACTION_SLASH_PATTERN.test(text)) {
    return { ok: false, error: '口播中的分数不得使用斜杠，必须写成“分母分之分子”' }
  }
  if (CHINESE_FRACTION_PATTERN.test(text)) {
    return { ok: false, error: '口播分数的分子、分母必须使用阿拉伯数字' }
  }
  return { ok: true }
}

export function validateSpeechMathReading(speech) {
  const text = String(speech || '')
  if (KATEX_SPEECH_PATTERN.test(text)) {
    return { ok: false, error: '口播不得包含 KaTeX 命令或 $ 定界符，只能保存可直接发音的文字' }
  }
  if (/[xX×]/.test(text)) {
    return { ok: false, error: '口播不得保留 x、X 或 ×；未知数写“艾克斯”，乘号写“乘以”' }
  }
  if (text.includes('+')) {
    return { ok: false, error: '口播中的 + 必须写成“加”' }
  }
  return { ok: true }
}

export function validateSpeechDecimalReading(speech) {
  const text = String(speech || '')
  if (RAW_DECIMAL_PATTERN.test(text)) {
    return { ok: false, error: '口播小数不得保留小数点符号，例如 3.14 必须写成“3点一四”' }
  }
  if (ARABIC_DECIMAL_PART_PATTERN.test(text)) {
    return { ok: false, error: '口播小数点后的每一位必须使用汉字数字单独书写' }
  }
  if (COMBINED_CHINESE_DECIMAL_PATTERN.test(text)) {
    return { ok: false, error: '口播小数部分不得合并成十、百等数位，必须逐位念' }
  }
  return { ok: true }
}

export function applyEstimatedSpeechTimeline(rows, { startAtSeconds = 0 } = {}) {
  let cursorMs = Math.max(0, Math.round(startAtSeconds * 1000))
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const speech = normalizeSpeechText(row?.speech)
    const fractionResult = validateSpeechFractionReading(speech)
    if (!fractionResult.ok) throw new Error(`第 ${index + 1} 行口播不合规：${fractionResult.error}`)
    const mathResult = validateSpeechMathReading(speech)
    if (!mathResult.ok) throw new Error(`第 ${index + 1} 行口播不合规：${mathResult.error}`)
    const decimalResult = validateSpeechDecimalReading(speech)
    if (!decimalResult.ok) throw new Error(`第 ${index + 1} 行口播不合规：${decimalResult.error}`)

    const speechCharacters = countSpeechCharacters(speech)
    if (!speechCharacters) {
      return {
        ...row,
        speech,
        duration: '待口播',
        timingStatus: 'missing-speech',
        timingSource: SPEECH_TIMING_SOURCE,
        speechCharacters: 0,
        estimatedDurationMs: 0,
      }
    }

    const estimatedDurationMs = estimateSpeechDurationMs(speech)
    const startMs = cursorMs
    const endMs = startMs + estimatedDurationMs
    cursorMs = endMs + SPEECH_ROW_GAP_MS
    return {
      ...row,
      speech,
      duration: `预计 ${formatClock(startMs / 1000)}—${formatClock(endMs / 1000)}`,
      timingStatus: 'estimated',
      timingSource: SPEECH_TIMING_SOURCE,
      speechCharacters,
      estimatedDurationMs,
      estimatedStartMs: startMs,
      estimatedEndMs: endMs,
    }
  })
}

export function getAgentBSpeechPolicy() {
  return {
    responsibility: 'Agent B 只写完整可朗读口播；程序根据 speech 自动生成连续预估时间，忽略 Agent 自填时间',
    writingPrinciple: '口播稿不展示给观众，只要求 TTS 发音正确；不用追求书面排版细节',
    timing: {
      status: 'estimated-until-tts',
      charactersPerMinute: SPEECH_RATE_CHARACTERS_PER_MINUTE,
      millisecondsPerCharacter: SPEECH_MS_PER_CHARACTER,
      countingRule: '去除空白后按可见字符计数；标点按一个节奏字符计入粗估',
      replacementRule: '真实 TTS 音频生成后，用音频实际时长覆盖预估时间；不因此改写已确认的口播、板书内容或动作顺序',
    },
    fractionReading: {
      rule: '分数统一写成“分母分之分子”，分子、分母使用阿拉伯数字',
      mixedNumberRule: '带分数写成“整数又分母分之分子”，所有数字使用阿拉伯数字',
      forbidden: ['口播使用 / 或 ⁄ 表示分数', '口播使用中文数字表示分子或分母'],
      examples: [
        { math: '5/8', speech: '8分之5' },
        { math: '1/2', speech: '2分之1' },
        { math: '3/4', speech: '4分之3' },
        { math: '1 1/2', speech: '1又2分之1' },
      ],
      boardBoundary: '此规则只约束口播；板书分数必须保持上下结构，不得写成“8分之5”或斜杠形式',
    },
    uiBoundary: '“生成语音”是每行口播单元格中的前端按钮，不属于 speech，不由 Agent B 输出',
    mathReading: {
      unknownX: '板书中的未知数 x，口播写“艾克斯”',
      multiplyX: '板书中的乘号 x，口播写“乘以”',
      plus: '板书中的 +，口播写“加”',
      example: { board: '2x+2', notes: '本行 x 是未知数', speech: '2艾克斯加2' },
    },
    decimalReading: {
      rule: '整数部分保留阿拉伯数字；“.”写成“点”；小数点后的数字逐位改写为汉字数字',
      examples: [
        { math: '3.14', speech: '3点一四' },
        { math: '0.05', speech: '0点零五' },
      ],
      forbidden: ['3.14', '3点14', '3点十四'],
    },
    classroomLanguageReference: {
      usage: '这是夏夏为教学板书补充的课堂话术参考素材。请结合当前题目、题型、知识关联点和画面自然改写，按需选用；不得机械拼接，不得照抄占位符，不得凭空补充题目中没有的信息。每行只完成当前教学任务，语言要耐心、清楚、像老师陪小朋友一步一步想通。',
      friendlyOpening: [
        '同学你好，很高兴和你一起弄懂这道题。',
        '下面我们来看这道题。',
        '这道题不用着急，我们一步一步来。',
      ],
      readingAndObservation: [
        '我们先把题目完整读一遍。',
        '题目要求我们解决什么问题？',
        '先看看题目给了哪些关键条件。',
        '注意题目中的数字和单位，它们分别表示什么？',
        '仔细观察图形和文字条件之间有什么关系。',
        '看到这样的题目，我们可以联想到哪个知识点？',
        '关键信息找到了，接下来把它们之间的关系理清楚。',
      ],
      analysisGuidance: {
        general: [
          '了解了题目，我们来分析一下解题思路。',
          '看到题目，我们先想一想它主要考查什么。',
          '先说清为什么这样做，再开始列式计算。',
        ],
        calculation: [
          '口算时可以观察数字特点，再选择凑整、拆分或合并的方法。',
          '竖式计算先把相同数位对齐，再从低位算起。',
          '加法满十进一，减法不够减时退一当十。',
          '混合运算先看有没有括号，再按先乘除后加减的顺序计算。',
          '脱式计算每一步只完成一个运算，其余部分照写。',
          '如果数字能凑成整十、整百，可以考虑运算律让计算更简洁。',
        ],
        wordProblem: [
          '先理解题意，找出已知条件、所求问题和它们之间的数量关系。',
          '多步问题要说清先求什么、为什么先求它，再继续下一步。',
          '列式前先检查每个数量的单位是否一致。',
          '算完后还要回到题目，看看结果是否符合实际情况。',
        ],
        geometry: [
          '先在分析区把图形、已知条件和所求位置标清楚。',
          '需要作辅助线时，要讲清这条线为什么能帮助我们找到关系。',
          '代入公式前先确认对应的底、高、边长或角分别是哪一个。',
        ],
      },
      transitions: {
        readingToAnalysis: [
          '了解了题目，我们来分析一下解题思路。',
          '好的，现在我们看看这道题的关键在哪里。',
          '题目读清楚了，接下来把条件之间的关系理一理。',
        ],
        analysisToSolution: [
          '有了思路，我们动手算一算。',
          '知道为什么这样做了，现在把过程规范地写出来。',
          '关系已经理清楚，接下来进行实际计算。',
        ],
        solutionToSummary: [
          '计算完成了，我们回顾一下解题过程。',
          '答案出来了，再检查一次条件、结果和单位。',
          '这道题做完了，我们总结一下真正用到的方法。',
        ],
      },
      stepGuidance: [
        '接下来进行下一步。',
        '现在先完成第一步。',
        '注意了，下面这一步很关键。',
        '这里容易出错，我们慢一点看。',
        '做完这一步，再看下一步需要什么。',
        '按照刚才理清的关系继续计算。',
        '这一步完成后，我们得到了一个新的条件。',
        '先检查这一步，再继续往下。',
      ],
      summaryAndReview: [
        '我们用的方法是先理清条件关系，再列式计算，最后检查结果。',
        '解决这类问题的关键，是先找到题目中真正对应的数量关系。',
        '遇到多步问题，要分清每一步求什么，以及前后为什么能接起来。',
        '这道题容易错的地方要再提醒一次。',
        '算完后要检查计算、单位和答语是否完整。',
        '如果结果和题目条件对不上，要回到分析过程寻找原因。',
        '同类题目的数字可能变化，但分析关系的方法仍然可以复用。',
        '好了，这道题我们就讲到这里。',
      ],
    },
  }
}
