import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as RecruiterTools from '../src/yootun-recruiter-tools.ts'

let sequence = 0
const signal = new AbortController().signal

async function mount(statePath: string) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(RecruiterTools, { statePath })
  return ctx
}

function call(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal,
    callId: `recruiter-${String(++sequence)}` as never,
    name: 'yootun_recruiter',
    arguments: args,
  })
}

describe('Yootun recruiter Agent tool', () => {
  let directory: string | undefined

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
    directory = undefined
  })

  it('registers the bounded operations and confirmation policy', async () => {
    directory = await mkdtemp(join(tmpdir(), 'yootun-recruiter-tools-'))
    const ctx = await mount(join(directory, 'state.json'))
    const tool = ctx.tools.get('yootun_recruiter')
    expect((tool?.parameters as { properties: { operation: { enum: string[] } } }).properties.operation.enum)
      .toEqual(['list', 'save_requirement', 'save_candidate_analysis', 'queue_action'])
    const prompt = (await ctx.systemPrompt.assemble()).sections.map(section => section.text).join('\n')
    expect(prompt).toContain('必须由用户在招聘工作台确认')
    expect(prompt).toContain('不得传入原始简历')
    expect(prompt).toContain('sidebar_open')
    expect(prompt).toContain('不得读取或保存 Cookie、二维码和页面会话')
  })

  it('builds a role, candidate analysis, and pending external action', async () => {
    directory = await mkdtemp(join(tmpdir(), 'yootun-recruiter-tools-'))
    const ctx = await mount(join(directory, 'state.json'))
    const role = await call(ctx, {
      operation: 'save_requirement', title: '企业销售', department: '销售部', location: '杭州',
      employmentType: '全职', headcount: 2, responsibilities: ['拓展客户'],
      requiredSkills: ['企业销售'], preferredSkills: ['SaaS'], status: 'active',
    })
    expect(role.isError).toBe(false)
    const roleId = (role.value as unknown as RecruiterTools.RecruiterToolValue).snapshot.requirements[0]?.id
    const candidate = await call(ctx, {
      operation: 'save_candidate_analysis', displayName: '候选人 A', requirementId: roleId,
      stage: 'screening', matchScore: 82, evidence: ['三年企业销售经验'], concerns: ['行业经验待核实'],
      interviewQuestions: ['描述一次复杂成交'], feedbackStatus: 'draft',
    })
    expect(candidate.isError).toBe(false)
    const queued = await call(ctx, {
      operation: 'queue_action', type: 'send_message', targetLabel: '候选人 A', summary: '邀请进行初次沟通',
    })
    const value = queued.value as unknown as RecruiterTools.RecruiterToolValue
    expect(value.message).toContain('尚未发送')
    expect(value.snapshot.dashboard).toMatchObject({ openRoles: 1, activeCandidates: 1, pendingConfirmation: 1 })
    expect(value.snapshot.actions[0]?.status).toBe('awaiting_confirmation')
  })

  it('serializes concurrent updates without losing either role', async () => {
    directory = await mkdtemp(join(tmpdir(), 'yootun-recruiter-tools-'))
    const statePath = join(directory, 'state.json')
    const base = {
      department: '研发部', location: '远程', employmentType: '全职', headcount: 1,
      responsibilities: ['交付'], requiredSkills: ['TypeScript'], preferredSkills: [], status: 'active' as const,
    }
    await Promise.all([
      RecruiterTools.operateRecruiter(statePath, { operation: 'save_requirement', title: '前端工程师', ...base }),
      RecruiterTools.operateRecruiter(statePath, { operation: 'save_requirement', title: '后端工程师', ...base }),
    ])
    const listed = await RecruiterTools.operateRecruiter(statePath, { operation: 'list' })
    expect(listed.snapshot.requirements.map(item => item.title).sort()).toEqual(['前端工程师', '后端工程师'])
  })
})
