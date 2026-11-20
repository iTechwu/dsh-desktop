// 发布排期看板 UI 模块（RQ-2026-013 开发文档 §9/§10）：排期表格、账号栏、行状态
// 机的**纯辅助函数**与页面组件。UI 基准为 docs/1116/douyin/RQ-2026-013_UI-demo.html
// （静态示意稿），生产实现只使用宿主主题 `--dsw-*` 变量（§6.2 第 8 条：不照抄
// Demo 兜底固定色）；新增 className 严格限定实施文档 §6.2 白名单 `ydo-schedule-*`。
//
// 文案口径与 report-ui/material-ui 一致：模块内中文硬编码，仅 Tab 按钮文案
// tabSchedule 走 client.js 的 i18n。构建脚本把本模块内联进 lib/client.js（与
// report-ui/material-ui 同法）：顶部 CommonJS require 由构建剥离，React/h 由
// client.js 顶部声明提供；hooks 以 React.xxx 形式使用（与 breakdown.js 同款）。
//
// 数据流：Host action 返回 tools 的 canonical snake_case 行投影（§8.3），本模块
// toUiRow 投影为 UI camelCase 并**丢弃** created_by/updated_by（§12：不进 UI）。
// 行状态机转移的异步编排在 client.js，本文件只提供纯判定函数（可单测）。

const React = require('react')
const { createElement: h } = React

// ---------------------------------------------------------------------------
// 常量与错误文案（宿主 reason + tools 稳定码一一对应）
// ---------------------------------------------------------------------------

export const SCHEDULE_PLATFORMS = [
  { value: 'xhs', label: '小红书' },
  { value: 'douyin', label: '抖音' },
  { value: 'wx_channels', label: '视频号' },
]

const PLATFORM_VALUES = new Set(SCHEDULE_PLATFORMS.map(item => item.value))

export const SCHEDULE_ERROR_REASON_COPY = {
  // 宿主校验 reason（index.js schedule.* handler）
  account_id_required: '缺少账号，请刷新后重试',
  row_id_invalid: '排期行序号不合法，请刷新后重试',
  version_invalid: '行版本不合法，请刷新后重试',
  VALIDATION_ERROR: '提交的参数不完整或不合法，请检查后重试',
  idempotency_key_required: '缺少幂等键，请重试',
  INVALID_IDEMPOTENCY_KEY: '幂等键格式不正确，请重新发起',
  CONFIRMATION_REQUIRED: '缺少确认标记，请重新提交',
  // tools 稳定码（tools-client ALLOWED_ERROR_CODES 白名单内）
  ACCOUNT_NOT_FOUND: '云端还没有该账号的数据，请先完成一次采集',
  ACCOUNT_NOT_ACCESSIBLE: '该账号已删除或不可访问，请先在账号管理中重新扫码',
  SCHEDULE_ROW_NOT_FOUND: '排期行不存在或已被删除，请刷新列表',
  SCHEDULE_ROW_CONFLICT: '数据已被更新，请刷新后重新编辑',
  SCHEDULE_VALIDATION_ERROR: '保存的内容不合法（如链接格式/长度超限），请检查后重试',
  IDEMPOTENCY_CONFLICT: '请求与该幂等键的历史记录不一致，请刷新后重试',
  IDEMPOTENCY_IN_PROGRESS: '同一请求正在处理中，请稍后查看结果',
  IDEMPOTENCY_OUTCOME_UNKNOWN: '保存结果未知，请重试同一操作或刷新列表确认',
  UNAUTHORIZED: '登录状态已失效，请重新打开工作台',
  PAYLOAD_TOO_LARGE: '提交内容过大，请精简后重试',
  douyin_operation_request_failed: '请求失败，请检查网络后重试',
}

export function scheduleErrorCopy(reason) {
  return SCHEDULE_ERROR_REASON_COPY[reason] || '操作失败，请稍后重试'
}

