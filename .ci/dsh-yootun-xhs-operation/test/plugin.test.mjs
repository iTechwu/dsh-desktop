import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const root = new URL('../', import.meta.url)

const escape = token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('publishes a web plugin with a bundle patch and client entry', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-xhs-operation')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.ok(Array.isArray(manifest.dsh.client.inject))
})

test('registers menu at order 41 and renders the three-region overlay', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of [
    'order: 41',
    'sidebar.footer.action',
    'shell.overlay',
    'IconEditOutlineRegular',
    'IconCloseOutlineRegular',
    'MarkdownText',
    '/api/desktop/yootun/xhs-operation',
    '/_dsh/uploader/pick-file',
    '/_dsh/uploader/uploadStart',
    '/_dsh/uploader/uploadStatus',
    '/_dsh/uploader/media',
    '小红书运营',
    '爆款仿写',
    'yxh-page-tabs',
    '开始生成',
    '正在生成',
    '小红书平台运营，包括内容创作、运营数据汇总与分析等常用功能',
    'coverIndex = 0',
    // RQ-2026-002：文案方向 / 理解视频开关 / 单版可编辑结果卡
    'versionCount: 1',
    'videoUnderstanding',
    '文案方向',
    '理解视频内容',
    'function EditableResult',
    '重新生成',
    '复制全文',
    '保存编辑',
    'composeFullText',
    'references',
    'accounts',
    '15000',
    '取消任务',
    '确认取消当前任务',
    // 步骤名中文化：进度与失败行展示本地化步骤名，不用服务端英文标识。
    '素材下载',
    '图片理解',
    '事实提取',
    '文案生成',
    'function stepLabel(t, step)',
    // 失败原因透出：受控短语匹配后展示可操作的中文引导与失败步骤。
    '失败步骤',
    '素材中未提取到车型、价格等有效事实',
    'function failureHintKey(errorCode, errorMessage)',
    'hintNoFactNoReference',
    'errorMessage: res.errorMessage',
  ]) assert.match(source, new RegExp(escape(token), 'u'))
  // 互斥与上限：最多 5 张、视频单选、提交只读当前 Tab
  assert.match(source, /const MAX_IMAGES = 9/)
  assert.match(source, /mediaType === 'images'/)
  assert.match(source, /videoUrl/)
  assert.match(source, /\.yxh-tabs button\[aria-current="true"\]/)
  // 顶部功能 Tab（对齐抖音运营页）：固定「爆款仿写」单页 + 三行 shell 网格。
  assert.match(source, /\.yxh-page-tabs button\[aria-current="true"\]/)
  assert.match(source, /grid-template-rows:auto auto 1fr/)
  assert.match(source, /grid-template-columns:minmax\(460px,1\.15fr\) minmax\(420px,\.85fr\)/)
  assert.match(source, /yxh-right-title/)
  assert.match(source, /width:min\(360px,calc\(100vw - 32px\)\)/)
  assert.match(source, /max-width:calc\(100vw - 32px\)/)
  // 禁止不安全富文本
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|password|cookie/i)
})

