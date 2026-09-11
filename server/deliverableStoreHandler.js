/* 教学视频素材参数产物实体文件存档 — public/deliverable/ 下是唯一真实来源
   每次生成独立文件，带时间戳：deliverable-YYYYMMDD-HHMMSS-SSS.json
   文件名 = 项目编码，全链路用同一个编码识别
   current 指针文件记录当前活跃的产物数据
   支持刷新不丢失、支持历史产物回溯 */

import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { isOptions, readJsonBody, sendJson } from './http.js'
import { renderDeliverableHtml } from './renderDeliverableHtml.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const PUBLIC_DIR = resolve(projectRoot, 'public')
const DELIVERABLE_DIR = resolve(PUBLIC_DIR, 'deliverable')
const CURRENT_POINTER = resolve(DELIVERABLE_DIR, 'current.json')

function ensureDeliverableDir() {
  if (!existsSync(DELIVERABLE_DIR)) {
    mkdirSync(DELIVERABLE_DIR, { recursive: true })
  }
}

function pad(n, width = 2) { return String(n).padStart(width, '0') }

// 生成项目编码（毫秒级时间戳）
export function genProjectCode() {
  const d = new Date()
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`
}

function deliverableFilename(projectCode) {
  return `deliverable-${projectCode}.json`
}

function deliverableHtmlFilename(projectCode) {
  return `deliverable-${projectCode}.html`
}

export function fullPath(filename) {
  return resolve(DELIVERABLE_DIR, filename)
}

// 自动为已有但在早期未生成 HTML 的历史 JSON 补齐 companion HTML 文件
export function syncExistingDeliverableHtmls(force = false) {
  ensureDeliverableDir()
  try {
    const jsonFiles = readdirSync(DELIVERABLE_DIR).filter(f => /^deliverable-\d{8}-\d{6}-\d{3}\.json$/.test(f))
    for (const jf of jsonFiles) {
      const code = jf.replace(/^deliverable-/, '').replace(/\.json$/, '')
      const htmlFile = deliverableHtmlFilename(code)
      const htmlPath = fullPath(htmlFile)
      if (force || !existsSync(htmlPath)) {
        try {
          const raw = readFileSync(fullPath(jf), 'utf-8')
          const data = JSON.parse(raw)
          const htmlContent = renderDeliverableHtml({ ...data, projectCode: code })
          writeFileSync(htmlPath, htmlContent, 'utf-8')
        } catch {}
      }
    }
    // 同步 current.html
    const currentPath = resolve(DELIVERABLE_DIR, 'current.html')
    if ((force || !existsSync(currentPath)) && existsSync(CURRENT_POINTER)) {
      try {
        const cur = JSON.parse(readFileSync(CURRENT_POINTER, 'utf-8'))
        if (cur?.deliverable) {
          writeFileSync(currentPath, renderDeliverableHtml(cur.deliverable), 'utf-8')
        }
      } catch {}
    }
  } catch {}
}

export function readDeliverableByCode(codeOrFilename) {
  ensureDeliverableDir()
  if (!codeOrFilename) return null
  let filename = codeOrFilename
  if (!filename.endsWith('.json')) {
    filename = deliverableFilename(codeOrFilename)
  }
  const filePath = fullPath(filename)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function readCurrentDeliverable() {
  ensureDeliverableDir()
  let filename = null
  let projectCode = null
  let createdAt = null
  let deliverable = null

  if (existsSync(CURRENT_POINTER)) {
    try {
      const pointer = JSON.parse(readFileSync(CURRENT_POINTER, 'utf-8'))
      if (pointer?.filename && existsSync(fullPath(pointer.filename))) {
        filename = pointer.filename
        projectCode = pointer.projectCode || null
        createdAt = pointer.createdAt || null
      }
    } catch {
      // 指针损坏，继续向下走 fallback
    }
  }

  // 指针文件不存在或失效：自动扫描最新的 deliverable 文件
  if (!filename) {
    const files = listDeliverableFiles()
    if (files.length > 0) {
      filename = files[0]
      const match = filename.match(/^deliverable-(\d{8}-\d{6}-\d{3})\.json$/)
      projectCode = match ? match[1] : null
      createdAt = new Date().toISOString()
    }
  }

  if (!filename) return null
  const filePath = fullPath(filename)
  if (!existsSync(filePath)) return null

  try {
    deliverable = JSON.parse(readFileSync(filePath, 'utf-8'))
    return {
      filename,
      projectCode: projectCode || deliverable?.projectCode || null,
      createdAt: createdAt || deliverable?.createdAt || null,
      deliverable,
    }
  } catch {
    return null
  }
}

export function writeDeliverableFile(data) {
  ensureDeliverableDir()
  const projectCode = data.projectCode || genProjectCode()
  const jsonFilename = deliverableFilename(projectCode)
  const htmlFilename = deliverableHtmlFilename(projectCode)
  const jsonFilePath = fullPath(jsonFilename)
  const htmlFilePath = fullPath(htmlFilename)

  const payload = {
    ...data,
    projectCode,
    filename: jsonFilename,
    htmlFilename,
    createdAt: data.createdAt || new Date().toISOString(),
  }

  // 1. 写入配套实体 JSON 归档文件
  writeFileSync(jsonFilePath, JSON.stringify(payload, null, 2), 'utf-8')

  // 2. 写入同名落地实体 HTML 交付单页文件（夏夏核心需求：与 JSON 配对的一批归档物）
  const htmlContent = renderDeliverableHtml(payload)
  writeFileSync(htmlFilePath, htmlContent, 'utf-8')

  // 3. 更新 current 指针文件 (JSON 与 HTML)
  const pointer = {
    projectCode,
    filename: jsonFilename,
    htmlFilename,
    createdAt: payload.createdAt,
    deliverable: payload,
  }
  writeFileSync(CURRENT_POINTER, JSON.stringify(pointer, null, 2), 'utf-8')
  writeFileSync(resolve(DELIVERABLE_DIR, 'current.html'), htmlContent, 'utf-8')

  return {
    projectCode,
    filename: jsonFilename,
    htmlFilename,
    url: `/deliverable/${htmlFilename}`,
    deliverable: payload,
  }
}

export function listDeliverableFiles() {
  if (!existsSync(DELIVERABLE_DIR)) return []
  const files = readdirSync(DELIVERABLE_DIR)
    .filter(f => /^deliverable-\d{8}-\d{6}-\d{3}\.json$/.test(f))
    .sort()
    .reverse()
  return files
}

export async function handleDeliverableRequest(req, res) {
  if (isOptions(req, res)) return true
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname

  // GET /api/deliverable — 读取当前产物（或指定 ?id= 或 ?file=）
  if (req.method === 'GET' && (path === '/' || path === '')) {
    const id = url.searchParams.get('id')
    const file = url.searchParams.get('file')

    if (id || file) {
      const data = readDeliverableByCode(file || id)
      if (data) {
        return sendJson(req, res, 200, {
          ok: true,
          projectCode: data.projectCode || id || null,
          filename: data.filename || file || null,
          createdAt: data.createdAt || null,
          deliverable: data,
        })
      }
    }

    const current = readCurrentDeliverable()
    return sendJson(req, res, 200, {
      ok: true,
      projectCode: current?.projectCode || null,
      filename: current?.filename || null,
      createdAt: current?.createdAt || null,
      deliverable: current?.deliverable || null,
    })
  }

  // GET /api/deliverable/list — 列出历史产物文件
  if (req.method === 'GET' && path === '/list') {
    return sendJson(req, res, 200, {
      ok: true,
      files: listDeliverableFiles(),
      current: readCurrentDeliverable()?.filename || null,
    })
  }

  // POST /api/deliverable/update-sync — 更新时序同步与音频参数
  if (req.method === 'POST' && path === '/update-sync') {
    try {
      const body = await readJsonBody(req)
      const projectCode = body.projectCode || body.deliverable?.projectCode
      const rows = body.rows || body.deliverable?.rows
      if (!projectCode || !Array.isArray(rows)) {
        return sendJson(req, res, 400, { ok: false, error: '缺少 projectCode 或 rows' })
      }
      let currentData = readDeliverableByCode(projectCode)
      if (!currentData) {
        const cur = readCurrentDeliverable()
        if (cur?.projectCode === projectCode) {
          currentData = cur.deliverable
        }
      }
      if (!currentData) {
        return sendJson(req, res, 404, { ok: false, error: '未找到对应产物: ' + projectCode })
      }
      const updated = {
        ...currentData,
        rows,
        updatedAt: new Date().toISOString(),
      }
      const { filename, htmlFilename, url, deliverable: saved } = writeDeliverableFile(updated)
      return sendJson(req, res, 200, {
        ok: true,
        projectCode,
        filename,
        htmlFilename,
        url: url || `/deliverable/${htmlFilename}`,
        deliverable: saved,
      })
    } catch (error) {
      return sendJson(req, res, 500, { ok: false, error: error?.message || String(error) })
    }
  }

  // POST /api/deliverable — 保存产物生成新文件
  if (req.method === 'POST' && (path === '/' || path === '')) {
    try {
      const body = await readJsonBody(req)
      const deliverable = body.deliverable || body
      if (!deliverable || typeof deliverable !== 'object') {
        return sendJson(req, res, 400, { ok: false, error: '缺少 deliverable 参数' })
      }
      const { projectCode, filename, htmlFilename, url, deliverable: saved } = writeDeliverableFile(deliverable)
      return sendJson(req, res, 200, {
        ok: true,
        projectCode,
        filename,
        htmlFilename,
        url: url || `/deliverable/${htmlFilename}`,
        deliverable: saved,
      })
    } catch (error) {
      return sendJson(req, res, 500, { ok: false, error: error?.message || String(error) })
    }
  }

  return false
}

export function deliverableStorePlugin() {
  return {
    name: 'deliverable-store-proxy',
    configureServer(server) {
      // 启动时同步并补齐历史交付物的 companion HTML 文件
      try {
        syncExistingDeliverableHtmls()
      } catch (e) {
        console.warn('[deliverable-store] sync existing html warning:', e)
      }

      server.middlewares.use('/api/deliverable', (req, res, next) => {
        Promise.resolve(handleDeliverableRequest(req, res)).then((handled) => {
          if (!handled) next()
        }).catch(next)
      })
    },
  }
}