// 表头契约（§13.3 第 2 项）：10 个业务列的标题与顺序；带 small 副标的列以
// sub 字段表达（§5.2 表格视觉列 12 = 序号 + 10 业务 + 操作）。
export const SCHEDULE_BUSINESS_HEADERS = [
  { key: 'shootingDate', label: '拍摄日期' },
  { key: 'videoContent', label: '视频内容' },
  { key: 'shootingStatus', label: '拍摄情况', sub: '（需要补拍或配音在下方补充）' },
  { key: 'published', label: '是否发布' },
  { key: 'assetLink', label: '成片/封面网盘链接', sub: '（编导和账号主理人确认）' },
  { key: 'note', label: '备注' },
  { key: 'publishDate', label: '发布日期' },
  { key: 'publishPlatforms', label: '发布平台' },
  { key: 'shootingOwner', label: '拍摄负责人' },
  { key: 'editingOwner', label: '剪辑负责人' },
]

// 列宽按实际录入内容放宽；容器窄时由 table-wrap 提供横向滚动（真机验收 f/e）。
export const SCHEDULE_COLUMN_WIDTHS = [80, 160, 300, 220, 140, 300, 240, 160, 220, 170, 170, 90]

// ---------------------------------------------------------------------------
// 纯投影与状态机辅助（§13.3 可单测项的锚点）
// ---------------------------------------------------------------------------

/** 服务端 snake_case 行 → UI camelCase；丢弃 created_by/updated_by（§8.3/§12）。 */
export function toUiRow(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id
  if (id === null || id === undefined || id === '') return null
  return {
    rowId: String(id),
    accountId: typeof raw.account_id === 'string' ? raw.account_id : '',
    shootingDate: raw.shooting_date || '',
    videoContent: raw.video_content || '',
    shootingStatus: Boolean(raw.shooting_status),
    published: Boolean(raw.published),
    assetLink: raw.asset_link || '',
    note: raw.note || '',
    publishDate: raw.publish_date || '',
    publishPlatforms: Array.isArray(raw.publish_platforms)
      ? raw.publish_platforms.filter(value => PLATFORM_VALUES.has(value))
      : [],
    shootingOwner: raw.shooting_owner || '',
    editingOwner: raw.editing_owner || '',
    rowVersion: String(raw.row_version ?? '1'),
  }
}

/**
 * 十进制字符串安全比较（§9.3）：不得先转 Number，避免超过 Number.MAX_SAFE_INTEGER
 * 后精度丢失；长度优先、等长逐位比较。
 */
export function compareRowId(a, b) {
  const sa = String(a)
  const sb = String(b)
  if (sa.length !== sb.length) return sa.length - sb.length
  if (sa === sb) return 0
  return sa < sb ? -1 : 1
}

/**
 * 发布日期升序比较（渲染层排序；YYYY-MM-DD 同形字符串可直接字典序比较），
 * 无日期行排在组内最后；同日期按 rowId 十进制字符串次序稳定排序。
 */
export function comparePublishDate(a, b) {
  const da = a && a.publishDate ? a.publishDate : null
  const db = b && b.publishDate ? b.publishDate : null
  if (da === db) return compareRowId(a ? a.rowId : '', b ? b.rowId : '')
  if (!da) return 1
  if (!db) return -1
  return da < db ? -1 : 1
}

/**
 * 渲染层分组（rows 状态本身保持服务端 (account_id,id) 序，不受影响）：
 * 「已发布组」= published 且行处于 idle（无在途写/异常反馈）——刚勾选已发布但
 * 保存未落定的行留在未发布组，保证 saving/conflict 反馈可见，落定后才进入
 * 可折叠的已发布组（折叠计数 = publishedGroup.length）。
 */
export function partitionScheduleRows(rows, rowStates) {
  const published = []
  const unpublished = []
  for (const row of rows || []) {
    const state = rowStates ? rowStates[row.rowId] : null
    if (row.published && (!state || state.status === 'idle')) published.push(row)
    else unpublished.push(row)
  }
  return { published, unpublished, foldedCount: published.length }
}

/** 组内发布日期升序（不改传入数组）。 */
export function sortScheduleRows(list) {
  return [...(list || [])].sort(comparePublishDate)
}

const trimToNull = value => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * UI 行 → 服务端整行业务字段（§9.6 第 5/6 条）：空 string 归 null、布尔显式、
 * 平台白名单重读 + 去重 + 固定顺序（与 tools DTO 同口径，Host 侧兜底）。
 */
