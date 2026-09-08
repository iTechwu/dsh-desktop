const React = require('react')
const { createElement: h, useEffect, useRef, useState, useSyncExternalStore } = React
const { IconCloseOutline16, IconEditOutline16, MarkdownText, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')
const NS = 'dofe.yootun-xhs-operation'
const PATH = '/api/desktop/yootun/xhs-operation'
const UPLOAD_PICK = '/_dsh/uploader/pick-file'
const UPLOAD_START = '/_dsh/uploader/uploadStart'
const UPLOAD_STATUS = '/_dsh/uploader/uploadStatus'
const MEDIA_PATH = '/_dsh/uploader/media'
const OVERLAY_ID = '@dofe/dsh-yootun-xhs-operation'
const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
const DIALOG_ATTRIBUTES = { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'yxh-title' }
const POLL_INTERVAL_MS = 15000
const UPLOAD_POLL_INTERVAL_MS = 350
const MAX_IMAGES = 5

const copy = {
  zh: {
    open: '小红书仿写', title: '小红书仿写', subtitle: '上传图片或者视频素材，根据提供的对标笔记或者账号风格，生成爆款小红书文案',
    close: '关闭', material: '素材区', reference: '对标区', result: '仿写内容区',
    tabImages: '图片', tabVideo: '视频', theme: '主题', themePlaceholder: '可选，图片与视频共用',
    refNote: '对标笔记', refNotePlaceholder: '可选，笔记链接', refAccount: '对标账号', refAccountPlaceholder: '可选，账号名称',
    addImage: '添加图片', remove: '移除', imageHint: '已选 {count} / 5 张', videoLabel: '视频', videoBadge: '视频',
    submit: '开始仿写', submitting: '正在仿写…', uploadFailed: '上传失败，请重试',
    uploadingBlock: '当前照片/视频正在上传中，等待上传完成', retrying: '重试中', uploadedBytes: '已传 {written} / {total}',
    empty: '上传素材后点击“开始仿写”，生成三套文案', processing: '正在生成文案', stepLabel: '当前步骤',
    versionA: '版本 A', versionB: '版本 B', versionC: '版本 C',
    failed: '生成失败', failedHint: '已保留你的输入与已上传素材，可修改后重新开始', cancelled: '已取消',
    cancelTask: '取消任务', cancelConfirm: '确认取消当前任务？', confirmYes: '是', confirmNo: '否', cancelFailed: '取消失败，请重试',
    createFailed: '创建任务失败，请重试', pollFailed: '查询状态失败，稍后重试', resultFailed: '读取结果失败',
    copyCode: '复制', copiedCode: '已复制', footnotes: '脚注', tagsLabel: '标签', coverLabel: '封面文案', leadLabel: '评论引导',
  },
  en: {
    open: 'XHS rewrite', title: 'XHS rewrite', subtitle: 'Upload image or video media to create viral XHS copy from reference notes or account style',
    close: 'Close', material: 'Media', reference: 'References', result: 'Copies',
    tabImages: 'Images', tabVideo: 'Video', theme: 'Theme', themePlaceholder: 'Optional, shared by images and video',
    refNote: 'Reference note', refNotePlaceholder: 'Optional, note link', refAccount: 'Reference account', refAccountPlaceholder: 'Optional, account name',
    addImage: 'Add image', remove: 'Remove', imageHint: '{count} / 5 selected', videoLabel: 'Video', videoBadge: 'Video',
    submit: 'Start', submitting: 'Rewriting…', uploadFailed: 'Upload failed, retry',
    uploadingBlock: 'Uploading in progress — wait for the current photo/video to finish uploading.', retrying: 'Retrying', uploadedBytes: '{written} / {total} sent',
    empty: 'Upload media then press “Start” to generate three copies', processing: 'Generating copies', stepLabel: 'Current step',
    versionA: 'Version A', versionB: 'Version B', versionC: 'Version C',
    failed: 'Generation failed', failedHint: 'Your input and uploaded media are kept; adjust and retry', cancelled: 'Cancelled',
    cancelTask: 'Cancel', cancelConfirm: 'Cancel the current task?', confirmYes: 'Yes', confirmNo: 'No', cancelFailed: 'Cancel failed, retry',
    createFailed: 'Failed to create the task, retry', pollFailed: 'Failed to query status, retry later', resultFailed: 'Failed to read the result',
    copyCode: 'Copy', copiedCode: 'Copied', footnotes: 'Footnotes', tagsLabel: 'Tags', coverLabel: 'Cover copy', leadLabel: 'Lead',
  },
}

let opened = false
let lastTrigger = null
const openListeners = new Set()
const emitOpen = () => openListeners.forEach(listener => listener())
const setOpened = value => { opened = value; emitOpen() }
const subscribeOpen = listener => { openListeners.add(listener); return () => openListeners.delete(listener) }
const snapshotOpen = () => opened

// 同一应用进程内跨开关保留的当前任务（docs/0904/xhs §5.2）：由下方模块级 task machine
// 持有；关闭页面停止轮询但不取消任务，重新打开页面继续查询当前任务。

const openOverlay = event => {
  lastTrigger = event?.currentTarget || document.activeElement
  window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: OVERLAY_ID } }))
  setOpened(true)
  requestAnimationFrame(() => {
    const root = document.querySelector('.yxh-overlay')
    for (const [name, value] of Object.entries(DIALOG_ATTRIBUTES)) root?.setAttribute(name, String(value))
  })
}
const closeOverlay = () => { setOpened(false); requestAnimationFrame(() => lastTrigger?.focus?.()) }
const closeOtherOverlay = event => { if (event.detail?.id !== OVERLAY_ID) setOpened(false) }

