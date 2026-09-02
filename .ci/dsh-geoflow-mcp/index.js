export const name = 'geoflow-geo-guidance'
export const inject = ['systemPrompt']

export function apply(ctx) {
  return ctx.systemPrompt.section({
    name: 'geoflow:geo-guidance',
    order: 8,
    text: 'GeoFlow 操作使用 mcp__geoflow__*。先调用 catalog/capabilities 确认租户和对象契约。自动化只允许读取，以及在明确 draft 模式下创建/更新任务和待审核草稿；每次写入使用稳定 idempotency_key 并回读校验。禁止 review、publish、trash、delete，禁止自动发布。',
  })
}

