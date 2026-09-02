export const name = 'georank-geo-guidance'
export const inject = ['systemPrompt']

export function apply(ctx) {
  return ctx.systemPrompt.section({
    name: 'georank:geo-guidance',
    order: 8,
    text: 'GEORank 操作使用 mcp__georank__* 工具。先用 georank_list_companies / georank_get_company 或 georank_solution_channels 确认目标与语境；提交诊断用 georank_diagnose_url（返回 report_id，为异步任务，需后续轮询 georank_get_diagnostic_report，而非一次性取结果）；拓词用 georank_expand_keywords，方案/问答用 georank_solution_chat。结构化工具（JSON-LD / llms.txt / 标题 / 知识库 / AI 友好度评分）用 georank_generate_*。读取类工具可直接用；诊断与生成类需要配置模型 API，失败时说明原因而不是伪造结果。',
  })
}
