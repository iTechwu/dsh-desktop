const React = require('react')
const { createElement: h, useEffect, useState, useSyncExternalStore } = React
const { IconCloseOutline16, IconEditOutline16, MarkdownText, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')
const NS = 'dofe.yootun-xhs-operation'
const PATH = '/api/desktop/yootun/xhs-operation'
const UPLOAD_PICK = '/_dsh/uploader/pick-file'
const UPLOAD_SEND = '/_dsh/uploader/upload'
const OVERLAY_ID = '@dofe/dsh-yootun-xhs-operation'
const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
const DIALOG_ATTRIBUTES = { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'yxh-title' }
const POLL_INTERVAL_MS = 30000
const MAX_IMAGES = 5

const copy = {
  zh: {
    open: '小红书仿写', title: '小红书仿写', subtitle: '上传素材，生成三套仿写文案',
    close: '关闭', material: '素材区', reference: '对标区', result: '仿写内容区',
    tabImages: '图片', tabVideo: '视频', theme: '主题', themePlaceholder: '可选，图片与视频共用',
    refNote: '对标笔记', refNotePlaceholder: '可选，笔记链接', refAccount: '对标账号', refAccountPlaceholder: '可选，账号名称',
    addImage: '添加图片', remove: '移除', imageHint: '已选 {count} / 5 张', videoLabel: '视频',
    submit: '开始仿写', submitting: '正在仿写…', uploadFailed: '上传失败，请重试',
    empty: '上传素材后点击“开始仿写”，生成三套文案', processing: '正在生成文案', stepLabel: '当前步骤',
    versionA: '版本 A', versionB: '版本 B', versionC: '版本 C',
    failed: '生成失败', failedHint: '已保留你的输入与已上传素材，可修改后重新开始', cancelled: '已取消',
    createFailed: '创建任务失败，请重试', pollFailed: '查询状态失败，稍后重试', resultFailed: '读取结果失败',
    copyCode: '复制', copiedCode: '已复制', footnotes: '脚注', tagsLabel: '标签', coverLabel: '封面文案', leadLabel: '评论引导',
  },
  en: {
    open: 'XHS rewrite', title: 'XHS rewrite', subtitle: 'Upload media to generate three copies',
    close: 'Close', material: 'Media', reference: 'References', result: 'Copies',
    tabImages: 'Images', tabVideo: 'Video', theme: 'Theme', themePlaceholder: 'Optional, shared by images and video',
    refNote: 'Reference note', refNotePlaceholder: 'Optional, note link', refAccount: 'Reference account', refAccountPlaceholder: 'Optional, account name',
    addImage: 'Add image', remove: 'Remove', imageHint: '{count} / 5 selected', videoLabel: 'Video',
    submit: 'Start', submitting: 'Rewriting…', uploadFailed: 'Upload failed, retry',
    empty: 'Upload media then press “Start” to generate three copies', processing: 'Generating copies', stepLabel: 'Current step',
    versionA: 'Version A', versionB: 'Version B', versionC: 'Version C',
    failed: 'Generation failed', failedHint: 'Your input and uploaded media are kept; adjust and retry', cancelled: 'Cancelled',
    createFailed: 'Failed to create the task, retry', pollFailed: 'Failed to query status, retry later', resultFailed: 'Failed to read the result',
    copyCode: 'Copy', copiedCode: 'Copied', footnotes: 'Footnotes', tagsLabel: 'Tags', coverLabel: 'Cover copy', leadLabel: 'Lead',
  },
}

let opened = false
const openListeners = new Set()
const emitOpen = () => openListeners.forEach(listener => listener())
const setOpened = value => { opened = value; emitOpen() }
const subscribeOpen = listener => { openListeners.add(listener); return () => openListeners.delete(listener) }
const snapshotOpen = () => opened

// 同一应用进程内跨开关保留的当前任务（docs/0904/xhs §5.2）：由下方模块级 task machine
// 持有；关闭页面停止轮询但不取消任务，重新打开页面继续查询当前任务。

const openOverlay = () => {
  window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: OVERLAY_ID } }))
  setOpened(true)
  requestAnimationFrame(() => {
    const root = document.querySelector('.yxh-overlay')
    for (const [name, value] of Object.entries(DIALOG_ATTRIBUTES)) root?.setAttribute(name, String(value))
  })
}
const closeOtherOverlay = event => { if (event.detail?.id !== OVERLAY_ID) setOpened(false) }