test('upload experience: per-asset state machine, progress overlay and submit interception', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  // per-asset 状态机 + 350ms 轮询；全局 uploading flag 已移除。
  assert.match(source, /function createUploadManager/)
  assert.match(source, /const UPLOAD_POLL_INTERVAL_MS = 350/)
  assert.match(source, /module\.exports = \{ apply, inject: \['slots', 'locale'\], createTaskMachine, createUploadManager, createAccountsHub, createHotboardHub \}/)
  assert.doesNotMatch(source, /setUploading|UPLOAD_SEND/)
  // 已选即预览：本地媒体路由 + 视频首帧定格 + 角标。
  assert.match(source, /localPreviewUrl/)
  assert.match(source, /#t=0\.1/)
  assert.match(source, /preload: 'metadata'/)
  assert.match(source, /yxh-video-badge/)
  // 覆盖式进度条 + 百分比 + 重试中提示。
  assert.match(source, /yxh-progress-fill/)
  assert.match(source, /function progressPercent\(value\)/u)
  assert.match(source, /Math\.max\(0, Math\.min\(100, parsed\)\)/u)
  assert.match(source, /retrying/)
  assert.match(source, /uploadedBytes/)
  // not_found 只在「从未收到 done」时置 failed（P2 客户端兜底）。
  assert.match(source, /receivedDone/)
  // 「开始仿写」拦截：本次提交素材组存在上传中素材 → 提示并阻止（P5）。
  assert.match(source, /hasUploading\(/)
  assert.match(source, /uploadingBlock/)
  assert.match(source, /当前照片\/视频正在上传中，等待上传完成/)
  assert.match(source, /Uploading in progress — wait for the current photo\/video to finish uploading\./)
  // 按钮不再因上传中被硬禁用，改 aria-disabled + 置灰。
  assert.match(source, /'aria-disabled': uploadingInGroup/)
  assert.match(source, /yxh-submit-wait/)
  assert.doesNotMatch(source, /disabled: buttonDisabled \|\| uploadingInGroup/)
  // 添加按钮只受容量约束，不再因上传中禁用（并发上传）。
  assert.doesNotMatch(source, /disabled: uploading \|\| locked/)
})

test('uses only DSH alpha3 exported icons', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const imports = source.match(/const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1] || ''
  const exported = await readFile(new URL('../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx', root), 'utf8')
  for (const name of imports.split(',').map(token => token.trim()).filter(token => token.startsWith('Icon'))) {
    assert.match(exported, new RegExp(`export const ${name}\\b`, 'u'))
  }
})

test('announces the initial copy result empty state', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /className: 'yxh-state', role: 'status'/u)
  assert.match(source, /'aria-busy': locked \|\| uploadingInGroup/u)
})

test('prevents duplicate picker, task creation, and cancellation requests', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /const pickingRef = useRef\(false\)/u)
  assert.match(source, /const busyRef = useRef\(false\)/u)
  assert.match(source, /if \(pickingRef\.current \|\| busyRef\.current \|\| processing\) return/u)
  assert.match(source, /if \(busyRef\.current \|\| pickingRef\.current \|\| processing\) return/u)
  assert.match(source, /if \(busyRef\.current \|\| !canCancel\) return/u)
})

test('reports picker failures while keeping user cancellation quiet', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /if \(!picked\) \{\s*setUploadError\(t\('uploadFailed'\)\)/u)
  assert.match(source, /if \(!picked\.picked\) return/u)
  assert.match(source, /if \(!picked\.path\) \{\s*setUploadError\(t\('uploadFailed'\)\)/u)
  assert.match(source, /await uploads\.start\([\s\S]*?\}\)\s*\} catch \{\s*setUploadError\(t\('uploadFailed'\)\)/u)
})

test('uses adaptive foregrounds for brand actions', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /\.yxh-submit\{[^}]*background:var\(--dsw-alias-brand-primary\);color:var\(--dsw-alias-label-primary-foreground\)/u)
  assert.match(source, /\.yxh-confirm-primary\{[^}]*background:var\(--dsw-alias-brand-primary\);color:var\(--dsw-alias-label-primary-foreground\)/u)
})

