// 视频号工作台页面侧（视觉与交互基准：docs/1109/wx/ui-demo.html，§9.0）。
// 页面只访问本地同源路由 /api/desktop/yootun/wx-channels-operation（§4.1）：
// 不读取 MODELS_API_KEY、不直连公网 MCP、不接收 Cookie/内部地址/原始传输错误。
// 采集由宿主设备端执行；这里只做编排（登录/采集/批量）与展示。

const React = require('react')
const { createElement: h } = React
const { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = React
const { IconCloseOutlineRegular, IconSparkleRegular, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

import {
  DEFAULT_SORT_STATE,
  latestCollectedAt,
  nextSortState,
  refreshResultLabel,
  shouldApplyResponse,
  sortWorks,
} from './ui-format.js'
import { WorkDetailDialog, WorkSummaryCards, WorkTable, WorkToolbar } from './work-ui.js'
import { AccountList, AccountTab, WINDOWS } from './account-ui.js'

const ROUTE = '/api/desktop/yootun/wx-channels-operation'
const POLL_INTERVAL_MS = 1200

// 左下角侧栏入口 + 整页 overlay（对齐抖音 yootun 系插件机制）：
// OVERLAY_EVENT 为宿主 overlay 共享互斥事件（打开自身时通知其他 overlay 关闭）。
const OVERLAY_ID = '@dofe/dsh-yootun-wx-channels-operation'
const OVERLAY_EVENT = 'dofe:yootun-overlay:open'

let opened = false
const openListeners = new Set()
const subscribeOpen = listener => {
  openListeners.add(listener)
  return () => openListeners.delete(listener)
}
const snapshotOpen = () => opened
function setOpened(next) {
  opened = next
  for (const listener of openListeners) listener(next)
}
function openOverlay(event) {
  // 记录触发元素，关闭后恢复焦点。
  overlayTrigger = event?.currentTarget || document.activeElement
  window.dispatchEvent(new CustomEvent(OVERLAY_EVENT))
  setOpened(true)
}
function closeOtherOverlay() {
  if (opened) setOpened(false)
}
let overlayTrigger = null
// 页面端全部 action 都是宿主立即返回的快操作（长动作在宿主异步执行、页面轮询）。
const REQUEST_TIMEOUT_MS = 30000

const STYLES = `
/* 变量映射挂在插件根节点（.ywc-overlay/.ywc-root），不能放 :root：
   真机宿主把 --dsw-alias-* 定义在应用容器上而非 html，:root 处求值
   拿不到会让全部 --ywc-* 失效（2026-11-10 真机样式散架根因）。
   兜底值与 ui-demo.html 一致（浅色默认 + prefers-color-scheme 深色）。 */
.ywc-overlay, .ywc-root {
  --ywc-bg: var(--dsw-alias-bg-base, #ffffff);
  --ywc-surface: var(--dsw-alias-bg-layer-1, #f6f7f9);
  --ywc-surface-2: var(--dsw-alias-bg-layer-2, #eceef1);
  --ywc-text: var(--dsw-alias-label-primary, #1f2329);
  --ywc-muted: var(--dsw-alias-label-secondary, #646a73);
  --ywc-border: var(--dsw-alias-border-l1, #e0e3e8);
  --ywc-brand: var(--dsw-alias-brand-primary, #0f1115);
  /* hover 色按主题显式定义：浅色主题 brand 近黑，混黑看不出变化（review P2-2）。 */
  --ywc-brand-hover: color-mix(in srgb, var(--ywc-brand) 82%, white);
  --ywc-brand-soft: color-mix(in srgb, var(--ywc-brand) 10%, transparent);
  --ywc-brand-line: color-mix(in srgb, var(--ywc-brand) 62%, white);
  --ywc-brand-border: color-mix(in srgb, var(--ywc-brand) 28%, transparent);
  --ywc-brand-text: var(--dsw-alias-label-primary-foreground, #ffffff);
  --ywc-danger: var(--dsw-alias-state-error-primary, #d03a3a);
  --ywc-success: var(--dsw-alias-state-success-primary, #1a7f37);
}
@media (prefers-color-scheme: dark) {
  .ywc-overlay, .ywc-root {
    --ywc-bg: var(--dsw-alias-bg-base, #151517);
    --ywc-surface: var(--dsw-alias-bg-layer-1, #232324);
    --ywc-surface-2: var(--dsw-alias-bg-layer-2, #2c2c2e);
    --ywc-text: var(--dsw-alias-label-primary, #fafafa);
    --ywc-muted: var(--dsw-alias-label-secondary, #b4b4b4);
    --ywc-border: var(--dsw-alias-border-l1, rgba(255,255,255,.10));
    --ywc-brand: var(--dsw-alias-brand-primary, #e9e9e9);
    /* 深色主题 brand 近白，hover 压暗。 */
    --ywc-brand-hover: color-mix(in srgb, var(--ywc-brand) 88%, black);
    --ywc-brand-text: var(--dsw-alias-label-primary-foreground, #343434);
    --ywc-danger: var(--dsw-alias-state-error-primary, #e0524a);
    --ywc-success: var(--dsw-alias-state-success-primary, #4ade80);
  }
}
/* 字体体系对齐抖音工作台：基线 14px / 次级 13px / 页标题 20px / 面板标题 16px，
   一律用宿主字体变量（真机缺失时回退同值字面量），不自行创造字号。 */
.ywc-root { height:100vh; color:var(--ywc-text); font-size:var(--dsh-content-font-size,14px); }
.ywc-overlay { position:fixed; inset:0; z-index:520; background:var(--ywc-bg); color:var(--ywc-text); overflow:hidden; font-size:var(--dsh-content-font-size,14px); }
.ywc-sidebar-button { display:flex; width:36px; height:36px; align-items:center; justify-content:center; gap:8px; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; }
.ywc-sidebar-button:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
.ywc-shell { height:100vh; display:flex; flex-direction:column; overflow:hidden; }
.ywc-header{min-height:72px; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:14px 24px; border-bottom:1px solid var(--ywc-border); background: color-mix(in srgb, var(--ywc-surface) 88%, transparent); backdrop-filter: blur(14px); box-shadow: 0 1px 24px color-mix(in srgb, var(--ywc-text) 7%, transparent); }
.ywc-title { display:flex; align-items:center; gap:12px; min-width:0; }
.ywc-mark{width:36px;height:36px; flex:0 0 auto; display:grid; place-items:center; border-radius:8px; background: color-mix(in srgb, var(--ywc-brand) 16%, transparent); color: var(--ywc-brand); font-weight:800; }
.ywc-title h1 { margin:0; font-size:var(--dsw-font-l-20-font-size,20px); line-height:1.25; }
.ywc-title p { margin:6px 0 0; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-header-actions { display:flex; align-items:center; gap:8px; }
.ywc-tabs { display:flex; gap:4px; padding:0 24px; background: color-mix(in srgb, var(--ywc-surface) 86%, transparent); backdrop-filter: blur(12px); border-bottom:1px solid var(--ywc-border); overflow-x:auto; }
.ywc-tab { height:44px; padding:0 18px; border:0; border-bottom:3px solid transparent; background:transparent; color:var(--ywc-muted); font:inherit; font-size:var(--dsh-content-font-size,14px); font-weight:650; white-space:nowrap; cursor:pointer; }
.ywc-tab:hover { color: var(--ywc-text); }
.ywc-tab[aria-selected="true"] { color:var(--ywc-text); border-bottom-color: var(--ywc-brand-line); background: linear-gradient(180deg, transparent 68%, color-mix(in srgb, var(--ywc-brand) 9%, transparent)); }
.ywc-body { flex:1; min-height:0; display:grid; grid-template-columns:280px minmax(0,1fr); gap:16px; padding:16px 24px 24px;  overflow:hidden; }
.ywc-shell[data-tab="account"] .ywc-body { grid-template-columns: minmax(0,1fr); }
.ywc-shell[data-tab="account"] .ywc-accounts { display:none; }
.ywc-accounts { display:flex; flex-direction:column; gap:10px; min-width:0; }
.ywc-panel { border:1px solid var(--ywc-border); border-radius:8px; background: color-mix(in srgb, var(--ywc-surface) 92%, transparent); backdrop-filter: blur(12px); box-shadow: 0 10px 34px color-mix(in srgb, var(--ywc-text) 6%, transparent); }
.ywc-side-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 12px 0; }
.ywc-side-head h2 { margin:0; font-size:var(--dsw-font-base-16-font-size,16px); }
.ywc-account-list { display:flex; flex-direction:column; gap:8px; padding:10px 12px 12px; }
.ywc-card { border:1px solid var(--ywc-border); border-radius:8px; background: color-mix(in srgb, var(--ywc-surface) 94%, transparent); text-align:left; padding:0; overflow:hidden; }
.ywc-card[aria-current="true"] { border-color: color-mix(in srgb, var(--ywc-brand) 60%, var(--ywc-border)); }
.ywc-card[aria-current="true"] .ywc-card-main { background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 8%, transparent), transparent 68%); }
.ywc-card-main { width:100%; display:grid; grid-template-columns:36px minmax(0,1fr); gap:10px; align-items:center; border:0; background:transparent; padding:10px; text-align:left; color:inherit; cursor:pointer; }
.ywc-card-main:hover { background: var(--ywc-surface-2); }
.ywc-avatar { width:36px; height:36px; display:grid; place-items:center; border-radius:50%; background: color-mix(in srgb, var(--ywc-brand) 18%, var(--ywc-surface-2)); color:var(--ywc-brand); font-weight:700; }
.ywc-card-name { display:block; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
.ywc-card-meta { display:block; margin-top:2px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-state { display:inline-flex; align-items:center; gap:5px; margin-top:5px; font-size:var(--dsh-content-font-size-secondary,13px); color:var(--ywc-muted); }
.ywc-state::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; }
.ywc-state[data-state="ok"] { color:var(--ywc-success); }
.ywc-state[data-state="expired"] { color:var(--ywc-danger); }
.ywc-card-actions { display:flex; border-top:1px solid var(--ywc-border); background:var(--ywc-surface); }
.ywc-mini-button { flex:1; min-height:30px; border:0; background:transparent; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); cursor:pointer; }
.ywc-mini-button:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
.ywc-mini-button:disabled { opacity:.5; cursor:default; }
.ywc-mini-button:disabled:hover { background:transparent; color:var(--ywc-muted); }
.ywc-mini-button.danger:hover { color:var(--ywc-danger); }
.ywc-mini-button.danger:disabled:hover { color:var(--ywc-muted); }
.ywc-button { min-height:34px; display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:0 12px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-text); white-space:nowrap; cursor:pointer; }
.ywc-button:hover { background:var(--ywc-surface-2); }
.ywc-button.primary { border-color: color-mix(in srgb, var(--ywc-brand) 72%, white); background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 88%, white), var(--ywc-brand)); color: var(--ywc-brand-text); font-weight:650; box-shadow: 0 6px 18px color-mix(in srgb, var(--ywc-brand) 20%, transparent); }
.ywc-button.primary:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 78%, white), color-mix(in srgb, var(--ywc-brand) 92%, black)); }
.ywc-button:disabled { opacity:.45; cursor:default; }
.ywc-button:disabled:hover { background:var(--ywc-surface); }
.ywc-button.primary:disabled:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 88%, white), var(--ywc-brand)); }
.ywc-primary { min-height:40px; padding:0 16px; border:0; border-radius:6px; background:var(--ywc-brand); color:var(--ywc-brand-text); font-weight:600; cursor:pointer; }
.ywc-primary:hover { background: var(--ywc-brand-hover); }
.ywc-primary:disabled { opacity:.45; cursor:default; }
.ywc-primary:disabled:hover { background:var(--ywc-brand); }
.ywc-wide { width:100%; }
.ywc-batch-panel { display:grid; gap:4px; padding:10px 12px; border:1px solid var(--ywc-border); border-radius:8px; background:var(--ywc-surface-2); min-width:0; }
.ywc-batch-panel p { margin:0; font-size:var(--dsh-content-font-size-secondary,13px); color:var(--ywc-text); }
.ywc-batch-detail { display:grid; gap:2px; padding-top:4px; border-top:1px solid var(--ywc-border); }
.ywc-batch-item { display:flex; justify-content:space-between; gap:12px; font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-batch-item-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ywc-batch-item-reason { flex:none; color:var(--ywc-muted); }
.ywc-progress { display:flex; align-items:center; gap:8px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-spinner { width:16px; height:16px; flex:none; border:2px solid var(--ywc-border); border-top-color:var(--ywc-brand); border-radius:50%; animation:ywc-spin .8s linear infinite; }
@keyframes ywc-spin { to { transform:rotate(360deg); } }
.ywc-hint { margin:0; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); line-height:1.5; }
.ywc-ok { margin:0; color:var(--ywc-success); font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-error { margin:0; color:var(--ywc-danger); font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-warn { margin:0; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
/* 36px 图标按钮基线（契约审计 canonical icon 基线；弹层关闭/头部关闭钮复用，对齐 ydo-header-buttons）。 */
.ywc-icon{width:36px;height:36px; display:grid; place-items:center; padding:0; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-muted); cursor:pointer; }
.ywc-icon:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
.ywc-right { min-width:0; min-height:0; display:flex; flex-direction:column; gap:12px; overflow:hidden; }
.ywc-right .ywc-work-panel { flex:1; min-height:0; display:flex; flex-direction:column; }
.ywc-right .ywc-work-panel .ywc-table-wrap { flex:1; }
.ywc-right .ywc-account-page { flex:1; min-height:0; overflow:auto; }
/* 工具栏纵向布局（2026-11-11 真机反馈）：第一行按钮组、第二行采集进度行（按钮下方）。 */
.ywc-toolbar { display:flex; flex-direction:column; align-items:stretch; gap:8px; padding:12px; }
.ywc-toolbar-left, .ywc-toolbar-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
/* 最近采集时间（2026-11-12 真机反馈）：刷新按钮后的单值提示，不占表格列。 */
.ywc-toolbar-note { color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); white-space:nowrap; }
.ywc-field { display:inline-flex; align-items:center; gap:6px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-input, .ywc-select { min-height:36px; padding:0 10px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-text); font:inherit; font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-select { cursor:pointer; }
.ywc-input { cursor:text; }
.ywc-summary-grid, .ywc-kpi-grid { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:10px; padding:12px; }
.ywc-kpi { min-height:78px; padding:10px; border:1px solid var(--ywc-border); border-radius:8px; position:relative; overflow:hidden; background: linear-gradient(160deg, color-mix(in srgb, var(--ywc-brand) 4%, var(--ywc-surface)), var(--ywc-surface) 62%); }
.ywc-kpi::after { content:""; position:absolute; inset:0 0 auto; height:2px; background: linear-gradient(90deg, transparent, var(--ywc-brand-line), transparent); opacity:.55; }
.ywc-kpi-label { color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-kpi-value { margin-top:8px; font-size:20px; font-weight:650; font-variant-numeric: tabular-nums; letter-spacing:-.02em; }
.ywc-kpi-hint { margin-top:3px; color:var(--ywc-muted); font-size:12px; }
.ywc-table-wrap { overflow:auto; min-height:0; border-top:1px solid var(--ywc-border); }
/* 表头排序按钮（对齐 ydo-sort）：整格可点击，箭头 ↕/↓/↑，激活列高亮。 */
.ywc-sort { display:flex; width:100%; align-items:center; gap:4px; min-width:0; padding:0; border:0; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.ywc-sort-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ywc-sort-arrow { flex:none; min-width:12px; color:var(--ywc-muted); }
.ywc-sort-active { color:var(--ywc-text); }
.ywc-sort-active .ywc-sort-arrow { color:var(--ywc-brand); }
/* 空态（对齐 ydo-state）：无数据时不渲染表格框架，只显示居中提示。 */
.ywc-table-state { display:grid; min-height:200px; flex:1; place-items:center; align-content:center; gap:10px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size,14px); text-align:center; }
.ywc-table-state p { margin:0; max-width:640px; line-height:1.6; }
/* 作品列表（2026-11-11 真机反馈）：无操作列（双击行开详情）、无 ID 副行，列宽收紧
 * 但单元格保持 nowrap 不换行；整行 cursor:pointer 提示可双击。 */
.ywc-table { min-width:1360px; width:100%; border-collapse:collapse; }
.ywc-table th, .ywc-table td { padding:9px 10px; border-bottom:1px solid var(--ywc-border); text-align:left; white-space:nowrap; font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-table th { position:sticky; top:0; z-index:1; background: color-mix(in srgb, var(--ywc-brand) 5%, var(--ywc-surface-2)); color:var(--ywc-muted); font-weight:600; }
.ywc-table tbody tr { cursor:pointer; }
.ywc-table tbody tr:hover { background: color-mix(in srgb, var(--ywc-brand) 6%, transparent); }
.ywc-work-cell { display:grid; grid-template-columns:54px minmax(180px,240px); gap:10px; align-items:center; }
/* 封面（对齐抖音 WorkCover）：img 铺满 + 右下角时长角标；失败/缺失占位「封面」。 */
.ywc-cover { position:relative; width:54px; height:72px; display:grid; place-items:center; border-radius:5px; overflow:hidden; background:var(--ywc-surface-2); color:var(--ywc-muted); font-size:12px; text-align:center; flex:none; }
.ywc-cover-large { width:110px; height:146px; border-radius:7px; }
.ywc-cover-img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
.ywc-cover-fallback-text { padding:0 4px; }
.ywc-cover-duration { position:absolute; right:3px; bottom:3px; padding:1px 4px; border-radius:3px; background:rgba(0,0,0,.65); color:#fff; font-size:12px; }
.ywc-work-title { min-width:0; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:650; color:inherit; text-decoration:none; }
a.ywc-work-title:hover { text-decoration:underline; color:var(--ywc-brand); }
.ywc-empty { color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-account-page { display:flex; flex-direction:column; gap:12px; }
.ywc-section-title { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 12px 0; }
.ywc-section-title h3 { margin:0; font-size:var(--dsh-content-font-size,14px); }
.ywc-window-group { display:inline-flex; border:1px solid var(--ywc-border); border-radius:6px; overflow:hidden; }
.ywc-window-group button { min-height:30px; padding:0 10px; border:0; background:var(--ywc-surface); color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); cursor:pointer; }
.ywc-window-group button:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
.ywc-window-group button[aria-selected="true"] { background: color-mix(in srgb, var(--ywc-brand) 12%, var(--ywc-surface)); color:var(--ywc-brand); font-weight:700; box-shadow: inset 0 -2px 0 var(--ywc-brand-line); }
.ywc-two-column { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr); gap:12px; }
.ywc-chart-body { padding:12px; }
.ywc-chart-legend { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:6px; color:var(--ywc-muted); font-size:12px; }
.ywc-chart-legend i { display:inline-block; width:10px; height:3px; margin-right:5px; vertical-align:middle; background:var(--ywc-brand); }
/* 趋势图容器与 hover 浮层（2026-11-11 真机反馈：参考官方后台，鼠标移动显示各指标数值）。 */
.ywc-chart-wrap { position:relative; }
.ywc-chart-tooltip { position:absolute; top:8px; transform:translateX(-50%); min-width:132px; padding:8px 10px; border-radius:8px;
  background:var(--ywc-surface); border:1px solid var(--ywc-border); box-shadow:0 6px 20px rgba(15,23,42,.12);
  pointer-events:none; font-size:12px; color:var(--ywc-text); z-index:2; }
.ywc-chart-tooltip-day { margin-bottom:4px; color:var(--ywc-muted); font-size:11px; }
.ywc-chart-tooltip-row { display:flex; align-items:center; gap:6px; line-height:18px; }
.ywc-chart-tooltip-row i { display:inline-block; width:7px; height:7px; border-radius:50%; flex:none; }
.ywc-chart-tooltip-name { flex:1; }
.ywc-chart-tooltip-value { font-variant-numeric:tabular-nums; font-weight:600; }
/* height:auto 让 SVG 按 viewBox 比例自适应：固定 height 会让宽视口下的图形被
   「信箱化」缩小并水平居中（2026-11-11 review）。 */
.ywc-svg { display:block; width:100%; height:auto; }
.ywc-bars { display:grid; gap:8px; padding:12px; }
.ywc-bar-row { display:grid; grid-template-columns:84px minmax(0,1fr) 62px; gap:8px; align-items:center; font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-bar-track { height:8px; border-radius:4px; background:var(--ywc-surface-2); overflow:hidden; }
.ywc-bar-fill { height:100%; border-radius:4px; background: linear-gradient(90deg, color-mix(in srgb, var(--ywc-brand) 62%, transparent), var(--ywc-brand-line)); box-shadow: 0 0 12px color-mix(in srgb, var(--ywc-brand) 18%, transparent); }
.ywc-bar-value { text-align:right; color:var(--ywc-muted); }
/* 关注者画像卡片组（2026-11-11 真机反馈）：去 Tab 切换，同屏卡片布局——
 * 性别/设备环形图（中心总人数）+图例、年龄柱状图（柱顶百分比）、省市横向条形两列卡。 */
.ywc-profile-grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; padding:12px; }
.ywc-profile-grid-2 { grid-template-columns:repeat(2, minmax(0,1fr)); }
.ywc-profile-card { min-width:0; padding:12px; border:1px solid var(--ywc-border); border-radius:8px; background: color-mix(in srgb, var(--ywc-surface) 94%, transparent); }
.ywc-profile-card-title { margin-bottom:10px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
.ywc-donut-row { display:flex; align-items:center; gap:14px; }
.ywc-donut { position:relative; width:112px; height:112px; flex:none; border-radius:50%; }
.ywc-donut-hole { position:absolute; inset:20px; display:grid; place-content:center; justify-items:center; gap:1px; border-radius:50%; background:var(--ywc-surface); text-align:center; }
.ywc-donut-hole b { font-size:16px; font-weight:650; font-variant-numeric: tabular-nums; }
.ywc-donut-hole i { font-style:normal; color:var(--ywc-muted); font-size:12px; }
.ywc-donut-legend { display:grid; gap:6px; margin:0; padding:0; list-style:none; color:var(--ywc-text); font-size:var(--dsh-content-font-size-secondary,13px); min-width:0; }
.ywc-donut-dot { display:inline-block; width:8px; height:8px; margin-right:6px; border-radius:2px; vertical-align:middle; }
.ywc-col-chart { display:flex; align-items:stretch; gap:8px; height:150px; padding-top:4px; }
.ywc-col { flex:1; min-width:0; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px; }
.ywc-col-value { color:var(--ywc-text); font-size:12px; font-variant-numeric:tabular-nums; }
.ywc-col-bar { width:56%; min-height:4px; border-radius:3px 3px 0 0; background: linear-gradient(180deg, color-mix(in srgb, var(--ywc-brand) 62%, transparent), var(--ywc-brand-line)); }
.ywc-col-label { color:var(--ywc-muted); font-size:12px; white-space:nowrap; }
.ywc-modal { position:fixed; inset:0; z-index:20; display:none; place-items:center; padding:24px; background:rgba(31,35,41,.42); backdrop-filter:blur(8px); }
.ywc-modal.open { display:grid; }
.ywc-dialog { width:min(1080px,100%); max-height:calc(100vh - 48px); overflow:auto; border:1px solid var(--ywc-border); border-radius:8px; background:var(--ywc-surface); box-shadow:0 24px 72px rgba(0,0,0,.22); }
.ywc-dialog-header { position:sticky; top:0; z-index:2; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid var(--ywc-border); background:var(--ywc-surface); }
.ywc-dialog-header h2, .ywc-dialog-header h3 { margin:0; }
.ywc-dialog-body { display:grid; gap:12px; padding:14px 16px 18px; }
/* 详情头部（2026-11-11 真机反馈）：封面 + 元信息一行，KPI 卡片移出头部、
 * 以 ywc-metric-grid 铺满整行（左右填满）。 */
.ywc-dialog-grid { display:grid; grid-template-columns:110px minmax(0,1fr); gap:14px; align-items:center; }
.ywc-dialog-meta { min-width:0; display:grid; gap:6px; }
.ywc-dialog-meta p { margin:0; }
.ywc-metric-grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px; }
.ywc-detail-section { border-top:1px dashed var(--ywc-border); padding-top:10px; }
.ywc-detail-section h4 { margin:0 0 8px; font-size:var(--dsh-content-font-size,14px); }
.ywc-close { width:32px; height:32px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-muted); cursor:pointer; }
.ywc-close:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
.ywc-note { padding:0 16px 16px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); line-height:1.7; }
.ywc-badge { display:inline-flex; align-items:center; min-height:22px; padding:0 7px; border-radius:4px; background:var(--ywc-surface-2); color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
/* 窄屏（对齐抖音 1120 断点行为）：body 纵向滚动，表格区域固定 60vh 内滚。 */
@media (max-width:1080px) { .ywc-body { display:block; overflow:auto; } .ywc-right { overflow:visible; } .ywc-right .ywc-work-panel .ywc-table-wrap { max-height:60vh; } .ywc-summary-grid, .ywc-kpi-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .ywc-two-column { grid-template-columns:1fr; } .ywc-dialog-grid { grid-template-columns:1fr; } .ywc-profile-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:680px) { .ywc-header, .ywc-body, .ywc-tabs { padding-left:12px; padding-right:12px; } .ywc-summary-grid, .ywc-kpi-grid, .ywc-metric-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .ywc-profile-grid { grid-template-columns:1fr; } .ywc-title p { display:none; } }
`

function useHost() {
  return useCallback(async (action, payload = {}) => {
    const response = await fetch(ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })
    if (!response.ok) throw new Error(`http_${response.status}`)
    const payloadJson = await response.json()
    if (payloadJson && payloadJson.status === 'error') {
      throw new Error(String(payloadJson.reason || 'request_failed'))
    }
    return payloadJson
  }, [])
}

// 跨会话持久化（2026-11-13 首屏性能）：localStorage 存「上次选中账号 + 各账号作品
// 列表」，下次打开工作台首屏 0 往返渲染上次数据、后台并行刷新覆盖。只存页面本就
// 展示的业务数据，不触碰 Cookie/凭据/内部地址（§4.1 安全边界）。SSR/静态渲染无
// localStorage 直接跳过（测试环境行为不变）。
const STORAGE = typeof localStorage !== 'undefined' ? localStorage : null
const storageGet = key => {
  if (!STORAGE) return null
  try { return STORAGE.getItem(key) } catch { return null }
}
const storageSet = (key, value) => {
  if (!STORAGE) return
  try { STORAGE.setItem(key, value) } catch { /* 配额满静默跳过：缓存属增强，不是功能依赖 */ }
}
const storageRemove = key => {
  if (!STORAGE) return
  try { STORAGE.removeItem(key) } catch { /* 同上 */ }
}
const worksStorageKey = accountId => `ywc:works:${accountId}`
const loadPersistedWorks = accountId => {
  const raw = storageGet(worksStorageKey(accountId))
  if (!raw) return null
  try {
    const rows = JSON.parse(raw)
    return Array.isArray(rows) ? rows : null
  } catch { return null }
}
const loadLastAccountId = () => storageGet('ywc:last-account-id')

/** 侧栏入口按钮（左下角菜单；wide 模式带文字，对齐抖音 Button）。 */
function SidebarButton({ wide }) {
  return h(Tooltip, { label: '打开视频号工作台', disabled: wide },
    h('button', {
      type: 'button',
      className: `ywc-sidebar-button${wide ? ' ywc-wide' : ''}`,
      'aria-label': '打开视频号工作台',
      onClick: openOverlay,
    },
      h(IconSparkleRegular, { size: wide ? 14 : 18 }),
      wide ? h('span', null, '视频号工作台') : null,
    ))
}

/** 整页 overlay：可见时渲染工作台；关闭后恢复触发焦点。 */
function Overlay() {
  const visible = useSyncExternalStore(subscribeOpen, snapshotOpen, snapshotOpen)
  useEffect(() => {
    if (!visible) return
    const previous = typeof document !== 'undefined' ? document.activeElement : null
    return () => {
      const lastTrigger = overlayTrigger
      if (lastTrigger && typeof lastTrigger.focus === 'function') {
        requestAnimationFrame(() => lastTrigger?.focus?.())
      } else if (previous && typeof previous.focus === 'function') {
        previous?.focus?.()
      }
    }
  }, [visible])
  if (!visible) return null
  return h('div', { className: 'ywc-overlay' }, h(WxWorkbench, { host: null }))
}

/** 宿主 client 接线：字典跳过（文案硬编码中文）、样式与侧栏/overlay 槽位注册。 */
function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = OVERLAY_ID
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dofe-yootun-wx-channels-operation: styles')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: OVERLAY_ID, order: 44, inject: () => ({}) }, SidebarButton))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: OVERLAY_ID, order: 44, inject: () => ({}) }, Overlay))
  // 共享互斥契约：其他 yootun overlay 打开时关闭自身。
  ctx.effect(() => {
    window.addEventListener(OVERLAY_EVENT, closeOtherOverlay)
    return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay)
  }, 'dofe-yootun-wx-channels-operation: exclusive-overlay')
}