const isTerminal = status => status === 'succeeded' || status === 'failed' || status === 'cancelled'

async function post(body) {
  const response = await fetch(PATH, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error('xhs operation failed')
  return response.json()
}

async function uploadFetch(path, body) {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) return null
  return response.json()
}

// 宿主本地媒体路由 URL：webview 无法直读 file:// 路径，预览必须由宿主受守卫路由供流。
function mediaUrl(path) {
  return `${MEDIA_PATH}?path=${encodeURIComponent(path)}`
}

function newIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `xhs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function markdownLabels(t) { return { code: { copyLabel: t('copyCode'), copiedLabel: t('copiedCode') }, footnotes: t('footnotes') } }

// 小红书仿写任务状态机（纯逻辑，无 React/浏览器依赖，可被 test/task-machine.test.mjs 直接驱动）。
// 职责：创建 → 轮询 → 读结果 → 终态；暂态失败按间隔重试；stop 停止轮询不取消任务；resume 恢复。
// 注入 createTask/queryStatus/queryResult/schedule/clearSchedule，便于单测用假定时器与假 fetch。
function createTaskMachine({ createTask, queryStatus, queryResult, cancelTask, intervalMs = POLL_INTERVAL_MS, schedule = setTimeout, clearSchedule = clearTimeout, onChange }) {
  let snapshot = { task: null, versions: null, error: '' }
  let timer = null
  let generation = 0
  let submission = 0
  let active = true

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
    const submissionId = ++submission
    cancel()
    update({ task: snapshot.task, versions: null, error: '' })
    let created
    try {
      created = await createTask(body)
    } catch {
      if (submissionId === submission) update({ ...snapshot, error: 'createFailed' })
      return
    }
    if (submissionId !== submission) return
    // 创建期间允许页面开关：始终保存最新任务，只有页面当前激活时才开始轮询。
    update({ task: { taskId: created.taskId, idempotencyKey: body.idempotencyKey, taskStatus: created.taskStatus || 'queued', mediaType: body.mediaType, input: body }, versions: null, error: '' })
    if (!active) return
    await poll()
  }

  const resume = async () => { active = true; await poll() }
  const stop = () => { active = false; cancel() }

  // 取消当前任务：先停止轮询，再调取消接口；成功后本地置终态 cancelled。
  // 服务端取消是“请求取消”，真正落 cancelled 由 Driver 推进；前端成功后即停止轮询避免空转。
  const requestCancel = async () => {
    const task = snapshot.task
    if (!task?.taskId || isTerminal(task.taskStatus)) return
    cancel()
    const gen = generation
    if (!cancelTask) { update({ ...snapshot, task: { ...task, taskStatus: 'cancelled' }, error: 'cancelled' }); return }
    try {
      await cancelTask(task.taskId, task.idempotencyKey)
    } catch {
      if (gen !== generation) return
      update({ ...snapshot, error: 'cancelFailed' })
      if (active) timer = schedule(poll, intervalMs)
      return
    }
    if (gen !== generation) return
    update({ ...snapshot, task: { ...task, taskStatus: 'cancelled' }, error: 'cancelled' })
  }

  return { submit, resume, stop, requestCancel, get: () => snapshot }
}

// 素材上传状态机（纯逻辑，无 React/浏览器依赖，可被 test/upload-machine.test.mjs 直接驱动）。
// 职责（docs/0907/xhs）：per-asset 管理「已选即预览 + 进度轮询 + 终态」；
// - start()：登记 uploading 素材（本地预览 URL）→ uploadStart → ~350ms 轮询 uploadStatus；
// - done → uploaded（保留本地预览，写入 CDN url）；failed → failed + error；
// - not_found → 仅当「从未收到过 done」才置 failed（P2 客户端兜底）；
// - remove()/stopAll() 停止对应轮询；resume() 重开面板时恢复 uploading 素材的轮询；
// - hasUploading(kind) 供「开始仿写」拦截本次提交素材组（不跨 tab 拦截）。
// 注入 startUpload/pollStatus/schedule/clearSchedule 便于单测用假定时器与假 fetch。
function createUploadManager({ startUpload, pollStatus, intervalMs = UPLOAD_POLL_INTERVAL_MS, maxPollErrors = 10, schedule = setTimeout, clearSchedule = clearTimeout, onChange, idFactory } = {}) {
  /** @type {Map<string, object>} assetId -> 素材对象 */
  const assets = new Map()
  /** @type {Map<string, *>} assetId -> 轮询定时器 */
  const timers = new Map()
  // 面板关闭（stopAll）后置位：挡住 in-flight 轮询回调把轮询「复活」。
  let suspended = false
  let seq = 0
  const nextId = () => {
    if (typeof idFactory === 'function') return idFactory()
    seq += 1
    return `asset-${seq}-${Math.random().toString(36).slice(2, 8)}`
  }

  const emit = () => onChange?.()
  const get = id => assets.get(id) ?? null
  const list = kind => [...assets.values()].filter(asset => asset.kind === kind)
  const hasUploading = kind => list(kind).some(asset => asset.status === 'uploading')

  function schedulePoll(id, uploadId) {
    if (suspended) return
    const timer = schedule(async () => {
      timers.delete(id)
      const asset = assets.get(id)
      // 已移除/覆盖/终结/换 uploadId：停止本轮轮询。
      if (!asset || asset.uploadId !== uploadId || asset.status !== 'uploading') return
      let status = null
      try {
        status = await pollStatus({ uploadId })
      } catch {
        status = null
      }
      // 面板在请求在途期间被关闭：丢弃本次结果，resume 后会重新轮询取回终态。
      if (suspended) return
      const current = assets.get(id)
      if (!current || current.uploadId !== uploadId || current.status !== 'uploading') return
      if (!status) {
        // 传输层/HTTP 层失败：可能为暂态，连续超限才置 failed，避免永久空转。
        current.pollErrors = (current.pollErrors ?? 0) + 1
        if (current.pollErrors > maxPollErrors) {
          current.status = 'failed'
          current.error = 'uploadFailed'
          emit()
          return
        }
        emit()
        schedulePoll(id, uploadId)
        return
      }
      current.pollErrors = 0
      if (status.status === 'uploading') {
        current.attempt = Number.isFinite(status.attempt) ? status.attempt : 0
        current.bytesWritten = status.bytesWritten ?? 0
        current.bytesTotal = status.bytesTotal ?? current.size ?? 0
        current.progress = Number.isFinite(status.progress) ? status.progress : 0
        emit()
        schedulePoll(id, uploadId)
        return
      }
      if (status.status === 'done') {
        current.status = 'uploaded'
        current.url = typeof status.url === 'string' ? status.url : null
        current.receivedDone = true
        current.progress = 100
        emit()
        return
      }
      if (status.status === 'failed') {
        current.status = 'failed'
        current.error = 'uploadFailed'
        emit()
        return
      }
      // not_found：仅当从未收到过 done 才置 failed；此前收到过 done 则忽略（P2）。
      if (!current.receivedDone) {
        current.status = 'failed'
        current.error = 'uploadFailed'
        emit()
      }
    }, intervalMs)
    timers.set(id, timer)
  }

  async function start({ kind, path, name, size, mime }) {
    const id = nextId()
    const asset = {
      id,
      kind,
      path,
      name: name ?? '',
      size: size ?? 0,
      mime: mime ?? '',
      status: 'uploading',
      attempt: 0,
      progress: 0,
      bytesWritten: 0,
      bytesTotal: size ?? 0,
      url: null,
      error: '',
      receivedDone: false,
      pollErrors: 0,
      uploadId: null,
      localPreviewUrl: mediaUrl(path),
    }
    assets.set(id, asset)
    emit()
    let started
    try {
      started = await startUpload({ path, kind })
    } catch {
      // 启动请求网络层/解析层异常：与返回 null 同归一置 failed（与 schedulePoll 对
      // pollStatus 的兜底一致），避免素材停在 uploading 却无轮询、异常向上冒泡。
      const failed = assets.get(id)
      if (failed) {
        failed.status = 'failed'
        failed.error = 'uploadFailed'
        emit()
      }
      return asset
    }
    const current = assets.get(id)
    if (!current) return asset
    if (!started || !started.uploadId) {
      // uploadStart 快速失败（校验/授权/未登记）：素材置 failed，可移除重选。
      current.status = 'failed'
      current.error = 'uploadFailed'
      emit()
      return asset
    }
    current.uploadId = started.uploadId
    current.name = started.name || current.name
    current.size = started.size ?? current.size
    current.bytesTotal = current.size
    emit()
    schedulePoll(id, started.uploadId)
    return asset
  }

  function remove(id) {
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearSchedule(timer)
      timers.delete(id)
    }
    if (assets.delete(id)) emit()
  }

  /** 关闭面板：停止全部轮询（宿主侧上传继续，重开面板 resume 可追上进度）。 */
  function stopAll() {
    suspended = true
    for (const timer of timers.values()) clearSchedule(timer)
    timers.clear()
  }

  /** 重开面板：为仍在 uploading 且已有 uploadId 的素材恢复轮询。 */
  function resume() {
    suspended = false
    for (const asset of assets.values()) {
      if (asset.status === 'uploading' && asset.uploadId && !timers.has(asset.id)) {
        schedulePoll(asset.id, asset.uploadId)
      }
    }
  }

  return { start, remove, stopAll, resume, get, list, hasUploading, get size() { return assets.size } }
}

// 状态机错误码 → 本地化文案。
function errorText(error, t) {
  switch (error) {
    case 'pollFailed': return t('pollFailed')
    case 'resultFailed': return t('resultFailed')
    case 'createFailed': return t('createFailed')
    case 'failed': return t('failed')
    case 'cancelled': return t('cancelled')
    case 'cancelFailed': return t('cancelFailed')
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
  cancelTask: async (taskId, idempotencyKey) => {
    const res = await post({ action: 'cancel', taskId, idempotencyKey })
    if (!res || res.status !== 'ready') throw new Error('cancel_failed')
    return res
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

// 素材缩略图（图片 & 视频统一）：104×104 本地预览 + 覆盖式进度条 + 右上角移除。
// 图片直接 <img> 本地媒体路由；视频 <video> 定格首帧（#t=0.1），预览失败回退「文件名 + 大小」。
function MediaThumb({ asset, t, locked, broken, onPreviewError, onRemove }) {
  const isVideo = asset.kind === 'video'
  const uploading = asset.status === 'uploading'
  const failed = asset.status === 'failed'
  // 预览加载失败（文件被移除/编码不支持）：回退「文件名 + 大小」占位。
  const showFallback = Boolean(broken)
  const uploadedBytesLabel = uploading && asset.bytesTotal > 0
    ? t('uploadedBytes').replace('{written}', formatBytes(asset.bytesWritten) || '0 B').replace('{total}', formatBytes(asset.bytesTotal) || '')
    : ''
  return h('figure', { className: 'yxh-thumb' },
    showFallback
      ? h('div', { className: 'yxh-preview-fallback' },
        h('span', { className: 'yxh-video-name' }, asset.name),
        asset.size ? h('span', { className: 'yxh-video-meta' }, formatBytes(asset.size)) : null)
      : isVideo
        ? h('video', { src: `${asset.localPreviewUrl}#t=0.1`, preload: 'metadata', muted: true, playsInline: true, onError: onPreviewError })
        : h('img', { src: asset.localPreviewUrl, alt: asset.name, onError: onPreviewError }),
    isVideo && !showFallback ? h('span', { className: 'yxh-video-badge' }, t('videoBadge')) : null,
    failed ? h('div', { className: 'yxh-thumb-error', role: 'alert' }, t('uploadFailed')) : null,
    uploading
      ? h('div', { className: 'yxh-progress' },
        h('span', { className: 'yxh-progress-text' },
          h('span', null, `${asset.progress}%${asset.attempt > 0 ? ` · ${t('retrying')}` : ''}`),
          uploadedBytesLabel ? h('span', null, uploadedBytesLabel) : null),
        h('span', { className: 'yxh-progress-track' },
          h('span', { className: 'yxh-progress-fill', style: { width: `${asset.progress}%` } })))
      : null,
    h('button', { type: 'button', className: 'yxh-thumb-remove', 'aria-label': t('remove'), disabled: locked, onClick: onRemove }, '×'))
}

