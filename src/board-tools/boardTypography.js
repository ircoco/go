export const BOARD_TYPOGRAPHY_STORAGE_KEY = 'qinghuabu.boardTypography.v1'
export const DEFAULT_HANDWRITING_FONT_ID = 'qiaomu-local'

export const HANDWRITING_FONTS = Object.freeze([
  {
    id: 'qiaomu-local',
    label: '平方乔木体',
    family: 'Qinghuabu Qiaomu',
    source: 'local',
  },
  {
    id: 'pingfang-shaohua',
    label: '平方韶华',
    family: 'PING FANG SHAO HUA',
    source: 'remote-css',
    href: 'https://fontsapi.zeoseven.com/157/main/result.css',
  },
  {
    id: 'like-jianjianti',
    label: '片刻见见体',
    family: 'LikeJianJianTi',
    source: 'remote-css',
    href: 'https://fontsapi.zeoseven.com/490/main/result.css',
  },
  {
    id: 'pingfang-shangshangqian',
    label: '平方上上签',
    family: 'PING FANG SHAGN SHANG QIAN',
    source: 'remote-css',
    href: 'https://fontsapi.zeoseven.com/511/main/result.css',
  },
  {
    id: 'pingfang-sansheng',
    label: '平方三生',
    family: 'PING FANG SAN SHENG',
    source: 'remote-css',
    href: 'https://fontsapi.zeoseven.com/510/main/result.css',
  },
])

export function getHandwritingFont(fontId) {
  return HANDWRITING_FONTS.find((font) => font.id === fontId) || null
}

export function assertHandwritingScope({ layer, region } = {}) {
  if (layer !== 'L3') throw new Error('手写字体只允许用于 L3 板书层')
  if (!['analysis', 'solution', 'summary'].includes(region)) {
    throw new Error('手写字体只允许用于分析、解答、总结板书；题目层永久禁止')
  }
  return true
}

export function getHandwritingStyle(fontId) {
  const font = getHandwritingFont(fontId)
  if (!font) throw new Error(`未知板书字体: ${fontId || '空'}`)
  return {
    fontFamily: `"${font.family}", "KaiTi", "STKaiti", cursive`,
    fontWeight: 'normal',
  }
}

export async function ensureHandwritingFont(fontId) {
  const font = getHandwritingFont(fontId)
  if (!font) throw new Error(`未知板书字体: ${fontId || '空'}`)
  if (font.source === 'remote-css') {
    const linkId = `board-font-${font.id}`
    let link = document.getElementById(linkId)
    if (!link) {
      link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      link.href = font.href
      link.crossOrigin = 'anonymous'
      document.head.appendChild(link)
    }
    if (!link.sheet) {
      await new Promise((resolve, reject) => {
        link.addEventListener('load', resolve, { once: true })
        link.addEventListener('error', () => reject(new Error(`板书字体加载失败: ${font.label}`)), { once: true })
      })
    }
  }
  await document.fonts?.load?.(`16px "${font.family}"`)
  return font
}

export function loadBoardTypographyConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(BOARD_TYPOGRAPHY_STORAGE_KEY) || '{}')
    const fontId = getHandwritingFont(saved.fontId)?.id || DEFAULT_HANDWRITING_FONT_ID
    return { fontId }
  } catch {
    return { fontId: DEFAULT_HANDWRITING_FONT_ID }
  }
}

export function saveBoardTypographyConfig(config = {}) {
  const fontId = getHandwritingFont(config.fontId)?.id || DEFAULT_HANDWRITING_FONT_ID
  const saved = { fontId }
  localStorage.setItem(BOARD_TYPOGRAPHY_STORAGE_KEY, JSON.stringify(saved))
  return saved
}

export function getAgentBoardTypographyPolicy(fontId) {
  const font = getHandwritingFont(fontId) || getHandwritingFont(DEFAULT_HANDWRITING_FONT_ID)
  return {
    kind: 'board-environment-not-tool',
    selectedHandwritingFont: { id: font.id, label: font.label, family: font.family },
    allowed: { layer: 'L3', regions: ['analysis', 'solution', 'summary'] },
    forbidden: {
      layers: ['L1', 'L2', 'L4'],
      regions: ['question'],
      rule: '第1步已确认题目是不可变资产；禁止改题文、题目字体、题目位置或尺寸',
    },
  }
}