test('accounts page: hub state machine, page tabs and local-only aggregation', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  // 页面 Tab：爆款仿写 + 账号管理，受控 aria-current。
  assert.match(source, /pageTabAccounts/)
  assert.match(source, /'aria-current': page === 'rewrite' \|\| undefined/)
  assert.match(source, /'aria-current': page === 'accounts' \|\| undefined/)
  assert.match(source, /function AccountsPage/)
  assert.match(source, /function createAccountsHub/)
  assert.match(source, /function AccountStatusBadge/)
  assert.match(source, /function AccountSummary/)
  // hub 走宿主本地动作投影（collect.status 等本地路由），数据只落设备端。
  assert.match(source, /action: 'accounts.list'/)
  assert.match(source, /action: 'account.beginLogin'/)
  assert.match(source, /action: 'account.loginStatus'/)
  assert.match(source, /action: 'account.probe'/)
  assert.match(source, /action: 'account.removeLocal'/)
  assert.match(source, /action: 'collect.start'/)
  assert.match(source, /action: 'collect.status'/)
  // 登录/采集 2s 轮询 + 终态停止；离开账号页停轮询（重新进入恢复）。
  assert.match(source, /const ACCOUNTS_POLL_INTERVAL_MS = 2000/)
  assert.match(source, /accountsHub\.init\(\)/)
  assert.match(source, /accountsHub\.stop\(\)/)
  // 受控错误码只映射为中文文案，不暴露内部错误码。
  assert.match(source, /const ACCOUNT_ERROR_KEYS = \{/)
  assert.match(source, /PROFILE_BUSY: 'profileBusy'/)
  assert.match(source, /CAPTCHA_DETECTED: 'captchaHint'/)
  // probe 同步等浏览器探测：超时须宽于宿主 45s。
  assert.match(source, /action: 'account\.probe'[^\n]*\}, 60_000\)/u)
  // 采集进度展示（pages/notes 聚合）与缺口提示（不补 0）。
  assert.match(source, /collecting'\)\.replace\('\{pages\}'/)
  assert.match(source, /gapHint/)
  // 头像仅 http(s)：宿主已白名单，页面按原样渲染，不做危险协议兜底注入。
  assert.match(source, /yxh-avatar-fallback/)
})