const isTerminal = status => status === 'succeeded' || status === 'failed' || status === 'cancelled'

async function post(body) {
  const response = await fetch(PATH, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error('xhs operation failed')
  return response.json()
}

async function uploadFetch(path, body) {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) return null
  return response.json()
}

function newIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `xhs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function markdownLabels(t) { return { code: { copyLabel: t('copyCode'), copiedLabel: t('copiedCode') }, footnotes: t('footnotes') } }

// 小红书仿写任务状态机（纯逻辑，无 React/浏览器依赖，可被 test/task-machine.test.mjs 直接驱动）。
// 职责：创建 → 轮询 → 读结果 → 终态；暂态失败按间隔重试；stop 停止轮询不取消任务；resume 恢复。
// 注入 createTask/queryStatus/queryResult/schedule/clearSchedule，便于单测用假定时器与假 fetch。
function createTaskMachine({ createTask, queryStatus, queryResult, intervalMs = POLL_INTERVAL_MS, schedule = setTimeout, clearSchedule = clearTimeout, onChange }) {
  let snapshot = { task: null, versions: null, error: '' }
  let timer = null
  let generation = 0

  const update = next => { snapshot = next; onChange?.(snapshot) }
  const cancel = () => { generation++; if (timer) { clearSchedule(timer); timer = null } }

  const loadResult = async (taskId, gen) => {
    let versions = null
    let error = ''
    try {
      const result = await queryResult(taskId)
      if (result && Array.isArray(result.versions) && result.versions.length === 3) versions = result.versions
      else error = 'resultFailed'
    } catch {
      error = 'resultFailed'
    }
    if (gen !== generation) return
    update({ ...snapshot, versions, error })
  }

  const poll = async () => {
    const gen = generation
    const task = snapshot.task
    if (!task?.taskId) return
    // 已终态：succeeded 补读结果；failed/cancelled 展示失败/取消提示。
    if (isTerminal(task.taskStatus)) {
      if (task.taskStatus === 'succeeded') {
        if (snapshot.versions === null) await loadResult(task.taskId, gen)
      } else {
        update({ ...snapshot, error: task.taskStatus === 'cancelled' ? 'cancelled' : 'failed' })
      }
      return
    }
    try {
      const status = await queryStatus(task.taskId)
      if (gen !== generation) return
      const next = { ...task, taskStatus: status.taskStatus, currentStep: status.currentStep || status.nextStep || '' }
      update({ ...snapshot, task: next, error: '' })
      if (status.taskStatus === 'succeeded') { await loadResult(task.taskId, gen); return }
      if (status.taskStatus === 'failed' || status.taskStatus === 'cancelled') {
        update({ ...snapshot, error: status.taskStatus === 'cancelled' ? 'cancelled' : 'failed' })
        return
      }
      timer = schedule(poll, intervalMs)
    } catch {
      if (gen !== generation) return
      update({ ...snapshot, error: 'pollFailed' })
      timer = schedule(poll, intervalMs)
    }
  }

  const submit = async body => {
    cancel()
    update({ task: snapshot.task, versions: null, error: '' })
    try {
      const created = await createTask(body)
      update({ task: { taskId: created.taskId, idempotencyKey: body.idempotencyKey, taskStatus: created.taskStatus || 'queued', mediaType: body.mediaType, input: body }, versions: null, error: '' })
    } catch {
      update({ ...snapshot, error: 'createFailed' })
      return
    }
    await poll()
  }

  return { submit, resume: poll, stop: cancel, get: () => snapshot }
}

// 状态机错误码 → 本地化文案。
function errorText(error, t) {
  switch (error) {
    case 'pollFailed': return t('pollFailed')
    case 'resultFailed': return t('resultFailed')
    case 'createFailed': return t('createFailed')
    case 'failed': return t('failed')
    case 'cancelled': return t('cancelled')
    default: return ''
  }
}

// 模块级单例：跨 overlay 开关保留任务与轮询进度。
const machineListeners = new Set()
const machine = createTaskMachine({
  createTask: async body => {
    const res = await post(body)
    if (!res || res.status !== 'created' || !res.taskId) throw new Error('create_failed')
    return { taskId: res.taskId, taskStatus: res.taskStatus || 'queued', mediaType: body.mediaType }
  },
  queryStatus: async taskId => {
    const res = await post({ action: 'status', taskId })
    if (!res || res.status !== 'ready') throw new Error('status_failed')
    return { taskStatus: res.taskStatus, currentStep: res.currentStep, nextStep: res.nextStep }
  },
  queryResult: async taskId => {
    const res = await post({ action: 'result', taskId })
    if (!res || res.status !== 'ready') throw new Error('result_failed')
    return { versions: res.versions }
  },
  onChange: () => machineListeners.forEach(listener => listener()),
})
const subscribeMachine = listener => { machineListeners.add(listener); return () => machineListeners.delete(listener) }

function Button({ wide, t }) {
  return h(Tooltip, { label: t('open'), disabled: wide },
    h('button', { type: 'button', className: `yxh-button${wide ? ' yxh-wide' : ''}`, 'aria-label': t('open'), onClick: openOverlay },
      h(IconEditOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null))
}

function TabBar({ tab, onTab, t, disabled }) {
  return h('nav', { className: 'yxh-tabs', 'aria-label': t('material') },
    h('button', { type: 'button', 'aria-current': tab === 'images', disabled, onClick: () => onTab('images') }, t('tabImages')),
    h('button', { type: 'button', 'aria-current': tab === 'video', disabled, onClick: () => onTab('video') }, t('tabVideo')))
}

function Version({ version, index, t }) {
  const labels = markdownLabels(t)
  const heading = [t('versionA'), t('versionB'), t('versionC')][index] || `${t('versionA')} ${index + 1}`
  return h('article', { className: 'yxh-version' },
    h('header', { className: 'yxh-version-head' },
      h('span', { className: 'yxh-version-badge' }, version.version || heading),
      version.title ? h('h3', null, version.title) : null),
    version.body ? h('div', { className: 'yxh-version-body' }, h(MarkdownText, { text: version.body, labels })) : null,
    version.tags && version.tags.length ? h('div', { className: 'yxh-tags', 'aria-label': t('tagsLabel') }, ...version.tags.map(tag => h('span', { className: 'yxh-tag', key: tag }, tag))) : null,
    version.coverCopy ? h('div', { className: 'yxh-extra' }, h('span', { className: 'yxh-extra-label' }, t('coverLabel')), h('div', { className: 'yxh-extra-body' }, h(MarkdownText, { text: version.coverCopy, labels }))) : null,
    version.pages && version.pages.length ? h('ol', { className: 'yxh-pages' }, ...version.pages.map(page => h('li', { key: page.pageIndex }, h('span', { className: 'yxh-page-index' }, String(page.pageIndex + 1)), h('div', { className: 'yxh-page-copy' }, h(MarkdownText, { text: page.copy, labels }))))) : null,
    version.leadGuide ? h('div', { className: 'yxh-extra' }, h('span', { className: 'yxh-extra-label' }, t('leadLabel')), h('div', { className: 'yxh-extra-body' }, h(MarkdownText, { text: version.leadGuide, labels }))) : null)
}

function Overlay({ t }) {
  const visible = useSyncExternalStore(subscribeOpen, snapshotOpen, snapshotOpen)
  const [tab, setTab] = useState('images')
  const [images, setImages] = useState([])
  const [video, setVideo] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [theme, setTheme] = useState('')
  const [refNote, setRefNote] = useState('')
  const [refAccount, setRefAccount] = useState('')
  const machineState = useSyncExternalStore(subscribeMachine, () => machine.get(), () => machine.get())
  const { task, versions, error } = machineState
  const [busy, setBusy] = useState(false)

  const taskStatus = task?.taskStatus || 'idle'
  const processing = Boolean(task?.taskId) && !isTerminal(taskStatus)
  const locked = busy || processing

  useEffect(() => {
    if (!visible) return undefined
    const key = event => { if (event.key === 'Escape') setOpened(false) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [visible])

  // 打开/关闭 overlay：恢复或停止轮询（不取消任务）。
  useEffect(() => {
    if (visible) machine.resume()
    else machine.stop()
  }, [visible])

  const pickAndUpload = async kind => {
    if (uploading || locked) return
    setUploading(true)
    setUploadError('')
    try {
      const picked = await uploadFetch(UPLOAD_PICK, { kind })
      if (!picked || !picked.picked || !picked.path) { setUploading(false); return }
      const uploaded = await uploadFetch(UPLOAD_SEND, { path: picked.path })
      if (!uploaded || !uploaded.url) { setUploadError(t('uploadFailed')); setUploading(false); return }
      if (kind === 'image') {
        setImages(prev => (prev.length >= MAX_IMAGES ? prev : [...prev, { url: uploaded.url, name: uploaded.name, size: uploaded.size }]))
      } else {
        setVideo({ url: uploaded.url, name: uploaded.name, size: uploaded.size })
      }
    } catch {
      setUploadError(t('uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const onSubmit = async () => {
    if (busy || uploading || processing) return
    const hasMaterial = tab === 'images' ? images.length > 0 : video !== null
    if (!hasMaterial) return
    const mediaType = tab
    const input = { mediaType, theme: theme.trim(), refNote: refNote.trim(), refAccount: refAccount.trim(), imageUrls: tab === 'images' ? images.map(item => item.url) : null, videoUrl: tab === 'video' ? video.url : null }
    const idempotencyKey = newIdempotencyKey()
    const references = input.refNote ? [{ source: 'manual', url: input.refNote }] : []
    const accounts = input.refAccount ? [{ name: input.refAccount }] : []
    const body = { action: 'create', mediaType, idempotencyKey, theme: input.theme || null, references, accounts, versionCount: 3 }
    if (mediaType === 'images') { body.imageUrls = input.imageUrls; body.coverIndex = 0 }
    else { body.videoUrl = input.videoUrl }
    setBusy(true)
    await machine.submit(body)
    setBusy(false)
  }

  if (!visible) return null

  const taskErrorText = errorText(error, t)
  const labels = markdownLabels(t)
  const hasMaterial = tab === 'images' ? images.length > 0 : video !== null
  const buttonDisabled = busy || uploading || processing || !hasMaterial
  const buttonLabel = busy || processing ? t('submitting') : t('submit')

  const left = h('div', { className: 'yxh-left' },
    h('section', { className: 'yxh-section' },
      h('h2', null, t('material')),
      h(TabBar, { tab, onTab: setTab, t, disabled: locked }),
      tab === 'images'
        ? h('div', { className: 'yxh-media' },
          images.map((image, index) => h('figure', { className: 'yxh-thumb', key: `${index}-${image.name}` },
            h('img', { src: image.url, alt: image.name }),
            h('button', { type: 'button', className: 'yxh-thumb-remove', 'aria-label': t('remove'), disabled: locked, onClick: () => setImages(prev => prev.filter((_, i) => i !== index)) }, '×'))),
          images.length < MAX_IMAGES
            ? h('button', { type: 'button', className: 'yxh-add', 'aria-label': t('addImage'), disabled: uploading || locked, onClick: () => pickAndUpload('image') }, uploading ? '…' : '+')
            : null)
        : h('div', { className: 'yxh-media' },
          video
            ? h('div', { className: 'yxh-video' },
              h('span', { className: 'yxh-video-name' }, video.name),
              video.size ? h('span', { className: 'yxh-video-meta' }, formatBytes(video.size)) : null,
              h('button', { type: 'button', className: 'yxh-thumb-remove', 'aria-label': t('remove'), disabled: locked, onClick: () => setVideo(null) }, '×'))
            : h('button', { type: 'button', className: 'yxh-add', 'aria-label': t('videoLabel'), disabled: uploading || locked, onClick: () => pickAndUpload('video') }, uploading ? '…' : '+')),
      h('div', { className: 'yxh-hint' }, tab === 'images' ? t('imageHint').replace('{count}', String(images.length)) : null),
      uploadError ? h('p', { className: 'yxh-error', role: 'alert' }, uploadError) : null,
      h('label', { className: 'yxh-field' },
        h('span', null, t('theme')),
        h('input', { type: 'text', value: theme, maxLength: 500, placeholder: t('themePlaceholder'), disabled: locked, onChange: event => setTheme(event.target.value) }))),
    h('section', { className: 'yxh-section' },
      h('h2', null, t('reference')),
      h('label', { className: 'yxh-field' },
        h('span', null, t('refNote')),
        h('input', { type: 'text', value: refNote, maxLength: 2048, placeholder: t('refNotePlaceholder'), disabled: locked, onChange: event => setRefNote(event.target.value) })),
      h('label', { className: 'yxh-field' },
        h('span', null, t('refAccount')),
        h('input', { type: 'text', value: refAccount, maxLength: 200, placeholder: t('refAccountPlaceholder'), disabled: locked, onChange: event => setRefAccount(event.target.value) }))),
    h('div', { className: 'yxh-actions' },
      h('button', { type: 'button', className: 'yxh-submit', disabled: buttonDisabled, onClick: onSubmit }, buttonLabel)))

  let right
  if (taskStatus === 'succeeded' && Array.isArray(versions)) {
    right = h('div', { className: 'yxh-versions' }, versions.map((version, index) => h(Version, { key: version.version || index, version, index, t })))
  } else if (taskErrorText) {
    right = h('div', { className: 'yxh-state yxh-state-error', role: 'alert' },
      h('p', null, taskErrorText),
      h('p', { className: 'yxh-hint' }, t('failedHint')))
  } else if (processing || taskStatus === 'succeeded') {
    right = h('div', { className: 'yxh-state', role: 'status' },
      h('span', { className: 'yxh-spinner' }),
      h('p', null, t('processing')),
      task?.currentStep ? h('p', { className: 'yxh-step' }, `${t('stepLabel')} · ${task.currentStep}`) : null)
  } else {
    right = h('div', { className: 'yxh-state' }, h('p', null, t('empty')))
  }

  return h('div', { className: 'yxh-overlay' },
    h('main', { className: 'yxh-shell', 'aria-labelledby': 'yxh-title' },
      h('header', { className: 'yxh-header' },
        h('div', null, h('h1', { id: 'yxh-title' }, t('title')), h('p', null, t('subtitle'))),
        h('div', { className: 'yxh-header-buttons' },
          h(Tooltip, { label: t('close') }, h('button', { type: 'button', 'aria-label': t('close'), onClick: () => setOpened(false) }, h(IconCloseOutline16, { size: 16 }))))),
      h('div', { className: 'yxh-body' },
        left,
        h('div', { className: 'yxh-right', 'aria-label': t('result') }, right))))
}

function formatBytes(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return ''
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / 1024 / 1024).toFixed(1)} MB`
}

