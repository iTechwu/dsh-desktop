/** Model-facing routing contract for enterprise Knowledge versus public Web. */

export type KnowledgeRoute = 'knowledge' | 'web' | 'mixed'

const ENTERPRISE_TERMS = [
  '优惠豚', '企业', '公司', '园区', '会员', '客户', '供应商', '招聘', '候选人', '员工',
  '岗位', '面试', '制度', '流程', '服务标准', '5s', '销售', '线索', '库存', '交付',
  '供应链', '财务', '知识库', 'memory', '记忆', '内部', '团队', '项目', '合同', '复盘',
  'youhuitun', 'yootun', 'internal', 'company', 'customer', 'supplier', 'candidate',
  'employee', 'policy', 'procedure', 'runbook', 'knowledge base',
]

const PUBLIC_TERMS = [
  '新闻', '今天', '现在', '最新', '实时', '价格', '行情', '天气', '赛事', '比分', '股票',
  '汇率', '政策变化', '发布会', '官网', '来源', '网页', '新闻', 'today', 'latest', 'current',
  'real-time', 'price', 'weather', 'score', 'stock', 'exchange rate', 'news', 'official site',
]

function includesTerm(query: string, term: string): boolean {
  return query.includes(term)
}

export function classifyKnowledgeRoute(query: string): KnowledgeRoute {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized.length === 0) return 'knowledge'
  const enterprise = ENTERPRISE_TERMS.some(term => includesTerm(normalized, term))
  const web = PUBLIC_TERMS.some(term => includesTerm(normalized, term))
  if (enterprise && web) return 'mixed'
  if (enterprise) return 'knowledge'
  return 'web'
}

export const KNOWLEDGE_ROUTING_PROMPT = [
  '数据源路由规则（必须遵守）：',
  '1. 企业内部事实优先使用 knowledge_search；已确认经验、会话记忆或用户偏好使用 knowledge_recall。',
  '2. 企业内部事实包括优惠豚及其园区、公司、客户、会员、员工、招聘、销售、供应链、库存、财务、项目、制度、流程、服务标准、合同和历史复盘。',
  '3. 公开实时信息（新闻、今天/最新/当前、价格行情、天气、赛事、股票、汇率、官方网页）才使用 web_search/web_fetch。',
  '4. 混合问题必须先调用 Knowledge 获取企业事实，再按需调用 Web 获取外部实时信息；网页结果不能替代企业事实。',
  '5. 只要问题可能涉及企业事实，就先调用 knowledge_search 或 knowledge_recall，不要直接凭模型记忆作答。Knowledge 不可用时明确说明企业知识不可用；只有问题本身是公开信息时才降级到 Web。',
  '6. Knowledge 统一使用本地封装工具 knowledge_search、knowledge_recall、knowledge_loadout、knowledge_context_pack 等；不要调用任何 mcp__knowledge__* 直连工具，也不要给封装工具套用直连 MCP 的参数格式。',
  '7. Knowledge 结果必须保留文档、版本、Memory 或 Session 引用；没有引用不得把推断写成企业事实。',
].join('\n')