test('publish panel: one-click draft publishing with controlled copy and polling', async () => {
  const clientSource = await readFile(new URL('src/client.js', root), 'utf8')
  // 发布面板组件与结果区集成（单版编辑卡 → 复制/保存 → 发布面板）。
  assert.match(clientSource, /function PublishPanel/)
  assert.match(clientSource, /h\(PublishPanel, \{/)
  assert.match(clientSource, /publishPanel/)
  assert.match(clientSource, /publishAccountLabel/)
  assert.match(clientSource, /publishNoAccount/)
  // 发布 run 轮询：running 时 2s 查询 publish.status，终态停止。
  assert.match(clientSource, /const PUBLISH_POLL_INTERVAL_MS = 2000/)
  assert.match(clientSource, /action: 'publish\.status'/)
  assert.match(clientSource, /action: 'publish\.start'/)
  // 发布请求固定 private（防误发布保险），素材与账号必带。
  assert.match(clientSource, /visibility: 'private'/)
  assert.match(clientSource, /accountId: effectivePublishAccount/)
  // 素材本地原文件路径优先（review M1）：path 直传 + url 兜底，不在页面侧只传 TOS URL。
  assert.match(clientSource, /path: asset\.path \|\| null, url: asset\.url/)
  // 终态失败按受控错误码映射具体原因（review MINOR-1），未映射才落通用文案。
  assert.match(clientSource, /accountErrorKey\(publish\?\.error\) \|\| 'publishFailed'/)
  // 步骤进度映射（dev-implementation §2.1：prepare/open/upload/fill/saveDraft/done）。
  assert.match(clientSource, /PUBLISH_STEP_KEYS = \{/)
  assert.match(clientSource, /publishStepSaveDraft/)
  // 发布失败受控中文文案：不暴露内部错误码（UPLOAD_TIMEOUT 等映射进错误码表）。
  assert.match(clientSource, /UPLOAD_TIMEOUT: 'publishUploadTimeout'/)
  assert.match(clientSource, /SAVE_DRAFT_NO_RESPONSE: 'publishSaveNoResponse'/)
  assert.match(clientSource, /SELECTOR_MISSING: 'publishSelectorMissing'/)
  assert.match(clientSource, /PUBLISH_FAILED: 'publishFailed'/)
  assert.match(clientSource, /publishDone/)
})

test('publish host pipeline: publisher state machine, mutex and humanized delays', async () => {
  const indexSource = await readFile(new URL('index.js', root), 'utf8')
  // publish.start / publish.status 路由注册。
  assert.match(indexSource, /action === 'publish\.start'/)
  assert.match(indexSource, /action === 'publish\.status'/)
  // Profile 互斥：发布 run 持锁，失败/完成 finally 释放。
  assert.match(indexSource, /const publishRuns = new Map\(\)/)
  assert.match(indexSource, /const publishIdempotency = new Map\(\)/)
  assert.match(indexSource, /reason: 'PROFILE_BUSY' \}/)
  // visibility 契约固定 private：显式传其他值即拒绝（本流程只存草稿，无公开发布路径）。
  assert.match(indexSource, /invalid_visibility/)
  assert.match(indexSource, /material_conflict/)
  // 审计 actionCode 与 run 投影。
  assert.match(indexSource, /xhs\.publish\.run/)
  assert.match(indexSource, /function projectPublish/)
  // publisher 模块：拟人化延时表 + CDP pierce + 浏览器保持打开。
  const publisherSource = await readFile(new URL('src/publisher.js', root), 'utf8')
  assert.match(publisherSource, /export const HUMANIZED_DELAYS = \{/)
  assert.match(publisherSource, /uploadToTitle: \[2000, 4000\]/, '素材上传完成→聚焦标题 2–4s（README §5.3 重点缓冲）')
  assert.match(publisherSource, /beforeSaveDraft: \[2000, 4000\]/)
  assert.match(publisherSource, /titleChar: \[80, 160\]/)
  assert.match(publisherSource, /bodyChar: \[50, 120\]/)
  assert.match(publisherSource, /bodySentencePause: \[300, 800\]/)
  // closed Shadow DOM 穿透：CDP pierce + performSearch「暂存离开」+ 0.40 坐标（stage0 §2.3）。
  assert.match(publisherSource, /DOM\.getDocument/, 'pierce 参数见下一断言')
  assert.match(publisherSource, /pierce: true/)
  assert.match(publisherSource, /DOM\.performSearch/)
  assert.match(publisherSource, /暂存离开/)
  assert.match(publisherSource, /hostBox\.x \+ hostBox\.w \* 0\.40/)
  // toast 捕获：MutationObserver + 15s 窗口；未捕获 → SAVE_DRAFT_NO_RESPONSE。
  assert.match(publisherSource, /MutationObserver/)
  assert.match(publisherSource, /SAVE_DRAFT_NO_RESPONSE/)
  // 标题 20 字截断；话题 ≤10；正文清空三连；可见性强制「仅自己可见」。
  assert.match(publisherSource, /TITLE_MAX_CHARS = 20/)
  assert.match(publisherSource, /TAGS_MAX = 10/)
  assert.match(publisherSource, /slice\(0, TITLE_MAX_CHARS\)/)
  assert.match(publisherSource, /slice\(0, TAGS_MAX\)/)
  assert.match(publisherSource, /'Backspace'/)
  assert.match(publisherSource, /'Control\+a'/)
  assert.match(publisherSource, /'Delete'/)
  assert.match(publisherSource, /仅自己可见/)
  // 验证码不绕过（红线）；浏览器保持打开（无 context.close）。
  assert.match(publisherSource, /CAPTCHA_DETECTED/)
  assert.ok(!/\.close\(\)/.test(publisherSource.replace(/\/\/[^\n]*/g, '')), 'publisher 主流程绝不自动关闭浏览器（由用户关闭）')
  // 无反检测内核（红线）：仅 --no-sandbox/--disable-dev-shm-usage（复用 chrome.js LAUNCH_ARGS）。
  // 先剥离注释再检查：红线说明文字本身允许出现在注释里，代码中不允许。
  const publisherCode = publisherSource.replace(/\/\/[^\n]*/g, '')
  assert.ok(!/patchright|stealth|AutomationControlled/i.test(publisherCode), '不引入任何反检测内核')
  // 视频完成信号走保守候选（S-10 待真机校准），不使用「标题框出现」。
  assert.match(publisherSource, /VIDEO_UPLOAD_DONE_SELECTORS/)
})

// RQ-2026-003 DEV-06：车衣爆款看板接入（顶级第三 Tab + 热板 UI + 宿主 14 工具转发）。
test('hotboard client wiring: top tab, hub lifecycle and css injection', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  // 顶级 Tab 第三个入口 + hub 工厂与生命周期：仅看板页激活时 init，切走即 stop（停轮询不清数据）。
  assert.match(source, /pageTabHotboard: '车衣爆款看板'/)
  assert.match(source, /h\('button', \{ type: 'button', 'aria-current': page === 'hotboard' \|\| undefined, onClick: \(\) => setPage\('hotboard'\) \}, t\('pageTabHotboard'\)\)/)
  assert.match(source, /hotboardHubRef\.current = createHotboardHub\(\{ post: body => post\(\{ \.\.\.body \}\) \}\)/)
  assert.match(source, /if \(visible && page === 'hotboard'\) hotboardHub\.init\(\)/)
  assert.match(source, /else hotboardHub\.stop\(\)/)
  // 渲染分支：accounts 优先、hotboard 次之、默认爆款仿写三列网格。
  assert.match(source, /page === 'accounts'\s*\n\s*\? h\(AccountsPage, \{ hub: accountsHub, t \}\)/)
  assert.match(source, /: page === 'hotboard'\s*\n\s*\? h\(HotboardPage, \{ hub: hotboardHub, t \}\)/)
  // 看板样式随主题注入，与主样式同一 textContent（DSW token，无独立主题色）。
  assert.match(source, /css \+ responsiveCss \+ hotboardCss/)
  // 导出 hub 工厂供沙箱测试复用。
  assert.match(source, /createAccountsHub, createHotboardHub \}/)
})

test('hotboard host pipeline: allowlist, confirmation, idempotency, error envelope and audit', async () => {
  const indexSource = await readFile(new URL('index.js', root), 'utf8')
  // 前缀分发在 unknown_action 之前；14 个 action 一一映射 MCP 工具（白名单，无通配转发）。
  assert.match(indexSource, /action\.startsWith\('hotboard\.'\)\) return await handleHotboard\(ctx, body, res, action\)/)
  for (const tool of [
    'xhs_operation_hotboard_overview',
    'xhs_operation_hotboard_note_detail',
    'xhs_operation_hotboard_note_tag_update',
    'xhs_operation_hotboard_keywords_list',
    'xhs_operation_hotboard_keyword_save',
    'xhs_operation_hotboard_settings_get',
    'xhs_operation_hotboard_settings_update',
    'xhs_operation_hotboard_run_start',
    'xhs_operation_hotboard_run_get',
    'xhs_operation_hotboard_candidates_list',
    'xhs_operation_hotboard_candidate_review',
    'xhs_operation_hotboard_labels_list',
    'xhs_operation_hotboard_label_review',
    'xhs_operation_hotboard_label_save',
  ]) assert.match(indexSource, new RegExp(escape(`'${tool}'`), 'u'))
  // OPEN-12：settings 只读分支必须存在且直达 return args（缺 case 或退化为 return null
  // 都会走 default 返 null → 规则页加载稳定报 XHS_HOTBOARD_INVALID_ARGUMENT）。
  assert.match(indexSource, /case 'hotboard\.settings': \{[^}]*?return args\n    \}/)
  // 写操作双闸：confirm 必须显式 true；幂等键必填（确定性校验前置，失败不烧键）。
  assert.match(indexSource, /if \(body\.confirm !== true\) return send\(res, 400, \{ status: 'error', reason: 'confirmation_required' \}\)/)
  assert.match(indexSource, /reason: 'idempotency_key_required'/)
  // 工具未登记（Jenkins 未部署）降级 unavailable，不 500。
  assert.match(indexSource, /const spec = HOTBOARD_ACTIONS\[action\]/)
  assert.match(indexSource, /status: 'unavailable', reason: 'xhs_operation_tool_unavailable' \}/)
  // 参数清洗失败返回受控错误码（不透传 tools 内部信息）。
  assert.match(indexSource, /reason: 'XHS_HOTBOARD_INVALID_ARGUMENT'/)
  // 错误信封收敛：白名单外一律 INTERNAL；信封错误码提取（JSON.parse message）。
  assert.match(indexSource, /function safeHotboardToolError\(error\)/)
  assert.match(indexSource, /return HOTBOARD_ERROR_CODES\.has\(code\) \? code : 'XHS_HOTBOARD_INTERNAL_ERROR'/)
  assert.match(indexSource, /return HOTBOARD_ERROR_CODES\.has\(message\) \? message : 'XHS_HOTBOARD_INTERNAL_ERROR'/)
  // 写投影：只放行受控字段（不透传服务端全量 payload）。
  assert.match(indexSource, /function projectHotboardWrite\(payload\)/)
  // 审计：actionCode 用 op 段、outcome 与错误码落审计。
  assert.match(indexSource, /actionCode: `xhs\.hotboard\.\$\{spec\.op \|\| action\}`/)
  assert.match(indexSource, /await recordHotboardAudit\(ctx, spec, action, idempotencyKey, 'failed', reason, null\)/)
  assert.match(indexSource, /await recordHotboardAudit\(ctx, spec, action, idempotencyKey, 'succeeded', null, runId, payload\)/)
})