const css = `.yxh-button{display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.yxh-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yxh-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yxh-wide span{font-size:13px}.yxh-overlay{position:fixed;inset:0;z-index:520;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yxh-shell{display:grid;grid-template-rows:auto 1fr;width:100%;height:100%;overflow:hidden}.yxh-header{display:flex;min-height:74px;align-items:center;justify-content:space-between;padding:14px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yxh-header h1{margin:0;font-size:20px}.yxh-header p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yxh-header-buttons{display:flex;gap:6px}.yxh-header-buttons button{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.yxh-body{display:grid;grid-template-columns:minmax(360px,.85fr) minmax(480px,1.15fr);max-width:1440px;margin:0 auto;width:100%;min-height:0;overflow:hidden}.yxh-left{overflow:auto;padding:20px 24px 32px;border-right:1px solid var(--dsw-alias-border-l1)}.yxh-right{overflow:auto;padding:20px 24px 32px}.yxh-section{display:grid;gap:12px}.yxh-section+.yxh-section{margin-top:22px}.yxh-section h2{margin:0;font-size:14px}.yxh-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yxh-tabs button{height:40px;padding:0 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}.yxh-tabs button[aria-current]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:650}.yxh-tabs button:disabled{opacity:.45;cursor:default}.yxh-media{display:flex;flex-wrap:wrap;gap:10px}.yxh-thumb{position:relative;margin:0;width:96px;height:96px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}.yxh-thumb img{width:100%;height:100%;object-fit:cover}.yxh-thumb-remove{position:absolute;top:4px;right:4px;display:grid;width:20px;height:20px;place-items:center;border:0;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 82%,transparent);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1;cursor:pointer}.yxh-thumb-remove:disabled{opacity:.45;cursor:default}.yxh-add{display:grid;width:96px;height:96px;place-items:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:26px;cursor:pointer}.yxh-add:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.yxh-add:disabled{opacity:.45;cursor:default}.yxh-video{position:relative;display:flex;min-width:220px;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}.yxh-video-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.yxh-video-meta{color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-hint{color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-error{color:var(--dsw-alias-state-error-primary);font-size:12px}.yxh-field{display:grid;gap:6px}.yxh-field span{color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-field input{min-height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:13px}.yxh-field input:disabled{opacity:.6}.yxh-actions{margin-top:22px}.yxh-submit{min-height:38px;padding:0 16px;border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:13px;font-weight:600;cursor:pointer}.yxh-submit:disabled{opacity:.45;cursor:default}.yxh-versions{display:grid;gap:16px}.yxh-version{padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yxh-version-head{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}.yxh-version-badge{flex:none;padding:2px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-version-head h3{margin:0;font-size:15px}.yxh-version-body{font-size:13px}.yxh-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.yxh-tag{padding:2px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-extra{display:grid;gap:2px;margin-top:10px}.yxh-extra-label{color:var(--dsw-alias-label-tertiary);font-size:11px}.yxh-extra-body{font-size:13px}.yxh-page-copy{font-size:13px}.yxh-pages{margin:10px 0 0;padding-left:20px;display:grid;gap:4px}.yxh-pages li{font-size:13px}.yxh-page-index{margin-right:8px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}.yxh-state{display:grid;min-height:160px;place-items:center;align-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}.yxh-state p{margin:0}.yxh-step{color:var(--dsw-alias-label-tertiary);font-size:12px}.yxh-state-error p:first-child{color:var(--dsw-alias-state-error-primary)}.yxh-spinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:yxh-spin .8s linear infinite}@keyframes yxh-spin{to{transform:rotate(360deg)}}@media(max-width:900px){.yxh-header,.yxh-left,.yxh-right{padding-left:16px;padding-right:16px}.yxh-body{grid-template-columns:1fr;overflow:auto}.yxh-left{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.yxh-right{min-height:320px}}`

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-xhs-operation: dictionaries')
  ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay) }, 'dofe-yootun-xhs-operation: exclusive-overlay')
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-xhs-operation'; style.textContent = css; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-xhs-operation: styles')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-xhs-operation', order: 41, inject: () => ({ t }) }, Button))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-xhs-operation', order: 41, inject: () => ({ t }) }, Overlay))
}
module.exports = { apply, inject: ['slots', 'locale'], createTaskMachine }
