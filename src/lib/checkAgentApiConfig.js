import { reactive } from 'vue'

const STORAGE_KEY = 'qinghuabu.checkAgentApiConfig.v2'
const DEFAULT_CHECK_AGENT_API_CONFIG = Object.freeze({
  endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions',
  apiKey: 'sk-j65y59QN4AR6kQlV2Q4JJkqsYX6eEBZMvKWkKF27SmkYm9Pt',
  model: 'agnes-2.0-flash',
})

function isChatCompletionsEndpoint(endpoint = '') {
  return /^https?:\/\/.+\/chat\/completions\/?$/i.test(String(endpoint).trim())
}

function readStorage() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const endpoint = String(value.endpoint || DEFAULT_CHECK_AGENT_API_CONFIG.endpoint).trim()
    if (!isChatCompletionsEndpoint(endpoint)) return { ...DEFAULT_CHECK_AGENT_API_CONFIG }
    return {
      endpoint,
      apiKey: String(value.apiKey || DEFAULT_CHECK_AGENT_API_CONFIG.apiKey).trim(),
      model: String(value.model || DEFAULT_CHECK_AGENT_API_CONFIG.model).trim(),
    }
  } catch {
    return { ...DEFAULT_CHECK_AGENT_API_CONFIG }
  }
}

export const checkAgentApiConfig = reactive(readStorage())

export function getCheckAgentApiSnapshot() {
  return {
    endpoint: String(checkAgentApiConfig.endpoint || '').trim(),
    apiKey: String(checkAgentApiConfig.apiKey || '').trim(),
    model: String(checkAgentApiConfig.model || '').trim(),
  }
}

export function saveCheckAgentApiConfig() {
  const snapshot = getCheckAgentApiSnapshot()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  return snapshot
}

export function isCheckAgentApiReady() {
  const config = getCheckAgentApiSnapshot()
  return Boolean(config.apiKey && isChatCompletionsEndpoint(config.endpoint) && config.model)
}