function Overlay({ t }) {
  const visible = useSyncExternalStore(subscribeOpen, snapshotOpen, snapshotOpen)
  const shellRef = useRef(null)
  const [tab, setTab] = useState('images')
  // per-asset 素材状态机（docs/0907/xhs）：每个素材独立 status/进度/轮询，互不阻塞。
  const [, setUploadVersion] = useState(0)
  const managerRef = useRef(null)
  if (managerRef.current === null) {
    managerRef.current = createUploadManager({
      startUpload: body => uploadFetch(UPLOAD_START, body),
      pollStatus: body => uploadFetch(UPLOAD_STATUS, body),
      onChange: () => setUploadVersion(version => version + 1),
    })
  }
  const uploads = managerRef.current
  const [uploadError, setUploadError] = useState('')
  const [picking, setPicking] = useState(false)
  const pickingRef = useRef(false)
  // 视频首帧预览加载失败（编码/损坏）：回退为「文件名 + 大小」。
  const [brokenPreviews, setBrokenPreviews] = useState(() => new Set())
  const [theme, setTheme] = useState('')
  const [refNote, setRefNote] = useState('')
  const [refAccount, setRefAccount] = useState('')
  const machineState = useSyncExternalStore(subscribeMachine, () => machine.get(), () => machine.get())
  const { task, versions, error } = machineState
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [confirming, setConfirming] = useState(false)

  const taskStatus = task?.taskStatus || 'idle'
  const processing = Boolean(task?.taskId) && !isTerminal(taskStatus)
  const locked = busy || picking || processing
  const canCancel = Boolean(task?.taskId) && !isTerminal(taskStatus)

  const imageAssets = uploads.list('image')
  const videoAsset = uploads.list('video')[0] ?? null

  useEffect(() => {
    if (!visible) return undefined
    const key = event => { if (event.key === 'Escape') closeOverlay() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [visible])
  useEffect(() => { if (visible) requestAnimationFrame(() => shellRef.current?.focus?.()) }, [visible])

  // 打开/关闭 overlay：恢复或停止轮询（任务与上传都不取消），关闭时重置取消确认框。
  useEffect(() => {
    if (visible) { machine.resume(); uploads.resume() }
    else { machine.stop(); uploads.stopAll(); setConfirming(false) }
  }, [visible])

  const pickAndUpload = async kind => {
    if (pickingRef.current || busyRef.current || processing) return
    pickingRef.current = true
    setPicking(true)
    setUploadError('')
    try {
      const picked = await uploadFetch(UPLOAD_PICK, { kind })
      // 用户在原生对话框取消（picked:false）或选择器不可用：静默返回。
      if (!picked || !picked.picked || !picked.path) return
      if (kind === 'image') {
        // 竞态保护：对话框打开期间列表可能已被补满。
        if (uploads.list('image').length >= MAX_IMAGES) return
      } else {
        // 视频重选 = 覆盖同一素材：先停掉旧视频的轮询再启动新上传。
        const previous = uploads.list('video')[0]
        if (previous) uploads.remove(previous.id)
      }
      await uploads.start({
        kind,
        path: picked.path,
        name: picked.name,
        size: picked.size,
        mime: picked.mime,
      })
    } finally {
      pickingRef.current = false
      setPicking(false)
    }
  }

  const removeAsset = asset => {
    if (pickingRef.current || busyRef.current || locked) return
    uploads.remove(asset.id)
    setBrokenPreviews(prev => {
      const next = new Set(prev)
      next.delete(asset.id)
      return next
    })
  }

  const onSubmit = async () => {
    if (busyRef.current || pickingRef.current || processing) return
    // 拦截范围 = 本次提交所用素材组（当前 tab 对应的 images/video），不跨 tab 拦截。
    const groupAssets = tab === 'images' ? imageAssets : (videoAsset ? [videoAsset] : [])
    if (groupAssets.length === 0) return
    if (groupAssets.some(asset => asset.status === 'uploading')) {
      setUploadError(t('uploadingBlock'))
      return
    }
    // url 齐全校验：failed/无 url 的素材不允许进入创建任务。
    if (groupAssets.some(asset => asset.status !== 'uploaded' || !asset.url)) {
      setUploadError(t('uploadFailed'))
      return
    }
    const mediaType = tab
    const input = { mediaType, theme: theme.trim(), refNote: refNote.trim(), refAccount: refAccount.trim(), imageUrls: tab === 'images' ? groupAssets.map(asset => asset.url) : null, videoUrl: tab === 'video' ? videoAsset.url : null }
    const idempotencyKey = newIdempotencyKey()
    const references = input.refNote ? [{ source: 'manual', url: input.refNote }] : []
    const accounts = input.refAccount ? [{ name: input.refAccount }] : []
    const body = { action: 'create', mediaType, idempotencyKey, theme: input.theme || null, references, accounts, versionCount: 3 }
    if (mediaType === 'images') { body.imageUrls = input.imageUrls; body.coverIndex = 0 }
    else { body.videoUrl = input.videoUrl }
    busyRef.current = true
    setBusy(true)
    try { await machine.submit(body) } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const cancelCurrent = async () => {
    if (busyRef.current || !canCancel) return
    busyRef.current = true
    setConfirming(false)
    setBusy(true)
    try { await machine.requestCancel() } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (!visible) return null

  const taskErrorText = errorText(error, t)
  const labels = markdownLabels(t)
  const submittingGroup = tab === 'images' ? imageAssets : (videoAsset ? [videoAsset] : [])
  const hasMaterial = submittingGroup.length > 0
  const uploadingInGroup = uploads.hasUploading(tab === 'images' ? 'image' : 'video')
  // P5：buttonDisabled 去掉 uploading 项——存在上传中素材时按钮仍可点击以触发提示；
  // 以 aria-disabled + 置灰作为无障碍提示，不阻断点击。
  const buttonDisabled = locked || !hasMaterial
  const buttonLabel = busy || processing ? t('submitting') : t('submit')

  const left = h('div', { className: 'yxh-left' },
    h('section', { className: 'yxh-section' },
      h('h2', null, t('material')),
      h(TabBar, { tab, onTab: setTab, t, disabled: locked }),
      tab === 'images'
        ? h('div', { className: 'yxh-media' },
          imageAssets.map(asset => h(MediaThumb, {
            key: asset.id,
            asset,
            t,
            locked,
            broken: brokenPreviews.has(asset.id),
            onPreviewError: () => setBrokenPreviews(prev => new Set(prev).add(asset.id)),
            onRemove: () => removeAsset(asset),
          })),
          imageAssets.length < MAX_IMAGES
            ? h('button', { type: 'button', className: 'yxh-add', 'aria-label': t('addImage'), disabled: locked, onClick: () => pickAndUpload('image') }, picking ? '…' : '+')
            : null)
        : h('div', { className: 'yxh-media' },
          videoAsset
            ? h(MediaThumb, {
              key: videoAsset.id,
              asset: videoAsset,
              t,
              locked,
              broken: brokenPreviews.has(videoAsset.id),
              onPreviewError: () => setBrokenPreviews(prev => new Set(prev).add(videoAsset.id)),
              onRemove: () => removeAsset(videoAsset),
            })
            : h('button', { type: 'button', className: 'yxh-add', 'aria-label': t('videoLabel'), disabled: locked, onClick: () => pickAndUpload('video') }, picking ? '…' : '+')),
      h('div', { className: 'yxh-hint' }, tab === 'images' ? t('imageHint').replace('{count}', String(imageAssets.length)) : null),
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
      h('button', {
        type: 'button',
        className: `yxh-submit${uploadingInGroup ? ' yxh-submit-wait' : ''}`,
        disabled: buttonDisabled,
        'aria-disabled': uploadingInGroup || undefined,
        onClick: onSubmit,
      }, buttonLabel),
      h('button', { type: 'button', className: 'yxh-cancel', disabled: !canCancel || busy, onClick: () => setConfirming(true) }, t('cancelTask'))))

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
    right = h('div', { className: 'yxh-state', role: 'status' }, h('p', null, t('empty')))
  }

  return h('div', { className: 'yxh-overlay' },
    h('main', { className: 'yxh-shell', 'aria-labelledby': 'yxh-title', ref: shellRef, tabIndex: -1, 'aria-busy': locked || uploadingInGroup },
      h('header', { className: 'yxh-header' },
        h('div', null, h('h1', { id: 'yxh-title' }, t('title')), h('p', null, t('subtitle'))),
        h('div', { className: 'yxh-header-buttons' },
          h(Tooltip, { label: t('close') }, h('button', { type: 'button', 'aria-label': t('close'), onClick: closeOverlay }, h(IconCloseOutline16, { size: 16 }))))),
      h('div', { className: 'yxh-body' },
        left,
        h('div', { className: 'yxh-right', 'aria-label': t('result') },
          h('h2', { className: 'yxh-right-title' }, t('result')),
          right))),
    confirming ? h('div', { className: 'yxh-confirm-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t('cancelConfirm') },
      h('div', { className: 'yxh-confirm' },
        h('p', { className: 'yxh-confirm-title' }, t('cancelConfirm')),
        h('div', { className: 'yxh-confirm-actions' },
          h('button', { type: 'button', className: 'yxh-confirm-primary', onClick: cancelCurrent }, t('confirmYes')),
          h('button', { type: 'button', className: 'yxh-confirm-secondary', onClick: () => setConfirming(false) }, t('confirmNo'))))) : null)
}

function formatBytes(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return ''
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / 1024 / 1024).toFixed(1)} MB`
}

const css = `.yxh-button{display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.yxh-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yxh-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yxh-wide span{font-size:13px}.yxh-overlay{position:fixed;inset:0;z-index:520;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yxh-shell{display:grid;grid-template-rows:auto 1fr;width:100%;height:100%;overflow:hidden}.yxh-header{display:flex;min-height:82px;align-items:center;justify-content:space-between;padding:16px 28px;border-bottom:1px solid var(--dsw-alias-border-l1);gap:24px}.yxh-header h1{margin:0;font-size:24px;line-height:1.25}.yxh-header p{max-width:900px;margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1.45}.yxh-header-buttons{display:flex;flex:none;gap:6px}.yxh-header-buttons button{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.yxh-body{display:grid;grid-template-columns:minmax(460px,1.15fr) minmax(420px,.85fr);max-width:1440px;margin:0 auto;width:100%;min-height:0;overflow:hidden}.yxh-left{overflow:auto;padding:28px 32px 36px;border-right:1px solid var(--dsw-alias-border-l1)}.yxh-right{overflow:auto;padding:28px 32px 36px}.yxh-section{display:grid;gap:16px}.yxh-section+.yxh-section{margin-top:30px}.yxh-section h2,.yxh-right-title{margin:0;font-size:18px;line-height:1.35;font-weight:650}.yxh-right-title{margin-bottom:20px}.yxh-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yxh-tabs button{height:44px;padding:0 18px;border:0;border-bottom:3px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;cursor:pointer}.yxh-tabs button[aria-current="true"]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:650}.yxh-tabs button:disabled{opacity:.45;cursor:default}.yxh-media{display:flex;flex-wrap:wrap;gap:12px}.yxh-thumb{position:relative;margin:0;width:104px;height:104px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}.yxh-thumb img{width:100%;height:100%;object-fit:cover}.yxh-thumb video{width:100%;height:100%;object-fit:cover}.yxh-preview-fallback{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:2px;padding:6px;text-align:center}.yxh-video-badge{position:absolute;top:4px;left:4px;padding:1px 6px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 82%,transparent);color:var(--dsw-alias-label-primary);font-size:11px}.yxh-thumb-error{position:absolute;inset:0;display:grid;place-items:center;padding:4px;text-align:center;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,transparent);color:var(--dsw-alias-state-error-primary);font-size:11px}.yxh-progress{position:absolute;left:0;right:0;bottom:0;display:grid;gap:3px;padding:3px 4px 4px;background:linear-gradient(transparent,rgba(0,0,0,.55))}.yxh-progress-text{display:flex;justify-content:space-between;gap:4px;color:#fff;font-size:10px;line-height:1.2;text-shadow:0 1px 2px rgba(0,0,0,.6)}.yxh-progress-track{display:block;height:3px;border-radius:2px;background:rgba(255,255,255,.35);overflow:hidden}.yxh-progress-fill{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary,#fff);transition:width .15s linear}.yxh-thumb-remove{position:absolute;top:4px;right:4px;display:grid;width:20px;height:20px;place-items:center;border:0;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 82%,transparent);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1;cursor:pointer}.yxh-thumb-remove:disabled{opacity:.45;cursor:default}.yxh-add{display:grid;width:104px;height:104px;place-items:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:28px;cursor:pointer}.yxh-add:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.yxh-add:disabled{opacity:.45;cursor:default}.yxh-video-name{flex:1;min-width:0;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.yxh-video-meta{color:var(--dsw-alias-label-secondary);font-size:11px}.yxh-hint{color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-error{color:var(--dsw-alias-state-error-primary);font-size:12px}.yxh-field{display:grid;gap:8px}.yxh-field span{color:var(--dsw-alias-label-secondary);font-size:14px}.yxh-field input{min-height:40px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:14px}.yxh-field input:disabled{opacity:.6}.yxh-actions{margin-top:28px;display:flex;align-items:center;gap:16px}.yxh-submit{min-height:40px;padding:0 20px;border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:14px;font-weight:600;cursor:pointer}.yxh-submit:disabled{opacity:.45;cursor:default}.yxh-submit-wait{opacity:.55;cursor:not-allowed}.yxh-cancel{min-height:40px;padding:0 20px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-weight:600;cursor:pointer}.yxh-cancel:hover{background:var(--dsw-alias-bg-layer-2)}.yxh-cancel:disabled{opacity:.45;cursor:default}.yxh-confirm-overlay{position:fixed;inset:0;z-index:560;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-bg-base) 45%,transparent)}.yxh-confirm{min-width:360px;max-width:80vw;padding:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 40px rgba(0,0,0,.18)}.yxh-confirm-title{margin:0 0 20px;color:var(--dsw-alias-label-primary);font-size:15px;line-height:1.5}.yxh-confirm-actions{display:flex;justify-content:flex-end;gap:12px}.yxh-confirm-primary{min-height:36px;padding:0 18px;border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:14px;font-weight:600;cursor:pointer}.yxh-confirm-secondary{min-height:36px;padding:0 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer}.yxh-versions{display:grid;gap:16px}.yxh-version{padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yxh-version-head{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}.yxh-version-badge{flex:none;padding:3px 9px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-version-head h3{margin:0;font-size:16px}.yxh-version-body{font-size:14px;line-height:1.6}.yxh-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.yxh-tag{padding:2px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-extra{display:grid;gap:3px;margin-top:12px}.yxh-extra-label{color:var(--dsw-alias-label-tertiary);font-size:12px}.yxh-extra-body{font-size:14px}.yxh-page-copy{font-size:14px}.yxh-pages{margin:12px 0 0;padding-left:20px;display:grid;gap:6px}.yxh-pages li{font-size:14px}.yxh-page-index{margin-right:8px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}.yxh-state{display:grid;min-height:180px;place-items:center;align-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:14px;text-align:center}.yxh-state p{margin:0}.yxh-step{color:var(--dsw-alias-label-tertiary);font-size:12px}.yxh-state-error p:first-child{color:var(--dsw-alias-state-error-primary)}.yxh-spinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:yxh-spin .8s linear infinite}@keyframes yxh-spin{to{transform:rotate(360deg)}}@media(max-width:900px){.yxh-header,.yxh-left,.yxh-right{padding-left:16px;padding-right:16px}.yxh-header{align-items:flex-start}.yxh-header h1{font-size:21px}.yxh-header p{font-size:14px}.yxh-body{display:block;overflow:auto}.yxh-left{overflow:visible;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.yxh-right{overflow:visible;min-height:360px}}`

const responsiveCss = '.yxh-confirm{min-width:0;width:min(360px,calc(100vw - 32px));max-width:calc(100vw - 32px)}'

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-xhs-operation: dictionaries')
  ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay) }, 'dofe-yootun-xhs-operation: exclusive-overlay')
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-xhs-operation'; style.textContent = css + responsiveCss; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-xhs-operation: styles')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-xhs-operation', order: 41, inject: () => ({ t }) }, Button))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-xhs-operation', order: 41, inject: () => ({ t }) }, Overlay))
}
module.exports = { apply, inject: ['slots', 'locale'], createTaskMachine, createUploadManager }
