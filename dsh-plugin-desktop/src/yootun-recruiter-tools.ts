/** Agent-facing recruitment workspace tools with mandatory human confirmation for external actions. */

import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  mutateRecruiterState,
  readRecruiterState,
  recruiterSnapshot,
  type RecruiterSnapshot,
} from './yootun-recruiter-route.ts'

export const name = 'desktop-yootun-recruiter-tools'
export const inject = ['tools', 'systemPrompt']

const OPERATIONS = ['list', 'save_requirement', 'save_candidate_analysis', 'queue_action'] as const

export interface Config {
  statePath?: string
}

export const Config: z<Config> = z.object({ statePath: z.string() })

export interface RecruiterToolArgs {
  operation: typeof OPERATIONS[number]
  id?: string
  title?: string
  department?: string
  location?: string
  employmentType?: string
  headcount?: number
  salaryMin?: number
  salaryMax?: number
  responsibilities?: string[]
  requiredSkills?: string[]
  preferredSkills?: string[]
  status?: 'draft' | 'active' | 'paused' | 'closed'
  displayName?: string
  requirementId?: string
  stage?: 'sourced' | 'screening' | 'interview' | 'offer' | 'hired' | 'archived'
  matchScore?: number
  evidence?: string[]
  concerns?: string[]
  interviewQuestions?: string[]
  feedbackStatus?: 'none' | 'draft' | 'confirmed'
  type?: 'publish_jd' | 'send_message' | 'write_feedback'
  targetLabel?: string
  summary?: string
}

export interface RecruiterToolValue {
  ok: true
  operation: typeof OPERATIONS[number]
  message: string
  snapshot: RecruiterSnapshot
}

function mutation(args: RecruiterToolArgs): Record<string, unknown> {
  if (args.operation === 'save_requirement') {
    return {
      action: args.operation,
      ...(args.id === undefined ? {} : { id: args.id }),
      title: args.title, department: args.department, location: args.location,
      employmentType: args.employmentType, headcount: args.headcount,
      ...(args.salaryMin === undefined ? {} : { salaryMin: args.salaryMin }),
      ...(args.salaryMax === undefined ? {} : { salaryMax: args.salaryMax }),
      responsibilities: args.responsibilities, requiredSkills: args.requiredSkills,
      preferredSkills: args.preferredSkills, status: args.status,
    }
  }
  if (args.operation === 'save_candidate_analysis') {
    return {
      action: args.operation,
      ...(args.id === undefined ? {} : { id: args.id }),
      displayName: args.displayName, requirementId: args.requirementId, stage: args.stage,
      ...(args.matchScore === undefined ? {} : { matchScore: args.matchScore }),
      evidence: args.evidence, concerns: args.concerns,
      interviewQuestions: args.interviewQuestions, feedbackStatus: args.feedbackStatus,
    }
  }
  return { action: args.operation, type: args.type, targetLabel: args.targetLabel, summary: args.summary }
}

export async function operateRecruiter(
  statePath: string,
  args: RecruiterToolArgs,
  now = new Date().toISOString(),
): Promise<RecruiterToolValue> {
  const snapshot = args.operation === 'list'
    ? recruiterSnapshot(await readRecruiterState(statePath, now))
    : await mutateRecruiterState(statePath, mutation(args), now)
  const message = args.operation === 'queue_action'
    ? '动作已进入待人工确认队列，尚未发送到外部平台。'
    : args.operation === 'list' ? '已读取招聘工作台。' : '招聘工作台已更新。'
  return { ok: true, operation: args.operation, message, snapshot }
}

function render(value: RecruiterToolValue): string {
  const { dashboard } = value.snapshot
  return [
    value.message,
    `岗位 ${String(dashboard.openRoles)}，活跃候选人 ${String(dashboard.activeCandidates)}，待人工确认 ${String(dashboard.pendingConfirmation)}。`,
    JSON.stringify({
      requirements: value.snapshot.requirements,
      candidates: value.snapshot.candidates,
      actions: value.snapshot.actions,
    }),
  ].join('\n')
}

export function apply(ctx: Context, config: Config): void {
  const statePath = config.statePath ?? dshHomePath('storages', 'yootun-recruiter', 'state.json')
  ctx.systemPrompt.section({
    name: 'tool:yootun-recruiter',
    order: 117,
    text: '使用 yootun_recruiter 管理企业招聘工作台。先保存岗位，再保存脱敏后的候选人分析；不得传入原始简历、联系方式、证件或其他敏感字段。用户需要连接 BOSS 直聘时，若存在 sidebar_open 工具则在其会话侧边栏打开官方登录页 https://www.zhipin.com/web/user/?ka=header-login，由用户自行登录和操作；不得读取或保存 Cookie、二维码和页面会话，本期不得自动抓取页面数据。publish_jd、send_message、write_feedback 只能创建待确认动作，必须由用户在招聘工作台确认；工具不能确认或直接发送外部动作。',
  })
  ctx.tools.register(defineTool({
    name: 'yootun_recruiter',
    description: '读取或更新本机招聘工作台。保存岗位与脱敏候选人分析，或创建等待用户确认的发布 JD、候选人消息和反馈动作；不会直接对外发送。',
    parameters: {
      operation: { type: 'string', required: true, enum: [...OPERATIONS], description: '操作类型。' },
      id: { type: 'string', description: '更新已有岗位或候选人时使用的 ID。' },
      title: { type: 'string', description: '岗位名称。' },
      department: { type: 'string', description: '所属部门。' },
      location: { type: 'string', description: '工作地点。' },
      employmentType: { type: 'string', description: '用工类型。' },
      headcount: { type: 'integer', description: '招聘人数。' },
      salaryMin: { type: 'number', description: '薪资下限。' },
      salaryMax: { type: 'number', description: '薪资上限。' },
      responsibilities: { type: 'array', items: { type: 'string' }, description: '岗位职责。' },
      requiredSkills: { type: 'array', items: { type: 'string' }, description: '必备技能。' },
      preferredSkills: { type: 'array', items: { type: 'string' }, description: '加分技能。' },
      status: { type: 'string', enum: ['draft', 'active', 'paused', 'closed'], description: '岗位状态。' },
      displayName: { type: 'string', description: '候选人脱敏显示名。' },
      requirementId: { type: 'string', description: '关联岗位 ID。' },
      stage: { type: 'string', enum: ['sourced', 'screening', 'interview', 'offer', 'hired', 'archived'], description: '候选人阶段。' },
      matchScore: { type: 'integer', description: '0-100 匹配分。' },
      evidence: { type: 'array', items: { type: 'string' }, description: '与岗位相关的证据摘要。' },
      concerns: { type: 'array', items: { type: 'string' }, description: '风险与待核实项。' },
      interviewQuestions: { type: 'array', items: { type: 'string' }, description: '建议面试问题。' },
      feedbackStatus: { type: 'string', enum: ['none', 'draft', 'confirmed'], description: '反馈状态。' },
      type: { type: 'string', enum: ['publish_jd', 'send_message', 'write_feedback'], description: '待确认动作类型。' },
      targetLabel: { type: 'string', description: '动作目标的可读标签。' },
      summary: { type: 'string', description: '待用户确认的动作摘要。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: render(value as unknown as RecruiterToolValue) }],
    },
    async execute(args) {
      return operateRecruiter(statePath, args as RecruiterToolArgs) as unknown as Promise<Record<string, JsonValue>>
    },
  }))
}