/** 渲染工作台。`initial` 供静态渲染/截图/测试注入首屏真实数据
 * （renderToString 不执行 useEffect，宿主运行时不传 initial 走正常加载）。 */
export function renderWxWorkbench({ host, initial }) {
  return h(WxWorkbench, { host, initial })
}

function WxWorkbench({ host, initial = null }) {
  const post = host || useHost()
  const [browserReady, setBrowserReady] = useState({ chrome: true, driver: true })
  const [accounts, setAccounts] = useState((initial && initial.accounts) || [])
  const [selectedId, setSelectedId] = useState(
    (initial && initial.selectedId) ||
      ((initial && initial.accounts || []).find(item => item.deleteState !== 'remote_deleted') || {}).accountId ||
      // 无 initial（宿主真实运行）时沿用上次会话选中的账号：works 请求可立即发出、
      // 与 accounts.list 并行，不必等账号列表回来再串行一段（2026-11-13 首屏性能）。
      // 账号若已删除，accounts.list 回来后 refreshAccounts 的校验会自动切到列表第一个。
      (initial ? null : loadLastAccountId()),
  )
  const [tab, setTab] = useState((initial && initial.tab) || 'work')
  const [works, setWorks] = useState((initial && initial.works) || [])
  const [overview, setOverview] = useState((initial && initial.overview) || null)
  // 摘要卡独立快照：固定 last_7d（§9.2 摘要卡口径不随账号 Tab 窗口切换变化）。
  const [summaryOverview, setSummaryOverview] = useState(
    initial && initial.summaryOverview !== undefined ? initial.summaryOverview : initial ? initial.overview : null,
  )
  const [profile, setProfile] = useState((initial && initial.profile) || null)
  const [windowKey, setWindowKey] = useState((initial && initial.windowKey) || 'last_7d')
  // 表头排序（对齐抖音）：{key, direction} 三态循环，客户端排序只作用于已入库数据。
  const [sort, setSort] = useState(DEFAULT_SORT_STATE)
  const [detail, setDetail] = useState((initial && initial.detail) || null)
  const [detailDaily, setDetailDaily] = useState((initial && initial.detailDaily) || [])
  // 登录进行中状态（不再渲染二维码弹层）：驱动「添加账号」按钮的禁用与文案。
  const [login, setLogin] = useState(null)
  const [batch, setBatch] = useState(null)
  const [notice, setNotice] = useState(null)
  const [confirm, setConfirm] = useState(null)
  // 删除生命周期（对齐抖音 DELETE_LIFECYCLE 语义）：弹确认 = awaiting_confirmation；
  // 确认后远端删除执行中 = confirmed_pending_adapter（§16.2 删除状态机）。
  const [deleteLifecycle, setDeleteLifecycle] = useState(null)
  const [collectBusy, setCollectBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // 首屏加载态（2026-11-12 真机反馈）：账号列表与首次作品查询期间显示加载中，
  // 不再用「暂无已入库作品」空态冒充加载中（两者外观一致，用户以为卡住）。
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [worksLoading, setWorksLoading] = useState(false)
  // 账号总览页加载态（2026-11-13 真机反馈）：切账号 / 切窗口期间数据被清空，
  // 数据区显示「正在加载数据…」蒙板（对齐作品数据页加载态），不闪空卡。
  const [overviewLoading, setOverviewLoading] = useState(false)
  // 刷新提示就地显示在工具栏（采集按钮下方，与进度行同一位置），不进顶部通知条
  // （2026-11-11 真机反馈）。
  const [refreshMessage, setRefreshMessage] = useState(null)
  // 单账号采集状态投影（宿主 collect.status 的 collect 字段）：工具栏进度行数据源
  // （对齐抖音 collect 投影）。单槽——互斥保证同时只有一个采集；渲染时按 accountId
  // 比对，切走账号不显示他人进度。
  const [collect, setCollect] = useState(null)

  const selected = useMemo(
    () => accounts.find(account => account.accountId === selectedId) || null,
    [accounts, selectedId],
  )
  const visibleWorks = useMemo(() => sortWorks(works, sort), [works, sort])

  const noticeTimer = useRef(null)
  const notify = useCallback(message => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  const refreshAccounts = useCallback(async () => {
    const startedAt = Date.now()
    const result = await post('accounts.list')
    console.info(`[yootun-wx] accounts.list ${Date.now() - startedAt}ms`)
    const rows = Array.isArray(result.accounts) ? result.accounts : []
    setAccounts(rows)
    setSelectedId(current => {
      if (current && rows.some(item => item.accountId === current)) return current
      const firstUsable = rows.find(item => item.deleteState !== 'remote_deleted')
      return firstUsable ? firstUsable.accountId : null
    })
    return rows
  }, [post])

  // 会话内作品列表缓存（SWR，对齐抖音 worksCacheRef）：同一账号再次进入先渲染
  // 缓存（秒开），后台刷新覆盖；刷新失败保留旧数据不打断浏览。
  const worksCacheRef = useRef(null)
  if (!worksCacheRef.current) {
    worksCacheRef.current = new Map()
    // 上次账号的作品列表预热进会话缓存：首屏 refreshWorks 命中即渲染（0 往返），
    // 后台刷新覆盖。仅宿主运行时（无 initial 注入）生效（2026-11-13 首屏性能）。
    if (!initial) {
      const lastId = loadLastAccountId()
      const persisted = lastId ? loadPersistedWorks(lastId) : null
      if (lastId && persisted) worksCacheRef.current.set(lastId, persisted)
    }
  }
  const worksRequestRef = useRef(0)
  const overviewRequestRef = useRef(0)
  // 总览会话内缓存（2026-11-13 性能优化）：键 `${accountId}:${window}`，值
  // {summary, overview, profile}；账号页来回切换命中即秒开（SWR）。overlay 卸载随组件丢弃。
  const overviewCacheRef = useRef(new Map())
  // 当前选中账号快照：响应回来时用它判断「这个账号还是当前账号」。
  // 仅有请求序号不够——采集完成后按采集账号刷新（与当前选中无关），序号最新却属于
  // 旧账号，会把旧账号的作品行写进新账号视图（review P1-4）。
  const selectedIdRef = useRef(selectedId)
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  // 记住上次选中账号（2026-11-13 首屏性能）：下次打开直接沿用，配合 works 持久化
  // 实现首屏 0 往返渲染；删除/切换账号会自然覆盖。
  useEffect(() => {
    if (selectedId) storageSet('ywc:last-account-id', selectedId)
  }, [selectedId])

  const refreshWorks = useCallback(async accountId => {
    if (!accountId) { setWorks([]); setWorksLoading(false); return false }
    // 命中缓存先渲染（秒开）；无缓存必须清空，否则切账号瞬间仍显示上一个账号的行
    // （review P1-3）。
    const cached = worksCacheRef.current.get(accountId)
    setWorks(cached || [])
    // 2026-11-12 真机反馈：首次进入有 2-3 秒无作品列表的空窗，而空态文案与真正
    // 「没采集过」完全一致，看起来像卡住。无缓存时置加载态，命中缓存直接渲染不加。
    setWorksLoading(!cached)
    // 请求序号守卫：同账号并发时后到的旧响应不得覆盖新响应。
    const requestId = ++worksRequestRef.current
    const startedAt = Date.now()
    try {
      const result = await post('works.list', { accountId })
      const rows = Array.isArray(result.works) ? result.works : []
      // 缓存无条件写：被序号淘汰的响应也是有效数据，写缓存才能让切回时秒开。
      worksCacheRef.current.set(accountId, rows)
      // 跨会话持久化（2026-11-13）：下次打开工作台首屏 0 往返渲染上次列表。
      storageSet(worksStorageKey(accountId), JSON.stringify(rows))
      // 守卫：序号最新 + 账号仍是当前选中账号（review P1-4）。
      if (!shouldApplyResponse({
        requestId,
        currentRequestId: worksRequestRef.current,
        responseAccountId: accountId,
        currentAccountId: selectedIdRef.current,
      })) return true
      setWorks(rows)
      setWorksLoading(false)
      return true
    } catch (error) {
      if (requestId !== worksRequestRef.current) return false
      if (selectedIdRef.current !== accountId) return false
      if (!cached) setWorks([])
      setWorksLoading(false)
      notify(`作品列表加载失败：${error.message}`)
      return false
    } finally {
      // 耗时埋点（2026-11-13 性能排查，对齐抖音 `[yootun-douyin]`）：真机 devtools
      // 控制台可读单次调用耗时——CI 链路本地探针实测 work_list(50) ≈ 280ms，
      // 若真机此处仍在秒级，慢在设备端网络（代理/链路），不是服务端。
      if (requestId === worksRequestRef.current) {
        console.info(`[yootun-wx] works.list ${accountId} ${Date.now() - startedAt}ms`)
      }
    }
  }, [post, notify])

  const refreshOverview = useCallback(async (accountId, window) => {
    if (!accountId) { setOverview(null); setSummaryOverview(null); setProfile(null); setOverviewLoading(false); return false }
    // 总览会话内缓存（SWR，2026-11-13 性能优化，对齐 worksCacheRef）：同账号同窗口
    // 来回切换先渲染缓存（秒开、不加蒙板），后台刷新无感覆盖；键含窗口（各窗口独立）。
    const cacheKey = `${accountId}:${window}`
    const cached = overviewCacheRef.current.get(cacheKey)
    // 无缓存时清空 + 蒙板（避免旧账号数据串台，review P1-3）；命中缓存直接渲染。
    setOverview(cached ? cached.overview : null)
    setSummaryOverview(cached ? cached.summary : null)
    setProfile(cached ? cached.profile : null)
    setOverviewLoading(!cached)
    const requestId = ++overviewRequestRef.current
    const startedAt = Date.now()
    // 三路并行（2026-11-13 性能排查）：原先 summary → profile 串行两段公网往返，
    // 每段在真机是秒级；并行后账号页首拉只需一段往返。last_7d 窗口复用 summary，
    // 不重复请求（review P0-3）。
    const [summaryRes, profileRes, windowRes] = await Promise.all([
      post('account.overview', { accountId, window: 'last_7d' }).catch(() => null),
      post('fans.profile.get', { accountId }).catch(() => null),
      window === 'last_7d'
        ? Promise.resolve(null)
        : post('account.overview', { accountId, window }).catch(() => null),
    ])
    console.info(`[yootun-wx] overview ${accountId} ${window} ${Date.now() - startedAt}ms`)
    let ok = true
    const summary = summaryRes
    const profile = profileRes && profileRes.fans_profile ? profileRes.fans_profile : null
    const overview = window === 'last_7d' ? summary : (windowRes ?? null)
    if (!summary || !profileRes) ok = false
    if (window !== 'last_7d' && !windowRes) ok = false
    // 整体成功才写缓存：部分失败的快照不缓存（下次重拉完整数据）。
    if (ok) overviewCacheRef.current.set(cacheKey, { summary, overview, profile })
    // 守卫：序号最新 + 账号仍是当前选中账号（review P1-4）。否则旧账号的总览/画像
    // 会被写进当前视图（采集回调按采集账号刷新，与当前选中无关）。
    if (!shouldApplyResponse({
      requestId,
      currentRequestId: overviewRequestRef.current,
      responseAccountId: accountId,
      currentAccountId: selectedIdRef.current,
    })) return ok
    setOverview(overview)
    if (summary) setSummaryOverview(summary)
    setProfile(profile)
    setOverviewLoading(false)
    return ok
  }, [post])

  useEffect(() => {
    let cancelled = false
    setAccountsLoading(true)
    void (async () => {
      // 首屏并行：浏览器自检只用于无 Chrome 时的提示条，不该阻塞账号列表
      // （对齐抖音 refresh() 的 Promise.all 编排）。
      const statusPromise = post('browser.status')
        .then(status => {
          if (!cancelled) setBrowserReady({ chrome: status.chromeAvailable, driver: status.driverAvailable })
        })
        .catch(() => { /* 浏览器自检失败不阻断首屏 */ })
      // accounts.list 失败必须被吞掉：`void` 不会吞异常，否则 Electron 渲染进程会打
      // Uncaught (in promise)（review P2-4）。
      await Promise.all([statusPromise, refreshAccounts().catch(() => null)])
      if (!cancelled) setAccountsLoading(false)
    })()
    return () => { cancelled = true }
  }, [post, refreshAccounts])

  // 切换账号 / 窗口 / Tab → 按当前 Tab 分派查询（查询只读库，不触发采集）。
  //
  // 2026-11-13 性能排查：真机每次 MCP 公网往返秒级，页面延迟 = 往返次数 × 单次成本。
  // 首屏若同时拉 works + overview + profile（总览内部还串行），账号页被 works 挡住
  // （账号页根本不显示作品）、作品页被总览挤占。现在按 Tab 只拉当前页需要的数据：
  // - 作品 Tab：works 先落地（SWR 缓存秒开），再后台补拉 overview 预热摘要卡；
  // - 账号 Tab：只拉 overview+profile（refreshOverview 内部三路并行，一段往返），
  //   不再拉 works。切 Tab 时各自数据按需拉取（works 有缓存秒开、总览有缓存秒开）。
  useEffect(() => {
    if (!selectedId) {
      setWorks([])
      setWorksLoading(false)
      setOverview(null)
      setSummaryOverview(null)
      setProfile(null)
      setOverviewLoading(false)
      return
    }
    if (tab === 'account') {
      // 账号页：清空旧账号数据（防串台，review P1-3）后直接拉总览；
      // refreshOverview 内部会按缓存命中与否决定蒙板。
      setOverview(null)
      setSummaryOverview(null)
      setProfile(null)
      void refreshOverview(selectedId, windowKey)
      return
    }
    // 作品页：works 先落地；完成后补拉总览（摘要卡与关注者增长预热，账号页切换即用）。
    void (async () => {
      await refreshWorks(selectedId)
      // 作品已落地（或已失败）后再拉总览；期间用户若已切走/切 Tab，跳过。
      if (selectedIdRef.current !== selectedId) return
      void refreshOverview(selectedId, windowKey)
    })()
  }, [selectedId, windowKey, tab, refreshWorks, refreshOverview])

  // 批量进度轮询。
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const status = await post('collectAll.status')
        if (status && status.phase && status.phase !== 'ready') setBatch(status)
      } catch { /* 轮询失败静默保留旧状态 */ }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [post])

  // 添加账号（对齐抖音 onAddAccount）：点击直接由宿主打开系统 Chrome 进入官方
  // 视频号助手扫码；无二维码弹层，进行中状态由左栏按钮文案承载。
  // accountId 可选：会话过期后点「重新扫码」时复用该账号的浏览器 Profile，
  // 而不是另起一个 pending 登录；「添加账号」不传即新建。
  // 登录一律用**新的临时 Profile**（不传 accountId）：
  // 宿主登录流程会用 key 作为 Profile 目录名，登录成功后把该目录迁移到扫码得到的
  // 身份 ID。若这里传已有账号 ID，而扫码得到的是另一个视频号身份（同一微信绑定
  // 多个视频号时很常见），迁移会把**那个已有账号的 Profile 目录搬走**，其登录态
  // 随之丢失（2026-11-11 真机串号排查连带发现）。
  const beginLogin = useCallback(() => {
    void (async () => {
      const result = await post('account.beginLogin', {})
      setLogin({ loginKey: result.loginKey, state: result.state })
      pollLogin(result.loginKey)
    })().catch(error => notify(`登录发起失败：${error.message}`))
  }, [post, notify])

  const loginTimerRef = useRef(null)
  const stopLoginPolling = useCallback(() => {
    if (loginTimerRef.current) clearInterval(loginTimerRef.current)
    loginTimerRef.current = null
  }, [])
  const collectTimerRef = useRef(null)
  const stopCollectPolling = useCallback(() => {
    if (collectTimerRef.current) clearInterval(collectTimerRef.current)
    collectTimerRef.current = null
  }, [])
  // 插件卸载时清空全部轮询（review P1-4）。
  useEffect(() => () => {
    stopLoginPolling()
    stopCollectPolling()
  }, [stopLoginPolling, stopCollectPolling])
  const pollLogin = useCallback(loginKey => {
    stopLoginPolling()
    loginTimerRef.current = setInterval(async () => {
      try {
        const status = await post('account.loginStatus', { accountId: loginKey })
        if (status.state === 'ok') {
          stopLoginPolling()
          setLogin(null)
          // 本地登录成功但远端账号上报失败时透出原因（对齐抖音 saveError 消费）：
          // 采集前 ensureRemoteAccount 会自动补报，这里只提示不阻断。
          notify(status.reason
            ? `登录成功，但云端账号上报失败（采集时会自动补报）：${reasonText(status.reason)}`
            : '登录成功')
          await refreshAccounts()
        } else if (status.state === 'idle') {
          stopLoginPolling()
          setLogin(null)
        } else if (status.state === 'timeout' || status.state === 'failed') {
          // 终态必须停轮询并恢复按钮，否则「添加账号」永远禁用。
          stopLoginPolling()
          setLogin(null)
          notify(status.state === 'timeout' ? '登录未完成，可重试' : '登录失败，可重试')
        } else {
          setLogin({ loginKey, state: status.state, reason: status.reason })
        }
      } catch { /* 轮询失败下轮重试 */ }
    }, POLL_INTERVAL_MS)
  }, [post, notify, refreshAccounts, stopLoginPolling])

  const probeAccount = useCallback(accountId => {
    void (async () => {
      const result = await post('account.probe', { accountId })
      notify(result.sessionStatus === 'ok' ? '会话有效' : result.sessionStatus === 'expired' ? '会话已过期，请重新扫码' : '会话状态未知')
      await refreshAccounts()
    })().catch(error => notify(`检测失败：${error.message}`))
  }, [post, notify, refreshAccounts])

  const removeAccount = useCallback(accountId => {
    // 删除流程（§16.2）：应用内二次确认 → 先本地清理 → 再远端删除 → 刷新列表。
    setConfirm({
      title: '删除账号',
      message: '删除该账号将清理本机登录态并删除远端业务数据（保留审计账本），确定？',
      lifecycle: 'awaiting_confirmation',
      onConfirm: () => {
        setDeleteLifecycle('confirmed_pending_adapter')
        // 同步清掉该账号的本地缓存（会话 Map + localStorage 跨会话持久化）：
        // 不清的话删除后同 id 重新登录会先闪旧作品列表（SWR 命中），且持久化
        // 数据在账号删除后属于残留（2026-11-13 首屏持久化连带修复）。
        worksCacheRef.current.delete(accountId)
        for (const [windowKey] of WINDOWS) overviewCacheRef.current.delete(`${accountId}:${windowKey}`)
        storageRemove(worksStorageKey(accountId))
        void (async () => {
          const local = await post('account.removeLocal', { accountId })
          if (!local.cleared || !(local.cleared.profile && local.cleared.storageState)) {
            throw new Error('LOCAL_CLEARED_REQUIRED')
          }
          await post('account.removeRemote', { accountId })
          notify('账号已删除（远端保留审计墓碑）')
          await refreshAccounts()
        })().catch(error => notify(`删除失败：${error.message}`))
      },
    })
  }, [post, notify, refreshAccounts])

  const collectAccount = useCallback(accountId => {
    // 乐观投影（2026-11-11 真机反馈）：点击瞬间就进入「采集中… / 正在检查会话…」。
    // 宿主启动链路在返回前同步执行浏览器检查、会话实测与账号自愈（实测 2-3 秒），
    // 等它返回再更新会让用户点完毫无反馈；抖音是点击即置运行态。
    setCollectBusy(true)
    setCollect({ accountId, status: 'running', progress: null })
    void (async () => {
      const result = await post('collect.start', { accountId, newAttempt: true })
      if (!result.started) {
        setCollectBusy(false)
        setCollect(null)
        notify(`采集未启动：${reasonText(result.reason)}`)
        return
      }
      // 工具栏进度行随轮询逐步细化为「采集进度 N/M / 入库进度 i/j · s/e」，
      // 不再用顶部通知条承载采集反馈。
      collectTimerRef.current = setInterval(async () => {
        try {
          const status = await post('collect.status')
          if (status.collect) setCollect(status.collect)
          if (!status.busy) {
            stopCollectPolling()
            setCollectBusy(false)
            const final = status.collect || null
            if (!final) {
              // 宿主重启/插件重载会丢 collectRecord：busy=false 且无投影时清掉本地
              // 乐观 running 态，避免「采集中…」spinner 与禁用按钮永不清除（review P2）。
              setCollect(null)
              notify('采集状态丢失，可重试')
            } else if (final.status === 'failed') {
              notify(final.error ? `采集失败：${reasonText(final.error)}` : '采集失败，可重试')
            }
            await refreshWorks(accountId)
            await refreshOverview(accountId, windowKey)
            await refreshAccounts()
          }
        } catch { /* 轮询失败下轮重试 */ }
      }, POLL_INTERVAL_MS)
    })().catch(error => {
      stopCollectPolling()
      setCollectBusy(false)
      setCollect(null)
      notify(`采集失败：${error.message}`)
    })
  }, [post, notify, refreshWorks, refreshOverview, refreshAccounts, windowKey, stopCollectPolling])

  /**
   * 「刷新」按钮（2026-11-11 真机反馈：点击看起来没作用）：
   * 原来只是并发触发两个查询且没有任何反馈，数据没变化时用户完全看不出发生过什么。
   * 现在：刷新期间按钮显示「刷新中…」并禁用，完成后按钮自行恢复——**成功不再弹顶部
   * 提示**（按钮状态变化已是足够反馈，顶部长提示反而多余）；仅失败时提示具体失败项。
   * 同时连带刷新账号列表（账号卡片的「最近同步」时间与会话状态随之更新）。
   *
   * 结果聚合（review P1-2）：refreshWorks/refreshOverview 内部会吞掉错误，三路
   * Promise 几乎不会 reject——若只看 Promise 结果，失败也会被报成成功。改为各自
   * 返回成功标志后聚合，部分失败要明确说出来。
   */
  const refreshAll = useCallback(accountId => {
    if (!accountId) return
    setRefreshing(true)
    setRefreshMessage(null)
    void (async () => {
      try {
        const [worksOk, overviewOk, accountsOk] = await Promise.all([
          refreshWorks(accountId).catch(() => false),
          refreshOverview(accountId, windowKey).catch(() => false),
          refreshAccounts().then(() => true).catch(() => false),
        ])
        // 提示就地显示在刷新按钮旁（2026-11-11 真机反馈：不要顶部通知条）。
        // 成功不提示（按钮由「刷新中…」恢复即足够反馈）；只有失败才说明白。
        if (!worksOk || !overviewOk || !accountsOk) {
          setRefreshMessage(refreshResultLabel({ works: worksOk, overview: overviewOk, accounts: accountsOk }))
        }
      } finally {
        setRefreshing(false)
      }
    })()
  }, [notify, refreshWorks, refreshOverview, refreshAccounts, windowKey])

  const collectAll = useCallback(() => {
    // 与单账号采集同理：点击瞬间先挂最小运行投影，批量面板立刻显示 spinner，
    // 不等宿主逐个账号探测完才反馈（2026-11-11 真机反馈的一致性修复）。
    setBatch({ phase: 'probing', items: [], currentAccountIndex: 0 })
    void (async () => {
      const result = await post('collectAll.start', {})
      if (!result.started) {
        setBatch(null)
        notify(`批量采集未启动：${reasonText(result.reason)}`)
        return
      }
      // 宿主回执带完整批量投影，直接覆盖乐观值；后续随 collectAll.status 轮询细化。
      setBatch(result.batch || null)
    })().catch(error => {
      // 任何异步失败都必须清掉乐观投影，否则面板停在「采集中」且宿主无批量状态
      // 可纠正（client.js 的轮询只认 phase !== 'ready'）。
      setBatch(null)
      notify(`批量采集失败：${error.message}`)
    })
  }, [post, notify])

  // Esc 逐层关闭（对齐抖音 keydown 链）：详情弹层 → 确认弹层 → 工作台 overlay；
  // overlay 关闭时组件卸载，登录/采集轮询由卸载清理统一停止。
  useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') {
        if (detail) {
          setDetail(null)
          setDetailDaily([])
        } else if (confirm) {
          setConfirm(null)
        } else {
          setOpened(false)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [detail, confirm])

  // 弹层（详情/确认）关闭后恢复打开前焦点（契约审计可关闭性要求）。
  const lastDialogTriggerRef = useRef(null)
  const dialogOpen = Boolean(detail || confirm)
  useEffect(() => {
    if (!dialogOpen) return
    if (typeof document !== 'undefined') lastDialogTriggerRef.current = document.activeElement
    return () => {
      const trigger = lastDialogTriggerRef.current
      requestAnimationFrame(() => trigger?.focus?.())
    }
  }, [dialogOpen])

  // 批量结束后刷新当前账号数据。
  useEffect(() => {
    if (batch && batch.phase === 'finished' && selectedId) {
      void refreshWorks(selectedId)
      void refreshOverview(selectedId, windowKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch && batch.phase])

  // 详情请求序号 + 账号双维度守卫（审查 P2-5）：快速点开 A→B→A 时，A 的旧响应
  // 后到不得覆盖 B 的弹层内容。
  const detailRequestRef = useRef(0)
  const openDetail = useCallback(work => {
    setDetail(work)
    setDetailDaily([])
    detailRequestRef.current += 1
    const requestId = detailRequestRef.current
    const accountId = work.account_id || selectedId
    void (async () => {
      try {
        const result = await post('work.get', { accountId, workId: work.work_id })
        if (!shouldApplyResponse({
          requestId,
          currentRequestId: detailRequestRef.current,
          responseAccountId: accountId,
          currentAccountId: selectedId,
        })) return
        setDetail(result.work || work)
        setDetailDaily(Array.isArray(result.daily_metrics) ? result.daily_metrics : [])
      } catch { /* 详情查询失败保留行内数据展示 */ }
    })()
  }, [post, selectedId])

  const browserBlocked = !browserReady.chrome || !browserReady.driver
  const batchRunning = Boolean(batch && batch.phase && batch.phase !== 'finished')

  return h('div', { className: 'ywc-root' },
    h('style', { dangerouslySetInnerHTML: { __html: STYLES } }),
    h('div', { className: 'ywc-shell', 'data-tab': tab },
      h('header', { className: 'ywc-header' },
        h('div', { className: 'ywc-title' },
          h('div', { className: 'ywc-mark', 'aria-hidden': 'true' }, '视'),
          h('div', null,
            h('h1', null, '视频号工作台'),
            h('p', null, '扫码登录视频号助手，采集账号全部作品、账号数据与关注者数据'),
          ),
        ),
        // 右上角关闭按钮（对齐抖音 ydo-header-buttons）：关闭整页工作台。
        h('div', { className: 'ywc-header-actions' },
          h(Tooltip, { label: '关闭' },
            h('button', {
              className: 'ywc-icon', type: 'button',
              'aria-label': '关闭视频号工作台', onClick: () => setOpened(false),
            }, h(IconCloseOutlineRegular, { size: 16 })),
          ),
        ),
      ),
      notice ? h('div', { className: 'ywc-badge', role: 'status', 'aria-live': 'polite', style: { margin: '10px 24px 0' } }, notice) : null,
      h('nav', { className: 'ywc-tabs', 'aria-label': '工作台模块' },
        h('button', { className: 'ywc-tab', type: 'button', 'aria-selected': tab === 'work' ? 'true' : 'false', onClick: () => setTab('work') }, '作品数据'),
        h('button', { className: 'ywc-tab', type: 'button', 'aria-selected': tab === 'account' ? 'true' : 'false', onClick: () => setTab('account') }, '账号总览'),
      ),
      h('div', { className: 'ywc-body' },
        h('aside', { className: 'ywc-accounts', 'aria-label': '账号管理' },
          h(AccountList, {
            accounts, selectedId, busy: collectBusy,
            browserBlocked,
            batch,
            loginActive: Boolean(login),
            onSelect: accountId => setSelectedId(accountId),
            onProbe: probeAccount,
            onRemove: removeAccount,
            onBeginLogin: beginLogin,
            onCollectAll: collectAll,
          }),
          browserBlocked
            ? h('p', { className: 'ywc-empty', style: { padding: '0 2px' } },
              `需要系统 Google Chrome${browserReady.chrome ? ' 与 Playwright 驱动' : ''}（当前缺失），采集功能不可用`)
            : null,
          // 登录进行中：同一微信可绑定多个视频号，扫码后官方页面才出现身份选择；
          // 插件会等身份稳定后再建账号（2026-11-11 真机串号根因）。
          login
            ? h('p', { className: 'ywc-hint', style: { padding: '6px 2px 0' }, role: 'status' },
              '浏览器已打开，请扫码登录；若该微信绑定了多个视频号，请在官方页面选择要采集的那一个，插件会等您选完再建账号。')
            : null,
        ),
        h('main', { className: 'ywc-right' },
          tab === 'work'
            ? h('section', { className: 'ywc-panel ywc-work-panel' },
              h(WorkToolbar, {
                onCollect: () => selectedId && collectAccount(selectedId),
                onRefresh: () => selectedId && refreshAll(selectedId),
                // 采集按钮：批量运行中一并禁用（宿主互斥会拒绝，提前禁用给稳定反馈）；
                // 刷新是只读查询，批量运行中保持可用，但单账号采集期间禁用（采集会
                // 改写同一批数据，同时刷新会读到中间态）。
                collectDisabled: !selectedId || collectBusy || batchRunning,
                refreshDisabled: !selectedId || collectBusy || refreshing,
                refreshing,
                refreshMessage,
                // 最近采集时间（2026-11-12 真机反馈）：取已入库作品的最近采集时刻，
                // 展示在刷新按钮后，不再占用表格一列。
                latestCollectedAt: latestCollectedAt(works),
                collect: collect && collect.accountId === selectedId ? collect : null,
              }),
              h(WorkSummaryCards, { works, summaryOverview, account: selected }),
              h(WorkTable, {
                rows: visibleWorks,
                // 首屏账号列表未就绪 / 首次作品查询无缓存时显示加载态，
                // 不用「暂无已入库作品」空态冒充（2026-11-12 真机反馈）。
                loading: worksLoading || (accountsLoading && !selectedId),
                sort,
                onSortChange: columnKey => setSort(currentSort => nextSortState(currentSort, columnKey)),
                onOpenDetail: openDetail,
              }),
            )
            : h(AccountTab, {
              window: windowKey, onWindow: setWindowKey,
              overview, profile,
              // 加载蒙板（2026-11-13 真机反馈）：切账号 / 切窗口期间数据区显示
              // 「正在加载数据…」，口径与作品数据页加载态一致。
              loading: overviewLoading || (accountsLoading && !selectedId),
              // 关注者增长趋势图固定用 last_7d（「昨日」窗口只有 2 天数据，
              // 会把 7 天横轴截断成 2 个点）。
              trendOverview: summaryOverview,
              accounts, selectedId,
              onSelectAccount: accountId => setSelectedId(accountId),
            }),
        ),
      ),
    ),
    h(WorkDetailDialog, {
      work: detail, detail: detail ? {
        traffic_source: detail.traffic_source,
        retention_trend: detail.retention_trend,
      } : null,
      dailyMetrics: detailDaily,
      onClose: () => { setDetail(null); setDetailDaily([]) },
    }),
    confirm ? h('div', { className: 'ywc-modal open', role: 'dialog', 'aria-modal': 'true', onClick: event => { if (event.target === event.currentTarget) setConfirm(null) } },
      h('div', { className: 'ywc-dialog', style: { width: 'min(430px,100%)' } },
        h('header', { className: 'ywc-dialog-header' },
          h('h2', null, confirm.title),
          h('button', { className: 'ywc-close', type: 'button', 'aria-label': '关闭确认弹层', onClick: () => setConfirm(null) }, '×'),
        ),
        h('div', { className: 'ywc-dialog-body' },
          h('p', { className: 'ywc-card-meta' }, confirm.message),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
            h('button', { className: 'ywc-button', type: 'button', onClick: () => setConfirm(null) }, '取消'),
            h('button', {
              className: 'ywc-button primary', type: 'button',
              onClick: () => { setConfirm(null); confirm.onConfirm() },
            }, '确认删除'),
          ),
        ),
      ),
    ) : null,
  )
}

function reasonText(reason) {
  const map = {
    session_required: '会话失效',
    probe_failed: '探测失败',
    storage_state_missing: '缺登录态',
    pending_account: '待升级账号',
    collect_busy: '采集互斥',
    session_expired: '会话失效',
    // 服务端确定性业务错误（2026-11-11 真机链路排查）：给可行动文案而非「原因未知」。
    ACCOUNT_NOT_FOUND: '云端缺少账号记录，请重新扫码登录后重试',
    WX_TOOL_UNAVAILABLE: '桌面未接通视频号工具通道，请升级客户端后重试',
  }
  // 未知稳定码收敛为通用文案（对齐 batchReasonText），不把原始错误码透给业务用户。
  return map[reason] || '原因未知'
}

module.exports = { apply, inject: ['slots'], renderWxWorkbench, SidebarButton, css: STYLES }