export function buildServerSnapshot(uiRow) {
  const seen = new Set()
  for (const value of Array.isArray(uiRow.publishPlatforms) ? uiRow.publishPlatforms : []) {
    if (PLATFORM_VALUES.has(value)) seen.add(value)
  }
  // 与 tools DTO 同口径：白名单重读 + 去重 + 固定顺序 xhs -> douyin -> wx_channels。
  const platforms = SCHEDULE_PLATFORMS.map(item => item.value).filter(value => seen.has(value))
  return {
    shootingDate: trimToNull(uiRow.shootingDate),
    videoContent: trimToNull(uiRow.videoContent),
    shootingStatus: Boolean(uiRow.shootingStatus),
    published: Boolean(uiRow.published),
    assetLink: trimToNull(uiRow.assetLink),
    note: trimToNull(uiRow.note),
    publishDate: trimToNull(uiRow.publishDate),
    publishPlatforms: platforms,
    shootingOwner: trimToNull(uiRow.shootingOwner),
    editingOwner: trimToNull(uiRow.editingOwner),
  }
}

/** 用最近服务端快照恢复 UI 行（放弃修改时立刻清掉未提交内容，P2-1）。 */
export function restoreUiRowFromServerSnapshot(row, snapshot) {
  if (!snapshot) return row
  return {
    ...row,
    ...snapshot,
    shootingDate: snapshot.shootingDate || '',
    videoContent: snapshot.videoContent || '',
    assetLink: snapshot.assetLink || '',
    note: snapshot.note || '',
    publishDate: snapshot.publishDate || '',
    shootingOwner: snapshot.shootingOwner || '',
    editingOwner: snapshot.editingOwner || '',
  }
}

/** 新行的行级状态（§9.4）：idle、版本字符串、无在途键。 */
export function createRowState(expectedVersion, savedSnapshot = null) {
  return {
    status: 'idle', // idle | saving | queued | failed | conflict | unknown
    operation: null, // 'save' | 'delete'（同键重试时区分）
    expectedVersion: String(expectedVersion ?? '1'),
    idempotencyKey: null,
    dirtySnapshot: null,
    lastSavedSnapshot: savedSnapshot,
    lastServerError: null,
  }
}

const LOCKED_STATUSES = new Set(['saving', 'queued', 'unknown'])
const BLOCKING_STATUSES = new Set(['failed', 'conflict'])

/** 该行是否持有未提交修改（failed/conflict 行带 dirty 也阻塞账号切换，§9.4 第 8 条）。 */
export function rowHasPendingWork(state) {
  if (!state) return false
  if (LOCKED_STATUSES.has(state.status)) return true
  return BLOCKING_STATUSES.has(state.status) && state.dirtySnapshot !== null
}

/**
 * 账号切换互斥（§9.4 第 8 条 / §5.3）：任一行 saving/queued/unknown，或
 * failed/conflict 且持有未提交修改 → 禁止切换。
 */
export function canSwitchAccount(rowStates) {
  return !Object.values(rowStates || {}).some(rowHasPendingWork)
}

/**
 * 表格刷新互斥（真机验收 d/f）：saving/queued 会携带未提交 queued 快照，必须等
 * 保存结束；failed/conflict/unknown 若仍持有 dirty 也不得被刷新清空。unknown/conflict
 * 在无 dirty 时允许刷新，这是行级“刷新”的恢复路径。
 */
export function refreshScheduleBlocked(rowStates, deleteBusy = false) {
  if (deleteBusy) return true
  return Object.values(rowStates || {}).some(state => {
    if (!state) return false
    if (state.status === 'saving' || state.status === 'queued') return true
    return ['failed', 'conflict', 'unknown'].includes(state.status) && state.dirtySnapshot !== null
  })
}

/** 非 idle 行禁用删除；delete 在途时禁用编辑保存（§9.4 第 9 条）。 */
export function deleteAllowed(state, deleteInFlight) {
  return !deleteInFlight && (!state || state.status === 'idle')
}

