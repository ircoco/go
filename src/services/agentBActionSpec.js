import { validateBoardToolAction } from '../board-tools/boardToolCatalog.js'

function parseActionSpec(value) {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') throw new Error('actionSpec 必须是数组或 JSON 数组字符串')
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) throw new Error('actionSpec JSON 必须是数组')
    return parsed
  } catch (error) {
    throw new Error(error?.message || 'actionSpec 不是有效 JSON')
  }
}

function validateCapabilityGap(gap) {
  if (!gap || typeof gap !== 'object') throw new Error('capabilityGap 必须是对象')
  if (!String(gap.id || '').trim()) throw new Error('capabilityGap.id 不能为空')
  if (!String(gap.need || '').trim()) throw new Error('capabilityGap.need 不能为空')
}

export function validateAgentBActionSpecs(rows) {
  const usedOrders = new Set()
  return (Array.isArray(rows) ? rows : []).map((row, rowIndex) => {
    const entries = parseActionSpec(row?.actionSpec)
    entries.forEach((entry, entryIndex) => {
      const position = `第 ${rowIndex + 1} 行第 ${entryIndex + 1} 个动作`
      const cueText = String(entry?.cueText || '').trim()
      if (!cueText) throw new Error(`${position}缺少 cueText`)
      if (!String(row?.speech || '').includes(cueText)) {
        throw new Error(`${position}的 cueText 不在本行 speech 中`)
      }

      const hasAction = Boolean(entry?.action)
      const hasGap = Boolean(entry?.capabilityGap)
      if (hasAction === hasGap) {
        throw new Error(`${position}必须且只能包含 action 或 capabilityGap`)
      }
      if (hasGap) {
        validateCapabilityGap(entry.capabilityGap)
        return
      }

      const result = validateBoardToolAction(entry.action)
      if (!result.ok) throw new Error(`${position}不合规：${result.error}`)
      // draw 工具是意图描述，没有 order，跳过全局唯一性校验
      const order = result.value?.order
      if (order != null) {
        if (usedOrders.has(order)) throw new Error(`${position}的 order ${order} 与其他动作重复`)
        usedOrders.add(order)
      }
    })
    return { ...row, actionSpec: JSON.stringify(entries, null, 2) }
  })
}