test('hotboard ui: four sub pages, run polling and display constraints', async () => {
  const source = await readFile(new URL('src/hotboard-ui.js', root), 'utf8')
  // 四个二级页签（案例看板/关键词与扩词/标签与 AI 标记/采集与规则）。
  for (const token of ["{ id: 'board', key: 'hbSubBoard' }", "{ id: 'keywords', key: 'hbSubKeywords' }", "{ id: 'tags', key: 'hbSubTags' }", "{ id: 'rules', key: 'hbSubRules' }"]) {
    assert.match(source, new RegExp(escape(token), 'u'))
  }
  // run 轮询与 tools 同口径：活跃态集合 + 2s 轮询 + 终态停轮询；请求超时 30s。
  assert.match(source, /const ACTIVE_RUN_STATUSES = new Set\(\['queued', 'collecting', 'deduplicating', 'scoring', 'tagging'\]\)/)
  assert.match(source, /const RUN_POLL_INTERVAL_MS = 2000/)
  assert.match(source, /const HB_REQUEST_TIMEOUT_MS = 30000/)
  // 二级页切换保留筛选草稿（filters/pages 用默认工厂初始化进 hub 快照，切页不重置）。
  assert.match(source, /filters: defaultFilters\(\)/)
  assert.match(source, /pages: defaultPage\(\)/)
  // OPEN-11 B1：默认窗口 90d（搜索召回偏存量笔记 30d 常空，用户可手动切 7d/30d）。
  assert.match(source, /board: \{ window: '90d', keyword: '', style: '', color: '', noteWord: '', commentWord: '', scoreMin: '', scoreMax: '', sort: 'score', onlyMain: true, onlyTagged: false \}/)
  assert.match(source, /settingsDirty:/)
  // 图片加载失败占位（onError 记入 broken 集合），不无限重试。
  assert.match(source, /onError: \(\) => markBroken\(url\)/)
  assert.match(source, /yxh-hb-image-broken/)
  // 确认弹窗 + 待办数刷新（写操作后重拉待办徽标）。
  assert.match(source, /function ConfirmDialog/)
  assert.match(source, /async function refreshTodos\(\)/)
  // 展示约束（实施文档 §13.3）：不显示真实互动率；无 V7/蒲公英入口。
  // 先剥离注释再断言：约束说明文字本身允许写在注释里，代码与文案中不允许。
  const hbCode = source.replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(hbCode, /interactionRate|互动率|ctr|cvr/i)
  assert.doesNotMatch(hbCode, /蒲公英|\bV7\b/)
})
