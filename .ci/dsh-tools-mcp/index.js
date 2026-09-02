export const name = 'tools-geo-guidance'
export const inject = ['systemPrompt']

export function apply(ctx) {
  return ctx.systemPrompt.section({
    name: 'tools:geo-guidance',
    order: 7,
    text: '优惠豚 GEO 调研使用 mcp__tools-platform__* 做能力发现，使用 mcp__tools-hotspot-discovery__* 做热点运行与事件读取，必要时使用 mcp__tools-browser-intelligence__* 补充网页证据。先 preview/读取再运行；任何 Tools 写操作必须带 confirm=true 和稳定 idempotencyKey，不确定响应必须读取回执对账。',
  })
}

