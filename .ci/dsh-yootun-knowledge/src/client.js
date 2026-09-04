const React = require("react");
const {
  createElement: h,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} = React;
const {
  IconCheckOutline16,
  IconCloseOutline16,
  IconDataOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconWarningOutline16,
  Tooltip,
} = require("@deepseek-ai/dsh-client-ui-primitives");
const NS = "dofe.yootun-knowledge";
const OVERLAY_ID = "@dofe/dsh-yootun-knowledge";
const OVERLAY_EVENT = "dofe:yootun-overlay:open";
const PATH = "/api/desktop/yootun/knowledge";
const copy = {
  zh: {
    open: "企业知识",
    title: "企业知识与记忆",
    subtitle: "知识库、Memory 与知识图谱治理",
    close: "关闭企业知识",
    refresh: "刷新",
    loading: "正在读取企业知识…",
    retry: "重新加载",
    overview: "总览",
    memoriesTab: "Memory 管理",
    graphTab: "知识图谱",
    templates: "业务空间",
    source: "数据源",
    overviewSource: "统计服务",
    projection: "图谱投影",
    ready: "已就绪",
    degraded: "降级",
    error: "异常",
    unavailable: "待连接",
    spaces: "知识空间",
    documents: "文档",
    memories: "Memory",
    pendingImports: "待导入",
    queued: "排队中",
    processing: "处理中",
    failed: "失败",
    ingestion: "导入队列",
    recentDocuments: "最近文档",
    recentMemories: "最近 Memory",
    emptyDocuments: "暂无最近文档",
    emptyMemories: "暂无最近 Memory",
    sourceType: "来源",
    candidate: "待确认",
    confirmed: "已确认",
    forgotten: "已遗忘",
    all: "全部",
    filter: "筛选",
    recall: "召回检索",
    recallPlaceholder: "输入主题，召回相关 Memory",
    recallRun: "开始召回",
    recalling: "召回中…",
    graph: "查看关联图谱",
    confirm: "确认沉淀",
    forget: "遗忘",
    confirmPrompt: "确认将这条 Memory 设为已确认？",
    forgetPrompt: "确认遗忘这条 Memory？",
    actionFailed: "操作失败，请重试",
    evidence: "证据时间",
    citation: "引用",
    confidence: "置信度",
    graphSearch: "查询实体关系",
    graphPlaceholder: "输入实体名称，例如：优惠豚企业空间",
    graphRun: "查询图谱",
    graphLoading: "图谱加载中…",
    graphEmpty: "选择一个业务实体查看授权关系",
    graphNoResult: "该实体暂无可见关系",
    nodes: "节点",
    edges: "关系",
    nodeTypes: "节点类型",
    edgeTypes: "关系类型",
    weight: "权重",
    backToMemory: "查看 Memory",
    projectionStatus: "投影状态",
    generatedAt: "生成时间",
    selectedNode: "选中节点",
    noSelection: "点击节点查看详情",
    typeSpace: "空间",
    typeSource: "来源",
    typeDocument: "文档",
    typeMemory: "Memory",
    statsUnavailable: "统计不可用",
    retryOverview: "统计暂不可用，但路由与模板仍可用",
    noContent: "没有可展示内容",
    entities: "实体",
  },
  en: {
    open: "Enterprise knowledge",
    title: "Enterprise knowledge & memory",
    subtitle: "Knowledge, Memory, and graph governance",
    close: "Close enterprise knowledge",
    refresh: "Refresh",
    loading: "Loading enterprise knowledge…",
    retry: "Try again",
    overview: "Overview",
    memoriesTab: "Memory",
    graphTab: "Knowledge graph",
    templates: "Business spaces",
    source: "Data source",
    overviewSource: "Stats service",
    projection: "Graph projection",
    ready: "Ready",
    degraded: "Degraded",
    error: "Error",
    unavailable: "Needs connection",
    spaces: "Knowledge spaces",
    documents: "Documents",
    memories: "Memory",
    pendingImports: "Pending import",
    queued: "Queued",
    processing: "Processing",
    failed: "Failed",
    ingestion: "Ingestion queue",
    recentDocuments: "Recent documents",
    recentMemories: "Recent Memory",
    emptyDocuments: "No recent documents",
    emptyMemories: "No recent Memory",
    sourceType: "Source",
    candidate: "Pending review",
    confirmed: "Confirmed",
    forgotten: "Forgotten",
    all: "All",
    filter: "Filter",
    recall: "Memory recall",
    recallPlaceholder: "Enter a topic to recall related Memory",
    recallRun: "Recall",
    recalling: "Recalling…",
    graph: "View related graph",
    confirm: "Confirm",
    forget: "Forget",
    confirmPrompt: "Confirm this Memory?",
    forgetPrompt: "Forget this Memory?",
    actionFailed: "Action failed. Try again.",
    evidence: "Evidence time",
    citation: "Citation",
    confidence: "Confidence",
    graphSearch: "Explore entity relations",
    graphPlaceholder: "Enter an entity, e.g. Youhuitun company space",
    graphRun: "Explore graph",
    graphLoading: "Loading graph…",
    graphEmpty: "Choose a business entity to view authorized relations",
    graphNoResult: "No visible relations for this entity",
    nodes: "Nodes",
    edges: "Edges",
    nodeTypes: "Node types",
    edgeTypes: "Relation types",
    weight: "Weight",
    backToMemory: "View Memory",
    projectionStatus: "Projection",
    generatedAt: "Generated",
    selectedNode: "Selected node",
    noSelection: "Select a node for details",
    typeSpace: "Space",
    typeSource: "Source",
    typeDocument: "Document",
    typeMemory: "Memory",
    statsUnavailable: "Stats unavailable",
    retryOverview: "Stats unavailable; route and templates remain available",
    noContent: "Nothing to show",
    entities: "Entities",
  },
};
let opened = false;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());
const setOpened = (value) => {
  opened = value;
  emit();
};
const openOverlay = () => {
  window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: OVERLAY_ID } }));
  setOpened(true);
};
const closeOtherOverlay = (event) => {
  if (event.detail?.id !== OVERLAY_ID) setOpened(false);
};
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => opened;
async function load(signal) {
  const response = await fetch(PATH, {
    credentials: "same-origin",
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("knowledge request failed");
  return response.json();
}
async function mutate(body) {
  const response = await fetch(PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok || value?.ok === false || value?.status === "error")
    throw new Error(value?.error || "knowledge mutation failed");
  return value;
}
const count = (value) =>
  value !== null && value !== "" && Number.isFinite(Number(value))
    ? new Intl.NumberFormat().format(Number(value))
    : "-";
const date = (value) => {
  const time = Date.parse(value || "");
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(time)
    : "—";
};
const stateLabel = (value, t) =>
  value === "ready" || value === "healthy" || value === "projected"
    ? t("ready")
    : value === "queued"
      ? t("queued")
      : value === "degraded"
        ? t("degraded")
        : value === "error"
          ? t("error")
          : t("unavailable");
const normalizeSourceState = (state) => {
  const value = String(state || "").toLowerCase();
  return value === "healthy" || value === "projected"
    ? "ready"
    : ["ready", "queued", "degraded", "error"].includes(value)
      ? value
      : "unavailable";
};
const typeLabel = (value, t) =>
  ({
    SPACE: t("typeSpace"),
    SOURCE: t("typeSource"),
    DOCUMENT: t("typeDocument"),
    MEMORY: t("typeMemory"),
  })[value] || value;
const memoryStatus = (value, t) =>
  value === "CONFIRMED"
    ? t("confirmed")
    : value === "FORGOTTEN"
      ? t("forgotten")
      : t("candidate");
function SourceBadge({ label, state, t }) {
  const normalized = normalizeSourceState(state);
  return h(
    "span",
    { className: `yk-source yk-source-${normalized}` },
    h("i", { "aria-hidden": true }),
    `${label} · ${stateLabel(normalized, t)}`,
  );
}
function Metric({ label, value, tone }) {
  return h(
    "div",
    { className: `yk-metric yk-metric-${tone || "blue"}` },
    h("span", null, label),
    h("strong", null, value),
  );
}
function Title({ title, meta }) {
  return h(
    "div",
    { className: "yk-panel-title" },
    h("h2", null, title),
    meta ? h("span", { className: "yk-muted" }, meta) : null,
  );
}
function Ingestion({ data, t }) {
  const rows = [
    ["queued", t("queued"), data?.queued],
    ["processing", t("processing"), data?.processing],
    ["failed", t("failed"), data?.failed],
  ];
  const max = Math.max(1, ...rows.map((row) => Number(row[2]) || 0));
  return h(
    "section",
    { className: "yk-panel" },
    h(Title, { title: t("ingestion") }),
    h(
      "div",
      { className: "yk-bars" },
      rows.map(([key, label, value]) =>
        h(
          "div",
          { className: "yk-bar-row", key },
          h("span", null, label),
          h(
            "div",
            { className: "yk-bar-track" },
            h("span", {
              className: `yk-bar yk-bar-${key}`,
              style: {
                width: `${Math.max(value > 0 ? 7 : 0, ((Number(value) || 0) / max) * 100)}%`,
              },
            }),
          ),
          h("strong", null, count(value)),
        ),
      ),
    ),
  );
}
function RecentDocument({ item, t }) {
  return h(
    "div",
    { className: "yk-record" },
    h(
      "div",
      { className: "yk-record-icon" },
      h(IconDataOutline16, { size: 15 }),
    ),
    h(
      "div",
      { className: "yk-record-main" },
      h("strong", null, item.title || t("documents")),
      h(
        "span",
        null,
        `${item.source || item.sourceType || t("sourceType")} · ${date(item.updatedAt || item.updated_at)}`,
      ),
    ),
    item.status ? h("small", null, item.status) : null,
  );
}
function MemoryRow({ item, t, onGraph, onConfirm, onForget }) {
  const status = String(item.status || "CANDIDATE").toUpperCase();
  const title =
    item.title && item.title !== item.content
      ? item.title
      : [item.type, item.scope].filter(Boolean).join(" · ") || t("memories");
  const source =
    item.citation?.source ||
    item.toolMetadata?.name ||
    item.sourceType ||
    item.sourceSessionId;
  const trace = [
    source ? `${t("sourceType")} · ${source}` : null,
    item.citationHealth ? `${t("citation")} · ${item.citationHealth}` : null,
    Number.isFinite(Number(item.confidence ?? item.score))
      ? `${t("confidence")} · ${Math.round(Number(item.confidence ?? item.score) * 100)}%`
      : null,
    `${t("evidence")} · ${date(item.updatedAt || item.updated_at || item.createdAt || item.created_at)}`,
  ]
    .filter(Boolean)
    .join("  /  ");
  return h(
    "article",
    { className: `yk-memory-row yk-memory-${status.toLowerCase()}` },
    h(
      "div",
      { className: "yk-memory-main" },
      h(
        "div",
        { className: "yk-memory-head" },
        h("strong", null, title),
        h("span", { className: "yk-memory-status" }, memoryStatus(status, t)),
      ),
      h("p", null, item.content || item.summary || t("noContent")),
      h("small", { title: trace }, trace),
    ),
    h(
      "div",
      { className: "yk-row-actions" },
      h(
        "button",
        {
          type: "button",
          onClick: () => onGraph?.(item.title || item.content || ""),
        },
        h(IconDataOutline16, { size: 14 }),
        t("graph"),
      ),
      status === "CANDIDATE" && onConfirm
        ? h(
            "button",
            { type: "button", onClick: () => onConfirm(item) },
            h(IconCheckOutline16, { size: 14 }),
            t("confirm"),
          )
        : null,
      ["CANDIDATE", "CONFIRMED"].includes(status) && onForget
        ? h(
            "button",
            {
              type: "button",
              className: "yk-quiet",
              onClick: () => onForget(item),
            },
            h(IconCloseOutline16, { size: 14 }),
            t("forget"),
          )
        : null,
    ),
  );
}
function Overview({ data, t, onGraph, onTemplate, onConfirm, onForget }) {
  const overview = data?.overview || {};
  const stats = overview.data || {};
  const docs = Array.isArray(stats.recentDocuments)
    ? stats.recentDocuments
    : [];
  const memories = Array.isArray(stats.recentMemories)
    ? stats.recentMemories
    : [];
  const health = stats.health || {};
  const sourceState =
    data?.status === "ready" && data?.mcp?.auth === "credential-store"
      ? "ready"
      : "unavailable";
  const graphState =
    health.neo4j ||
    health.graph ||
    (stats.health === "healthy" ? "ready" : stats.health);
  return h(
    "div",
    { className: "yk-page" },
    h(
      "div",
      { className: "yk-source-row" },
      h(SourceBadge, { label: "MCP", state: sourceState, t }),
      h(SourceBadge, { label: t("overviewSource"), state: overview.status, t }),
      h(SourceBadge, { label: t("projection"), state: graphState, t }),
    ),
    h(
      "div",
      { className: "yk-metrics" },
      h(Metric, {
        label: t("spaces"),
        value: overview.status === "ready" ? count(stats.spaces) : "-",
        tone: "blue",
      }),
      h(Metric, {
        label: t("documents"),
        value: overview.status === "ready" ? count(stats.documents) : "-",
        tone: "teal",
      }),
      h(Metric, {
        label: t("memories"),
        value: overview.status === "ready" ? count(stats.memories) : "-",
        tone: "violet",
      }),
      h(Metric, {
        label: t("pendingImports"),
        value: overview.status === "ready" ? count(stats.pendingImports) : "-",
        tone: "amber",
      }),
    ),
    h(
      "div",
      { className: "yk-grid-2" },
      h(Ingestion, { data: stats.ingestion, t }),
      h(
        "section",
        { className: "yk-panel" },
        h(Title, { title: t("recentDocuments"), meta: String(docs.length) }),
        docs.length
          ? docs.map((item) =>
              h(RecentDocument, { key: item.id || item.title, item, t }),
            )
          : h("div", { className: "yk-empty-compact" }, t("emptyDocuments")),
      ),
    ),
    h(
      "div",
      { className: "yk-grid-2" },
      h(
        "section",
        { className: "yk-panel" },
        h(Title, { title: t("recentMemories"), meta: String(memories.length) }),
        memories.length
          ? memories.slice(0, 5).map((item) =>
              h(MemoryRow, {
                key: item.id || item.title || item.content,
                item,
                t,
                onGraph,
                onConfirm,
                onForget,
              }),
            )
          : h("div", { className: "yk-empty-compact" }, t("emptyMemories")),
      ),
      h(
        "section",
        { className: "yk-panel" },
        h(Title, { title: t("templates") }),
        h(
          "div",
          { className: "yk-template-list" },
          (data?.templates || []).map((item) =>
            h(
              "button",
              {
                type: "button",
                className: "yk-template",
                key: item.id,
                onClick: () => onTemplate?.(item),
              },
              h("b", null, (item.name || "知").slice(0, 1)),
              h(
                "span",
                null,
                h("strong", null, item.name),
                h("small", null, item.description),
              ),
              h("em", null, `${item.entities?.length || 0}`),
            ),
          ),
        ),
      ),
    ),
  );
}
function Memories({
  data,
  t,
  onGraph,
  onConfirm,
  onForget,
  onRecall,
  recallBusy,
  recallResults,
  query,
  setQuery,
  filter,
  setFilter,
}) {
  const source = query.trim()
    ? recallResults
    : data?.overview?.data?.recentMemories || [];
  const items = source.filter(
    (item) =>
      filter === "all" ||
      String(item.status || "CANDIDATE").toLowerCase() === filter,
  );
  return h(
    "div",
    { className: "yk-page" },
    h(
      "section",
      { className: "yk-recall" },
      h(
        "div",
        null,
        h("span", { className: "yk-eyebrow" }, t("memoriesTab")),
        h("h2", null, t("recall")),
        h("p", null, t("subtitle")),
      ),
      h(
        "div",
        { className: "yk-search-row" },
        h("input", {
          value: query,
          maxLength: 500,
          placeholder: t("recallPlaceholder"),
          onChange: (event) => setQuery(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter") onRecall();
          },
        }),
        h(
          "button",
          {
            type: "button",
            className: "yk-primary",
            disabled: recallBusy || !query.trim(),
            onClick: onRecall,
          },
          h(IconSearchOutline16, { size: 15 }),
          recallBusy ? t("recalling") : t("recallRun"),
        ),
      ),
    ),
    h(
      "div",
      { className: "yk-filter" },
      h("span", { className: "yk-muted" }, t("filter")),
      ["all", "candidate", "confirmed"].map((value) =>
        h(
          "button",
          {
            type: "button",
            className: filter === value ? "is-active" : "",
            "aria-pressed": filter === value,
            onClick: () => setFilter(value),
            key: value,
          },
          t(value),
        ),
      ),
    ),
    h(
      "section",
      { className: "yk-panel" },
      h(Title, { title: t("memoriesTab"), meta: String(items.length) }),
      items.length
        ? items.map((item) =>
            h(MemoryRow, {
              key: item.id || item.title || item.content,
              item,
              t,
              onGraph,
              onConfirm,
              onForget,
            }),
          )
        : h("div", { className: "yk-empty" }, t("emptyMemories")),
    ),
  );
}
function toolData(value) {
  if (value?.structuredContent && typeof value.structuredContent === "object")
    return value.structuredContent;
  if (value?.data && typeof value.data === "object") return value.data;
  const text = value?.content?.find?.((item) => item?.type === "text")?.text;
  if (text) {
    try {
      return JSON.parse(text);
    } catch {}
  }
  return value && typeof value === "object" ? value : {};
}
function recallItems(value) {
  const result = toolData(value);
  return Array.isArray(result.list)
    ? result.list
        .filter((item) => item?.kind === "memory")
        .map((item) => ({ ...item, status: "CONFIRMED" }))
    : [];
}
function normalizeGraph(value) {
  const result = toolData(value);
  return {
    nodes: Array.isArray(result.nodes) ? result.nodes : [],
    edges: Array.isArray(result.edges) ? result.edges : [],
    generatedAt: result.generatedAt,
    projection: result.projection || {},
  };
}
function graphLayout(nodes) {
  const columns = { SPACE: 100, SOURCE: 280, DOCUMENT: 480, MEMORY: 660 };
  const grouped = {};
  nodes.forEach((node) => {
    (grouped[node.type] ||= []).push(node);
  });
  const positions = new Map();
  Object.entries(grouped).forEach(([type, list]) =>
    list.forEach((node, index) =>
      positions.set(node.id, { x: columns[type] || 380, y: 48 + index * 58 }),
    ),
  );
  const maxRows = Math.max(
    1,
    ...Object.values(grouped).map((list) => list.length),
  );
  return { positions, canvasHeight: Math.max(300, 78 + maxRows * 58) };
}
function graphTypeCounts(graph) {
  const tally = (values) =>
    values.reduce((result, value) => {
      const key = value || "UNKNOWN";
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});
  return {
    nodes: tally((graph?.nodes || []).map((node) => node.type)),
    edges: tally((graph?.edges || []).map((edge) => edge.type)),
  };
}
function GraphCanvas({ graph, t, onOpenMemory }) {
  const [selected, setSelected] = useState(null);
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const layout = useMemo(() => graphLayout(nodes), [nodes]);
  const typeCounts = useMemo(() => graphTypeCounts(graph), [graph]);
  const { positions, canvasHeight } = layout;
  const selectedNode = nodes.find((node) => node.id === selected);
  const selectOnKey = (event, id) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(id);
    }
  };
  const svg = nodes.length
    ? h(
        "div",
        { className: "yk-graph-canvas" },
        h(
          "svg",
          {
            viewBox: `0 0 760 ${canvasHeight}`,
            style: { height: `${canvasHeight}px` },
            preserveAspectRatio: "xMidYMin meet",
            "aria-label": t("graphTab"),
          },
          edges.map((edge) => {
            const from = positions.get(edge.source);
            const to = positions.get(edge.target);
            return from && to
              ? h(
                  "line",
                  {
                    key: edge.id,
                    x1: from.x,
                    y1: from.y,
                    x2: to.x,
                    y2: to.y,
                    className: "yk-edge",
                  },
                  h(
                    "title",
                    null,
                    `${edge.type || t("edges")} · ${t("weight")} ${Number.isFinite(Number(edge.weight)) ? Number(edge.weight).toFixed(2) : "—"}`,
                  ),
                )
              : null;
          }),
          nodes.map((node) => {
            const point = positions.get(node.id) || { x: 380, y: 150 };
            return h(
              "g",
              {
                key: node.id,
                className: `yk-node${selected === node.id ? " is-selected" : ""}`,
                onClick: () => setSelected(node.id),
                onKeyDown: (event) => selectOnKey(event, node.id),
                tabIndex: 0,
                role: "button",
                "aria-label": node.label,
              },
              h("circle", {
                cx: point.x,
                cy: point.y,
                r: selected === node.id ? 18 : 14,
              }),
              h(
                "text",
                { x: point.x, y: point.y + 32, textAnchor: "middle" },
                (node.label || typeLabel(node.type, t)).slice(0, 15),
              ),
            );
          }),
        ),
      )
    : h(
        "div",
        { className: "yk-graph-empty" },
        h(IconDataOutline16, { size: 25 }),
        h("p", null, t("graphNoResult")),
      );
  const detail = selectedNode
    ? h(
        "div",
        { className: "yk-node-detail" },
        h("span", { className: "yk-eyebrow" }, typeLabel(selectedNode.type, t)),
        h("strong", null, selectedNode.label),
        h("small", null, selectedNode.entityId || selectedNode.id),
        selectedNode.status ? h("small", null, selectedNode.status) : null,
        selectedNode.type === "MEMORY" && onOpenMemory
          ? h(
              "button",
              { type: "button", onClick: () => onOpenMemory?.(selectedNode) },
              t("backToMemory"),
            )
          : null,
      )
    : h(
        "div",
        { className: "yk-node-detail yk-node-detail-empty" },
        t("noSelection"),
      );
  const typeStats = h(
    "div",
    { className: "yk-type-stats" },
    h(
      "div",
      null,
      h("strong", null, t("nodeTypes")),
      Object.entries(typeCounts.nodes).map(([type, value]) =>
        h("span", { key: type }, `${typeLabel(type, t)} ${value}`),
      ),
    ),
    h(
      "div",
      null,
      h("strong", null, t("edgeTypes")),
      Object.entries(typeCounts.edges).map(([type, value]) =>
        h("span", { key: type }, `${type} ${value}`),
      ),
    ),
  );
  return h(
    "div",
    { className: "yk-graph-wrap" },
    h(
      "div",
      { className: "yk-graph-meta" },
      h("span", null, `${t("nodes")} ${nodes.length}`),
      h("span", null, `${t("edges")} ${edges.length}`),
      h(
        "span",
        null,
        `${t("projectionStatus")} · ${stateLabel(normalizeSourceState(graph?.projection?.status), t)}`,
      ),
      graph?.generatedAt
        ? h("span", null, `${t("generatedAt")} · ${date(graph.generatedAt)}`)
        : null,
    ),
    graph?.projection?.message
      ? h("div", { className: "yk-inline-warning" }, graph.projection.message)
      : null,
    typeStats,
    svg,
    detail,
  );
}
function Graph({
  data,
  t,
  query,
  setQuery,
  graph,
  graphBusy,
  graphError,
  onRun,
  onTemplate,
  onOpenMemory,
}) {
  const defaultEntity = data?.templates?.[0]?.entities?.[0] || "";
  useEffect(() => {
    if (!graph && !graphBusy && !graphError && defaultEntity)
      onTemplate(defaultEntity);
  }, [graph, graphBusy, graphError, defaultEntity]);
  return h(
    "div",
    { className: "yk-page" },
    h(
      "section",
      { className: "yk-graph-hero" },
      h(
        "div",
        null,
        h("span", { className: "yk-eyebrow" }, t("graphTab")),
        h("h2", null, t("graphSearch")),
        h("p", null, t("graphEmpty")),
      ),
      h(
        "div",
        { className: "yk-search-row" },
        h("input", {
          value: query,
          maxLength: 500,
          placeholder: t("graphPlaceholder"),
          onChange: (event) => setQuery(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter") onRun();
          },
        }),
        h(
          "button",
          {
            type: "button",
            className: "yk-primary",
            disabled: graphBusy || !query.trim(),
            onClick: onRun,
          },
          h(IconSearchOutline16, { size: 15 }),
          graphBusy ? t("graphLoading") : t("graphRun"),
        ),
      ),
    ),
    h(
      "div",
      { className: "yk-chips" },
      (data?.templates || []).flatMap((item) =>
        (item.entities || []).slice(0, 3).map((entity) =>
          h(
            "button",
            {
              type: "button",
              className: "yk-chip",
              key: `${item.id}-${entity}`,
              onClick: () => onTemplate(entity),
            },
            entity,
          ),
        ),
      ),
    ),
    graphError
      ? h(
          "div",
          { className: "yk-inline-error", role: "alert" },
          h(IconWarningOutline16, { size: 15 }),
          t("actionFailed"),
        )
      : graph
        ? h(
            "section",
            { className: "yk-panel yk-graph-panel" },
            h(GraphCanvas, { graph, t, onOpenMemory }),
          )
        : h(
            "section",
            { className: "yk-panel yk-graph-panel" },
            h(
              "div",
              { className: "yk-graph-empty" },
              h(IconDataOutline16, { size: 25 }),
              h("p", null, graphBusy ? t("graphLoading") : t("graphEmpty")),
            ),
          ),
  );
}
function Overlay({ t }) {
  const visible = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [tab, setTab] = useState("overview");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [graphQuery, setGraphQuery] = useState("");
  const [graph, setGraph] = useState(null);
  const [graphBusy, setGraphBusy] = useState(false);
  const [graphError, setGraphError] = useState(false);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryFilter, setMemoryFilter] = useState("all");
  const [recallResults, setRecallResults] = useState([]);
  const [recallBusy, setRecallBusy] = useState(false);
  useEffect(() => {
    if (!visible) return undefined;
    const controller = new AbortController();
    setError(false);
    setActionError(false);
    setLoading(true);
    void load(controller.signal)
      .then((value) => {
        setData(value);
        setGraph(null);
        setRecallResults([]);
      })
      .catch((cause) => {
        if (cause?.name !== "AbortError") setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [visible, revision]);
  useEffect(() => {
    if (!visible) return undefined;
    const key = (event) => {
      if (event.key === "Escape") setOpened(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [visible]);
  if (!visible) return null;
  const runGraph = async (value) => {
    const query = String(value || graphQuery).trim();
    if (!query) return;
    setGraphQuery(query);
    setGraphBusy(true);
    setGraphError(false);
    try {
      const response = await mutate({
        action: "graph",
        input: { query, limit: 200 },
      });
      setGraph(normalizeGraph(response.result || response));
    } catch {
      setGraphError(true);
    } finally {
      setGraphBusy(false);
    }
  };
  const runRecall = async (value) => {
    const query = typeof value === "string" ? value.trim() : memoryQuery.trim();
    if (!query) return;
    setRecallBusy(true);
    setActionError(false);
    try {
      const response = await mutate({
        action: "recall",
        input: { query, topK: 8, includeDocuments: false },
      });
      setRecallResults(recallItems(response.result || response));
    } catch {
      setRecallResults([]);
      setActionError(true);
    } finally {
      setRecallBusy(false);
    }
  };
  const reload = async () => {
    try {
      setData(await load());
      setRecallResults([]);
      setActionError(false);
    } catch {
      setActionError(true);
    }
  };
  const confirmMemory = async (item) => {
    if (!window.confirm(t("confirmPrompt"))) return;
    try {
      await mutate({
        action: "confirm_memory",
        input: { memoryId: item.id, reason: "user-confirmed" },
      });
      await reload();
    } catch {
      setActionError(true);
    }
  };
  const forgetMemory = async (item) => {
    if (!window.confirm(t("forgetPrompt"))) return;
    try {
      await mutate({
        action: "forget",
        input: { memoryId: item.id, reason: "user-requested-forget" },
      });
      await reload();
    } catch {
      setActionError(true);
    }
  };
  const current = data || {
    status: "unavailable",
    overview: {},
    templates: [],
  };
  const chooseTemplate = (item) => {
    const value = typeof item === "string" ? item : item?.entities?.[0] || "";
    setTab("graph");
    if (value) void runGraph(value);
  };
  const openMemory = (node) => {
    const query = String(node?.label || "").trim();
    setMemoryQuery(query);
    setMemoryFilter("all");
    setTab("memories");
    if (query) void runRecall(query);
  };
  let body;
  if (loading && !data)
    body = h(
      "div",
      { role: "status", className: "yk-empty yk-loading" },
      h("span", { className: "yk-spinner" }),
      t("loading"),
    );
  else if (error && !data)
    body = h(
      "div",
      { role: "alert", className: "yk-empty yk-error" },
      h(IconWarningOutline16, { size: 22 }),
      t("retryOverview"),
      h(
        "button",
        { type: "button", onClick: () => setRevision((value) => value + 1) },
        h(IconRefreshOutline16, { size: 14 }),
        t("retry"),
      ),
    );
  else if (tab === "memories")
    body = h(Memories, {
      data: current,
      t,
      onGraph: (value) => {
        setGraphQuery(value);
        setTab("graph");
        void runGraph(value);
      },
      onConfirm: confirmMemory,
      onForget: forgetMemory,
      onRecall: runRecall,
      recallBusy,
      recallResults,
      query: memoryQuery,
      setQuery: setMemoryQuery,
      filter: memoryFilter,
      setFilter: setMemoryFilter,
    });
  else if (tab === "graph")
    body = h(Graph, {
      data: current,
      t,
      query: graphQuery,
      setQuery: setGraphQuery,
      graph,
      graphBusy,
      graphError,
      onRun: () => runGraph(),
      onTemplate: chooseTemplate,
      onOpenMemory: openMemory,
    });
  else
    body = h(Overview, {
      data: current,
      t,
      onTemplate: chooseTemplate,
      onConfirm: confirmMemory,
      onForget: forgetMemory,
      onGraph: (value) => {
        setGraphQuery(value);
        setTab("graph");
        void runGraph(value);
      },
    });
  if (actionError && data)
    body = h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "yk-inline-error", role: "alert" },
        h(IconWarningOutline16, { size: 15 }),
        t("actionFailed"),
      ),
      body,
    );
  return h(
    "div",
    { className: "yk-overlay", role: "dialog", "aria-modal": true, "aria-labelledby": "yk-title" },
    h(
      "main",
      { className: "yk-shell", "aria-labelledby": "yk-title" },
      h(
        "header",
        { className: "yk-header" },
        h(
          "div",
          null,
          h("span", { className: "yk-eyebrow" }, "YOOTUN KNOWLEDGE"),
          h("h1", { id: "yk-title" }, t("title")),
          h("p", null, t("subtitle")),
        ),
        h(
          "div",
          { className: "yk-header-buttons" },
          h(
            Tooltip,
            { label: t("refresh") },
            h(
              "button",
              {
                type: "button",
                className: "yk-icon-button",
                "aria-label": t("refresh"),
                disabled: loading,
                onClick: () => setRevision((value) => value + 1),
              },
              h(IconRefreshOutline16, { size: 16 }),
            ),
          ),
          h(
            Tooltip,
            { label: t("close") },
            h(
              "button",
              {
                type: "button",
                className: "yk-icon-button",
                "aria-label": t("close"),
                onClick: () => setOpened(false),
              },
              h(IconCloseOutline16, { size: 16 }),
            ),
          ),
        ),
      ),
      h(
        "nav",
        { className: "yk-tabs", "aria-label": t("title") },
        [
          ["overview", t("overview")],
          ["memories", t("memoriesTab")],
          ["graph", t("graphTab")],
        ].map(([id, label]) =>
          h(
            "button",
            {
              type: "button",
              key: id,
              className: tab === id ? "is-active" : "",
              "aria-current": tab === id ? "page" : undefined,
              onClick: () => setTab(id),
            },
            label,
          ),
        ),
      ),
      h(
        "div",
        { className: `yk-content${loading && data ? " yk-refreshing" : ""}` },
        body,
      ),
    ),
  );
}
function Button({ wide, t }) {
  return h(
    Tooltip,
    { label: t("open"), disabled: wide },
    h(
      "button",
      {
        type: "button",
        className: `yk-button${wide ? " yk-wide" : ""}`,
        "aria-label": t("open"),
        onClick: openOverlay,
      },
      h(IconDataOutline16, { size: wide ? 14 : 18 }),
      wide ? h("span", null, t("open")) : null,
    ),
  );
}
const css = `.yk-button{box-sizing:border-box;display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}.yk-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yk-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yk-wide span{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yk-overlay{position:fixed;inset:0;z-index:510;background:#0f1720;color:#e8eef5}.yk-shell{display:grid;grid-template-rows:auto auto minmax(0,1fr);width:100%;height:100%;overflow:hidden}.yk-header{display:flex;min-height:86px;align-items:center;justify-content:space-between;gap:20px;padding:16px 28px;border-bottom:1px solid #263545;background:#111c28}.yk-eyebrow{display:block;color:#6e8298;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.yk-header h1{margin:5px 0 0;font-size:22px}.yk-header p{margin:4px 0 0;color:#92a5b8;font-size:13px}.yk-header-buttons{display:flex;gap:7px}.yk-icon-button{display:grid;width:35px;height:35px;place-items:center;border:1px solid #314457;border-radius:7px;background:#172534;color:#c6d2de;cursor:pointer}.yk-icon-button:disabled{opacity:.45}.yk-tabs{display:flex;gap:5px;padding:0 28px;border-bottom:1px solid #263545;background:#111c28;overflow-x:auto}.yk-tabs button{height:45px;padding:0 15px;border:0;border-bottom:2px solid transparent;background:transparent;color:#8398ac;font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}.yk-tabs button.is-active{border-bottom-color:#39c7b3;color:#eff9f7;font-weight:650}.yk-content{min-height:0;overflow:auto;padding:24px 28px 44px;background:#0f1720}.yk-refreshing{opacity:.7}.yk-page{display:grid;width:100%;max-width:1180px;margin:0 auto;align-content:start;gap:16px}.yk-source-row,.yk-chips,.yk-filter{display:flex;flex-wrap:wrap;gap:8px}.yk-source{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid #2b3d4e;border-radius:999px;color:#91a6b9;font-size:11px;background:#13212e}.yk-source i{width:7px;height:7px;border-radius:50%;background:#718396}.yk-source-ready{border-color:#24594f;color:#61d4bd}.yk-source-ready i{background:#47d1b5}.yk-source-degraded{border-color:#64512d;color:#e3bd69}.yk-source-degraded i{background:#e3bd69}.yk-source-error{border-color:#623b42;color:#ef8b92}.yk-source-error i{background:#ef8b92}.yk-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #293c4d;border-radius:10px;overflow:hidden;background:#142331}.yk-metric{display:grid;min-height:94px;align-content:center;gap:8px;padding:15px 18px;border-right:1px solid #293c4d;position:relative}.yk-metric:last-child{border-right:0}.yk-metric:before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:#587187}.yk-metric-blue:before{background:#5d9cf4}.yk-metric-teal:before{background:#3bcab7}.yk-metric-violet:before{background:#a78bfa}.yk-metric-amber:before{background:#e7b85b}.yk-metric span{color:#91a6b9;font-size:12px}.yk-metric strong{color:#eef6fb;font-size:27px;font-variant-numeric:tabular-nums}.yk-grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.yk-panel,.yk-recall,.yk-graph-hero{display:grid;align-content:start;gap:13px;padding:17px;border:1px solid #293c4d;border-radius:10px;background:#142331}.yk-panel-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.yk-panel-title h2{margin:0;color:#e8f0f6;font-size:14px}.yk-muted{color:#8499ad;font-size:11px}.yk-bars{display:grid;gap:13px;padding-top:4px}.yk-bar-row{display:grid;grid-template-columns:72px minmax(0,1fr) 34px;align-items:center;gap:10px;color:#a4b5c4;font-size:12px}.yk-bar-row strong{color:#e3edf4;text-align:right}.yk-bar-track{height:8px;overflow:hidden;border-radius:99px;background:#233747}.yk-bar{display:block;height:100%;border-radius:99px}.yk-bar-queued{background:#5d9cf4}.yk-bar-processing{background:#39c7b3}.yk-bar-failed{background:#e27b85}.yk-record,.yk-memory-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:13px 0;border-top:1px solid #27394a}.yk-record:first-child,.yk-memory-row:first-child{border-top:0}.yk-record-icon{display:grid;width:28px;height:28px;flex:0 0 28px;place-items:center;border-radius:7px;background:#1d3447;color:#78b5ef}.yk-record-main,.yk-memory-main{display:grid;min-width:0;gap:4px;flex:1}.yk-record-main strong,.yk-memory-main strong{overflow:hidden;color:#dce8f1;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.yk-record-main span,.yk-record-main small,.yk-memory-main small,.yk-memory-main p{margin:0;overflow:hidden;color:#8499ad;font-size:11px;line-height:1.55;text-overflow:ellipsis;white-space:nowrap}.yk-empty-compact{display:grid;min-height:88px;place-items:center;color:#8095a9;font-size:12px}.yk-template-list{display:grid;gap:7px}.yk-template{display:grid;grid-template-columns:29px 1fr auto;align-items:center;gap:9px;width:100%;padding:9px;border:1px solid transparent;border-radius:8px;background:#182a39;color:inherit;text-align:left;cursor:pointer}.yk-template:hover{border-color:#376378}.yk-template b{display:grid;width:29px;height:29px;place-items:center;border-radius:7px;background:#255b66;color:#8be5d1}.yk-template span{display:grid;min-width:0;gap:2px}.yk-template strong,.yk-template small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yk-template strong{font-size:12px}.yk-template small{color:#8197ab;font-size:10px}.yk-template em{color:#72cbbd;font-size:10px;font-style:normal}.yk-recall,.yk-graph-hero{grid-template-columns:minmax(0,.65fr) minmax(0,1.35fr);align-items:end}.yk-recall h2,.yk-graph-hero h2{margin:5px 0 0;font-size:18px}.yk-recall p,.yk-graph-hero p{margin:4px 0 0;color:#899daf;font-size:12px}.yk-search-row{display:flex;gap:8px}.yk-search-row input{box-sizing:border-box;min-width:0;width:100%;height:38px;padding:0 12px;border:1px solid #385064;border-radius:7px;outline:0;background:#0f1b26;color:#ecf5f8;font:inherit;font-size:12px}.yk-search-row input:focus{border-color:#45bfae;box-shadow:0 0 0 2px #2a746d55}.yk-search-row input::placeholder{color:#63798d}.yk-primary,.yk-row-actions button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:0 11px;border:1px solid #3cbaa9;border-radius:7px;background:#1b756d;color:#eafffa;font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}.yk-primary:disabled{opacity:.45}.yk-filter{align-items:center}.yk-filter button{height:29px;padding:0 11px;border:1px solid #304657;border-radius:999px;background:#142331;color:#8da2b5;font:inherit;font-size:11px;cursor:pointer}.yk-filter button.is-active{border-color:#3cbaa9;background:#183e42;color:#90e8d8}.yk-memory-row{align-items:center}.yk-memory-main{gap:6px}.yk-memory-head{display:flex;align-items:center;gap:8px;min-width:0}.yk-memory-head strong{flex:1}.yk-memory-status{padding:3px 7px;border-radius:999px;background:#3f3420;color:#e4be72;font-size:10px;white-space:nowrap}.yk-memory-confirmed .yk-memory-status{background:#19443d;color:#72d9c3}.yk-memory-main p{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.yk-row-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}.yk-row-actions button{min-height:29px;padding:0 8px;background:#183945;color:#8ee4d4;font-size:10px}.yk-row-actions .yk-quiet{border-color:#394650;background:transparent;color:#9aabb9}.yk-chips{gap:7px}.yk-chip{max-width:100%;padding:7px 10px;overflow:hidden;border:1px solid #2d4e5b;border-radius:999px;background:#142b38;color:#83cfc4;font:inherit;font-size:11px;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.yk-graph-panel{min-height:410px}.yk-graph-wrap{display:grid;gap:12px}.yk-graph-meta{display:flex;flex-wrap:wrap;gap:7px;color:#8ba0b2;font-size:11px}.yk-graph-meta span{padding:5px 8px;border-radius:5px;background:#1a2c3b}.yk-graph-canvas{width:100%;max-height:520px;overflow:auto;border:1px solid #2a4052;border-radius:8px;background:#101d29}.yk-graph-canvas svg{display:block;width:100%;min-width:680px}.yk-edge{stroke:#3c6571;stroke-width:1.4;stroke-dasharray:4 3}.yk-node{cursor:pointer;outline:0}.yk-node circle{fill:#245866;stroke:#65cdbd;stroke-width:2}.yk-node:nth-of-type(4n) circle{fill:#314f72;stroke:#78aff0}.yk-node:nth-of-type(4n+1) circle{fill:#59457b;stroke:#b99af5}.yk-node.is-selected circle{fill:#d9fff7;stroke:#74f0da;stroke-width:3}.yk-node text{fill:#b8cad6;font-size:10px}.yk-node.is-selected text{fill:#f2fffc;font-weight:700}.yk-node-detail{display:grid;gap:4px;padding:10px 12px;border-left:2px solid #43c5b4;background:#182b39}.yk-node-detail strong{font-size:13px}.yk-node-detail small{overflow:hidden;color:#8399ac;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.yk-node-detail-empty{display:block;color:#7e94a8;font-size:12px}.yk-graph-empty,.yk-empty{display:grid;min-height:220px;place-items:center;align-content:center;gap:9px;color:#8196a9;font-size:12px;text-align:center}.yk-graph-empty p{margin:0}.yk-inline-error{display:flex;align-items:center;gap:7px;max-width:1180px;margin:0 auto;padding:9px 11px;border:1px solid #6d3c45;border-radius:7px;background:#301f27;color:#ef9ca4;font-size:12px}.yk-loading{grid-auto-flow:column;justify-content:center}.yk-error button{display:inline-flex;align-items:center;gap:5px;min-height:32px;padding:0 10px;border:1px solid #3b5364;border-radius:6px;background:#182b3b;color:inherit;font:inherit;cursor:pointer}.yk-spinner{width:18px;height:18px;border:2px solid #385061;border-top-color:#43c5b4;border-radius:50%;animation:yk-spin .8s linear infinite}@keyframes yk-spin{to{transform:rotate(360deg)}}@media(max-width:900px){.yk-recall,.yk-graph-hero,.yk-grid-2{grid-template-columns:1fr}}@media(max-width:800px){.yk-header,.yk-tabs{padding-left:17px;padding-right:17px}.yk-content{padding:18px 17px 32px}.yk-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.yk-metric:nth-child(2){border-right:0}.yk-metric:nth-child(-n+2){border-bottom:1px solid #293c4d}.yk-record,.yk-memory-row{align-items:flex-start;flex-direction:column}.yk-row-actions{width:100%;justify-content:flex-start}.yk-row-actions button{flex:1}}@media(max-width:520px){.yk-header h1{font-size:18px}.yk-header p{display:none}.yk-metric{min-height:76px;padding:11px}.yk-metric strong{font-size:21px}.yk-search-row{flex-direction:column}.yk-search-row .yk-primary{width:100%}.yk-tabs button{padding:0 11px}.yk-template{grid-template-columns:29px minmax(0,1fr)}.yk-template em{grid-column:2}.yk-graph-panel{min-height:340px}}`;
const stateCss = `.yk-overlay button:focus-visible,.yk-overlay input:focus-visible,.yk-overlay [role=button]:focus-visible{outline:2px solid #77e5d5;outline-offset:2px}.yk-eyebrow{color:#8197ab;letter-spacing:0}.yk-search-row input::placeholder{color:#8499ad}.yk-source-queued{border-color:#365e86;color:#83b9ef}.yk-source-queued i{background:#69a9e9}.yk-source-unavailable{border-color:#5f4b31;color:#d9b36f}.yk-source-unavailable i{background:#c99b4d}.yk-type-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.yk-type-stats>div{display:flex;min-width:0;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 10px;border:1px solid #2b4051;border-radius:7px;background:#11202c}.yk-type-stats strong{margin-right:3px;color:#dce8f1;font-size:11px}.yk-type-stats span{padding:3px 6px;border-radius:4px;background:#1d3342;color:#99afc0;font-size:10px}.yk-node-detail button{justify-self:start;min-height:29px;padding:0 9px;border:1px solid #3cbaa9;border-radius:6px;background:#183945;color:#8ee4d4;font:inherit;font-size:11px;cursor:pointer}.yk-inline-warning{padding:8px 10px;border:1px solid #5f4b31;border-radius:7px;background:#2a241b;color:#d9b36f;font-size:11px}@media(max-width:600px){.yk-type-stats{grid-template-columns:1fr}}`;
function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(NS, copy),
    "dofe-yootun-knowledge: dictionaries",
  );
  ctx.effect(() => {
    window.addEventListener(OVERLAY_EVENT, closeOtherOverlay);
    return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay);
  }, "dofe-yootun-knowledge: exclusive-overlay");
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "@dofe/dsh-yootun-knowledge";
    style.textContent = css + stateCss;
    document.head.appendChild(style);
    return () => style.remove();
  }, "dofe-yootun-knowledge: styles");
  const t = ctx.locale.bind(NS);
  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "dofe-yootun-knowledge",
        order: 45,
        inject: () => ({ t }),
      },
      Button,
    ),
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dofe-yootun-knowledge",
        order: 45,
        inject: () => ({ t }),
      },
      Overlay,
    ),
  );
}
module.exports = {
  apply,
  inject: ["slots", "locale"],
  __test: {
    graphLayout,
    graphTypeCounts,
    normalizeGraph,
    normalizeSourceState,
    recallItems,
    toolData,
  },
};
