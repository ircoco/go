import KNOWLEDGE_CSV from '../../doc/小学数学讲解视频生成工作台_6、关联知识表.csv?raw'

const KNOWLEDGE_FIELDS = [
  '编号',
  '学段',
  '系列',
  '类型',
  '知识点',
  '经典样题',
  '考点',
  '策略方法',
  '讲解要点举例',
  '易错点',
  '总结归纳',
]

function parseCsv(text) {
  const records = []
  let record = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      record.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      record.push(value)
      if (record.some((item) => item.trim())) records.push(record)
      record = []
      value = ''
    } else {
      value += character
    }
  }

  record.push(value)
  if (record.some((item) => item.trim())) records.push(record)
  if (!records.length) return []

  const headers = records.shift().map((item) => item.replace(/^\uFEFF/, '').trim())
  return records.map((values) => Object.fromEntries(
    headers.map((header, index) => [header, String(values[index] || '').trim()]),
  ))
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s，。；：、（）()【】《》“”‘’·—_=+x×÷/\\]/g, '')
}

function ngrams(value, size) {
  const text = normalizeText(value)
  const result = new Set()
  for (let index = 0; index <= text.length - size; index += 1) {
    result.add(text.slice(index, index + size))
  }
  return result
}

function overlapCount(left, right) {
  let count = 0
  left.forEach((item) => {
    if (right.has(item)) count += 1
  })
  return count
}

const KNOWLEDGE_ROWS = parseCsv(KNOWLEDGE_CSV)

function scoreKnowledge(row, problemText, problemType) {
  const problemBigrams = ngrams(problemText, 2)
  const problemTrigrams = ngrams(problemText, 3)
  const primary = `${row.知识点} ${row.经典样题} ${row.考点}`
  const supporting = `${row.策略方法} ${row.讲解要点举例} ${row.易错点}`
  let score = overlapCount(problemTrigrams, ngrams(primary, 3)) * 5
  score += overlapCount(problemBigrams, ngrams(primary, 2)) * 2
  score += overlapCount(problemTrigrams, ngrams(supporting, 3))

  const category = `${row.系列} ${row.类型}`
  if (problemType === 'geometry' && /图形|面积|周长|体积|角|线/.test(category)) score += 4
  if (problemType === 'calculation' && /计算|口算|竖式|分数|小数|运算/.test(category)) score += 4
  if (problemType === 'word' && /应用|数量关系|解决问题/.test(category)) score += 4
  return score
}

function toAgentKnowledge(row) {
  return Object.fromEntries(KNOWLEDGE_FIELDS.map((field) => [field, row[field] || '']))
}

export function selectAgentBRelatedKnowledge({ problemText, problemType, limit = 6 } = {}) {
  if (!String(problemText || '').trim()) return []

  const scored = KNOWLEDGE_ROWS
    .map((row, index) => ({ row, index, score: scoreKnowledge(row, problemText, problemType) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)

  const selected = []
  const used = new Set()
  const add = (item) => {
    const id = item?.row?.编号
    if (!id || used.has(id) || selected.length >= limit) return
    used.add(id)
    selected.push(item.row)
  }

  scored.slice(0, 4).forEach(add)
  for (const item of scored.slice(0, 3)) {
    for (const offset of [-1, 1]) {
      const neighbor = KNOWLEDGE_ROWS[item.index + offset]
      if (neighbor?.系列 === item.row.系列 && neighbor?.类型 === item.row.类型) {
        add({ row: neighbor })
      }
    }
  }
  scored.forEach(add)

  return selected.map(toAgentKnowledge)
}