/**
 * 失败原因 → 行状态（§9.4 第 5-7 条）：IDEMPOTENCY_OUTCOME_UNKNOWN → unknown
 * （只允许同键重试/刷新）；SCHEDULE_ROW_CONFLICT → conflict（只读）；其余确定性
 * 业务失败 → failed（保留输入，同键重试/刷新/显式放弃）。
 */
export function rowStatusOnFailure(reason) {
  if (reason === 'IDEMPOTENCY_OUTCOME_UNKNOWN') return 'unknown'
  if (reason === 'SCHEDULE_ROW_CONFLICT') return 'conflict'
  return 'failed'
}

/** saving/failed 期间编辑：返回合并后的 dirty 字段补丁（queued 语义的载体）。 */
export function mergeDirtyPatch(state, field, value) {
  return { ...((state && state.dirtySnapshot) || {}), [field]: value }
}

/** 成功落库后是否需用新键补提交一次：dirty 合并行与服务器行存在业务差异。 */
export function dirtyResubmitNeeded(serverRow, mergedRow) {
  return JSON.stringify(buildServerSnapshot(mergedRow)) !== JSON.stringify(buildServerSnapshot(serverRow))
}

/**
 * no-op 保存判定（P3-011）：idle 行当前业务快照与最近一次服务端快照一致时，
 * 失焦不发送整行更新、不递增 row_version。所有快照都先 buildServerSnapshot，
 * 因此空串/平台顺序/布尔形态在比较前归一。
 */
export function savedSnapshotChanged(row, state) {
  const saved = state && state.lastSavedSnapshot
  if (!saved) return true
  return JSON.stringify(buildServerSnapshot(row)) !== JSON.stringify(saved)
}

/** 行渲染所需派生：状态类（白名单两枚）与只读判定。 */
export function rowStatusMeta(state) {
  const status = state && state.status ? state.status : 'idle'
  // conflict/unknown 输入只读（§9.4 第 6/7 条）；delete 在途整行只读
  // （§9.4 第 9 条：删除中禁用编辑与保存）。
  const locked =
    status === 'conflict' ||
    status === 'unknown' ||
    (status === 'saving' && state.operation === 'delete')
  return {
    status,
    locked,
    rowClass:
      status === 'saving' || status === 'queued'
        ? 'ydo-schedule-row-saving'
        : status === 'failed' || status === 'conflict' || status === 'unknown'
          ? 'ydo-schedule-row-error'
          : '',
  }
}

// ---------------------------------------------------------------------------
// 页面组件
// ---------------------------------------------------------------------------

function PlatformGroup({ row, disabled, onPlatformToggle }) {
  return h(
    'div',
    { className: 'ydo-schedule-platform-group' },
    ...SCHEDULE_PLATFORMS.map(item =>
      h('label', { key: item.value },
        h('input', {
          type: 'checkbox',
          checked: row.publishPlatforms.includes(item.value),
          disabled,
          onChange: event => onPlatformToggle(row.rowId, item.value, event.target.checked),
          'aria-label': `发布平台 ${item.label}`,
        }),
        h('span', null, item.label))),
  )
}

function DeleteButton({ row, state, deleteInFlight, onDelete }) {
  const allowed = deleteAllowed(state, deleteInFlight)
  return h('button', {
    type: 'button',
    className: 'ydo-schedule-delete-button',
    disabled: !allowed,
    onClick: () => onDelete(row.rowId),
    'aria-label': `删除序号 ${row.rowId}`,
    title: allowed ? undefined : '存在未完成的保存或删除，完成后才能删除',
  },
  h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' })))
}

function RowStatusActions({ rowId, state, onRetry, onDiscard, onRefresh }) {
  if (!state || state.status === 'idle' || state.status === 'saving' || state.status === 'queued') {
    return null
  }
  const buttons = []
  if (state.status === 'failed' || state.status === 'unknown') {
    buttons.push(h('button', {
      key: 'retry', type: 'button', className: 'ydo-secondary',
      onClick: () => onRetry(rowId),
    }, state.operation === 'delete' ? '重试删除' : '同键重试'))
  }
  if (state.status === 'failed') {
    buttons.push(h('button', {
      key: 'discard', type: 'button', className: 'ydo-secondary',
      onClick: () => onDiscard(rowId),
    }, '放弃修改'))
  }
  buttons.push(h('button', {
    key: 'refresh', type: 'button', className: 'ydo-secondary',
    onClick: () => onRefresh(),
  }, '刷新'))
  // 注意：白名单（实施文档 §6.2）没有状态操作区包装类，按钮直接进操作列。
  return buttons
}

function ScheduleRow({ row, state, deleteInFlight, focusRowId, extraRowClass, actions }) {
  const meta = rowStatusMeta(state)
  const disabled = meta.locked
  const statusActions = RowStatusActions({
    rowId: row.rowId,
    state,
    onRetry: actions.onRetry,
    onDiscard: actions.onDiscard,
    onRefresh: actions.onRefresh,
  })
  // 受控输入契约：value 必须配 onChange（React 对「value 无 onChange」的输入会在
  // 每次键入后把 DOM 还原为 props.value——P0-1 教训）。onChange 只更新本地行值
  // （onEditCell），失焦才保存（onBlurCell）；日期输入的 change 直接保存
  // （§9.6 第 2 条：原生选择器关闭后 blur 不一定触发）。
  const inputProps = (field, extra) => ({
    className: extra === 'textarea' ? 'ydo-schedule-cell-textarea' : 'ydo-schedule-cell-input',
    disabled,
    onChange: event => actions.onEditCell(row.rowId, field, event.target.value),
    onBlur: event => actions.onBlurCell(row.rowId, field, event.target.value),
    'data-row-id': row.rowId,
    'data-field': field,
    ref: focusRowId === row.rowId && field === 'videoContent' ? actions.focusRef : undefined,
  })
  const trClass = [meta.rowClass, extraRowClass].filter(Boolean).join(' ')
  return h('tr', { className: trClass || undefined, 'data-row-id': row.rowId },
    h('td', { className: 'ydo-schedule-sequence-cell', title: '系统生成的排期行主键' }, row.rowId),
    h('td', null,
      h('input', { ...inputProps('shootingDate'), type: 'date', value: row.shootingDate, 'aria-label': '拍摄日期',
        onChange: event => actions.onBlurCell(row.rowId, 'shootingDate', event.target.value) })),
    h('td', null,
      h('textarea', { ...inputProps('videoContent', 'textarea'), rows: 1, value: row.videoContent, 'aria-label': '视频内容' })),
    h('td', { className: 'ydo-schedule-checkbox' },
      h('input', {
        type: 'checkbox', checked: row.shootingStatus, disabled,
        onChange: event => actions.onCheckbox(row.rowId, 'shootingStatus', event.target.checked),
        'aria-label': '拍摄完成',
      })),
    h('td', { className: 'ydo-schedule-checkbox' },
      h('input', {
        type: 'checkbox', checked: row.published, disabled,
        onChange: event => actions.onCheckbox(row.rowId, 'published', event.target.checked),
        'aria-label': '已发布',
      })),
    h('td', null,
      h('input', { ...inputProps('assetLink'), type: 'url', value: row.assetLink, placeholder: '网盘链接', 'aria-label': '成片/封面网盘链接' })),
    h('td', null,
      h('textarea', { ...inputProps('note', 'textarea'), rows: 1, value: row.note, 'aria-label': '备注' })),
    h('td', null,
      h('input', { ...inputProps('publishDate'), type: 'date', value: row.publishDate, 'aria-label': '发布日期',
        onChange: event => actions.onBlurCell(row.rowId, 'publishDate', event.target.value) })),
    h('td', null, h(PlatformGroup, { row, disabled, onPlatformToggle: actions.onPlatformToggle })),
    h('td', null,
      h('input', { ...inputProps('shootingOwner'), type: 'text', value: row.shootingOwner, 'aria-label': '拍摄负责人' })),
    h('td', null,
      h('input', { ...inputProps('editingOwner'), type: 'text', value: row.editingOwner, 'aria-label': '剪辑负责人' })),
    h('td', { className: 'ydo-schedule-delete-cell' },
      h(DeleteButton, { row, state, deleteInFlight, onDelete: actions.onDelete }),
      ...(statusActions || []),
      state && state.lastServerError
        ? h('p', { className: 'ydo-error', role: 'alert' }, scheduleErrorCopy(state.lastServerError))
        : null),
  )
}

/**
 * 发布排期看板页（工具栏 + 12 视觉列表格 + 底部账号栏 + 删除确认弹框）。
 * 全部数据与回调来自 props（状态机在 client.js），本组件不做业务判断。
 */
export function SchedulePage({
  loading,
  errorReason,
  publishedExpanded,
  accounts,
  activeAccountId,
  rows,
  rowStates,
  creating,
  deleteTarget,
  deleteBusy,
  deleteTargetSequence,
  hint,
  focusRowId,
  renderAvatar,
  actions,
}) {
  const initialUnavailable = Boolean((loading || errorReason) && !(accounts || []).length)
  const hasAccounts = Boolean((accounts || []).length)
  const deleteTargetRow = rows.find(row => row.rowId === deleteTarget)
  const deleteTargetContent = (deleteTargetRow?.videoContent || '').trim() || '未填写视频内容'

  // 渲染层分组排序（rows 状态保持服务端序）：已发布组（含折叠行）在顶部，
  // 未发布组按发布日期升序、无日期排最后；斑马纹在未发布组内按组内奇偶计算。
  const { published: publishedGroup, unpublished: unpublishedGroup } = partitionScheduleRows(rows, rowStates)
  const sortedPublished = sortScheduleRows(publishedGroup)
  const sortedUnpublished = sortScheduleRows(unpublishedGroup)
  const renderRow = (row, extraRowClass) => h(ScheduleRow, {
    key: row.rowId,
    row,
    state: rowStates[row.rowId] || null,
    deleteInFlight: deleteBusy,
    focusRowId,
    extraRowClass,
    actions,
  })
  const toggleRow = publishedGroup.length
    ? h('tr', {
      key: 'published-toggle',
      className: 'ydo-schedule-toggle-row',
      role: 'button',
      tabIndex: 0,
      'aria-expanded': publishedExpanded || undefined,
      'aria-label': publishedExpanded ? '收起已发布排期' : `展开${publishedGroup.length}条已发布排期`,
      onClick: actions.onTogglePublished,
      onKeyDown: event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          actions.onTogglePublished()
        }
      },
    }, h('td', { colSpan: 12 },
      `${publishedExpanded ? '▾' : '▸'} 已发布（${publishedGroup.length} 条）· 点击${publishedExpanded ? '收起' : '展开'}`))
    : null
  const bodyRows = []
  if (rows.length) {
    if (publishedExpanded) {
      for (const row of sortedPublished) bodyRows.push(renderRow(row, 'ydo-schedule-row-published'))
    }
    if (toggleRow) bodyRows.push(toggleRow)
    sortedUnpublished.forEach((row, index) => {
      bodyRows.push(renderRow(row, index % 2 === 1 ? 'ydo-schedule-row-striped' : null))
    })
    if (!sortedUnpublished.length && publishedGroup.length && !publishedExpanded) {
      bodyRows.push(h('tr', { className: 'ydo-schedule-empty' },
        h('td', { colSpan: 12 }, '所有排期均已发布')))
    }
  } else {
    bodyRows.push(h('tr', { className: 'ydo-schedule-empty' },
      h('td', { colSpan: 12 }, '暂无排期，点击新增行开始录入')))
  }
  const tableBody = loading
    ? h('tr', { className: 'ydo-schedule-empty' },
      h('td', { colSpan: 12 }, '加载中…'))
    : initialUnavailable || errorReason
      ? h('tr', { className: 'ydo-schedule-empty' },
        h('td', { colSpan: 12 },
          h('span', { className: 'ydo-error', role: 'alert' }, scheduleErrorCopy(errorReason || 'douyin_operation_request_failed')),
          h('button', { type: 'button', className: 'ydo-secondary', onClick: actions.onBoardRetry }, '重试')))
      : bodyRows

  if (!hasAccounts && !initialUnavailable) {
    return h('section', { className: 'ydo-right', 'aria-label': '发布排期看板' },
      h('p', { className: 'ydo-state', role: 'status' }, '暂无抖音账号，请先在抖音工作台中添加账号'))
  }

  return h('section', { className: 'ydo-right ydo-schedule-page', 'aria-label': '发布排期看板' },
    h('div', { className: 'ydo-toolbar' },
      h('div', { className: 'ydo-schedule-actions' },
        h('button', {
          type: 'button',
          className: 'ydo-primary',
          disabled: creating || !hasAccounts,
          'aria-busy': creating || undefined,
          onClick: actions.onCreate,
        }, creating ? '新增中…' : '新增行'),
        h('button', {
          type: 'button',
          className: 'ydo-secondary',
          disabled: loading || creating || deleteBusy || undefined,
          'aria-busy': loading || creating || deleteBusy || undefined,
          onClick: actions.onBoardRetry,
        }, loading ? '刷新中…' : '刷新')),
      hint ? h('div', { className: 'ydo-hint', role: hint.tone === 'error' ? 'alert' : 'status', 'aria-live': 'polite' }, hint.text) : null),
    h('div', { className: 'ydo-table-wrap' },
      h('table', { className: 'ydo-schedule-table', 'aria-label': '发布排期' },
        h('colgroup', null,
          ...SCHEDULE_COLUMN_WIDTHS.map((width, index) => h('col', { key: index, width }))),
        h('thead', null,
          h('tr', null,
            h('th', { className: 'ydo-schedule-sequence-cell', scope: 'col' }, '序号'),
            ...SCHEDULE_BUSINESS_HEADERS.map(item =>
              h('th', { key: item.key, scope: 'col' },
                item.label,
                item.sub ? h('small', null, item.sub) : null)),
            h('th', { className: 'ydo-schedule-delete-cell', scope: 'col' }, '操作'))),
        h('tbody', null, tableBody))),
    h('div', { className: 'ydo-schedule-account-bar', 'aria-label': '抖音账号切换栏' },
      h('span', { className: 'ydo-schedule-account-bar-label' }, '抖音账号'),
      hasAccounts
        ? accounts.map(account =>
          h('button', {
            key: account.accountId,
            type: 'button',
            className: 'ydo-schedule-account-chip',
            'aria-pressed': account.accountId === activeAccountId || undefined,
            onClick: () => actions.onSwitchAccount(account.accountId),
          },
            renderAvatar
              ? renderAvatar(account)
              : h('span', { className: 'ydo-avatar ydo-avatar-fallback', 'aria-hidden': true },
                (account.nickname || account.accountId || '·').slice(0, 1)),
            h('span', { className: 'ydo-schedule-account-text' },
              h('span', { className: 'ydo-schedule-account-name' },
                account.nickname || account.accountId),
              h('span', { className: 'ydo-schedule-account-meta' },
                account.fanCount != null ? `粉丝 ${account.fanCount}` : '有效账号'))))
        : h('span', { className: 'ydo-schedule-account-meta' },
          loading
            ? '账号列表加载中…'
            : errorReason
              ? '账号列表加载失败，请重试'
              : '暂无抖音账号，请先在抖音工作台中添加账号')),
    deleteTarget
      ? h('div', { className: 'ydo-mat-modal-overlay', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'ydo-schedule-delete-title' },
        h('div', { className: 'ydo-mat-modal' },
          h('form', { className: 'ydo-mat-form', onSubmit: event => event.preventDefault() },
            h('p', { id: 'ydo-schedule-delete-title', className: 'ydo-mat-field' },
              '确认删除：',
              h('span', null, deleteTargetContent),
              ' 的排期行？'),
            h('p', { className: 'ydo-hint' }, '删除后数据不可恢复。'),
            h('div', { className: 'ydo-mat-modal-actions' },
              h('button', { type: 'button', className: 'ydo-secondary', disabled: deleteBusy, onClick: actions.onCancelDelete }, '取消'),
              h('button', { type: 'button', className: 'ydo-primary', disabled: deleteBusy, 'aria-busy': deleteBusy || undefined, onClick: actions.onConfirmDelete }, deleteBusy ? '删除中…' : '删除')))))
      : null,
  )
}
