import { describe, expect, it, vi } from 'vitest'
import {
  buildYootunAuditEvent,
  type YootunAuditRecordInput,
  type YootunAuditRecorder,
} from '../src/yootun-audit-contract.ts'

const EVENT_ID = '018f47a2-4f10-4abc-8def-1234567890ab'

const validInput: YootunAuditRecordInput = {
  actionCode: 'sales.lead.created',
  category: 'create',
  source: {
    pluginId: '@dofe/dsh-yootun-sales',
    pluginVersion: '0.1.0',
    surface: 'human_ui',
  },
  target: { type: 'lead', id: 'lead-1', label: '华东客户' },
  outcome: 'succeeded',
  changes: [{ field: 'stage', before: 'new', after: 'qualified' }],
  effects: [],
}

const fixedRuntime = {
  now: () => new Date('2026-09-05T08:30:00.000Z'),
  randomUUID: () => EVENT_ID,
}

describe('Yootun audit client contract', () => {
  it('builds a versioned event using only registered safe fields', () => {
    expect(buildYootunAuditEvent(validInput, fixedRuntime)).toEqual({
      schemaVersion: 1,
      clientEventId: EVENT_ID,
      traceId: EVENT_ID,
      occurredAt: '2026-09-05T08:30:00.000Z',
      source: validInput.source,
      actionCode: validInput.actionCode,
      category: validInput.category,
      target: validInput.target,
      outcome: validInput.outcome,
      changes: validInput.changes,
      effects: [],
    })
  })

  it('preserves validated producer identity and time for idempotent terminal observations', () => {
    const event = buildYootunAuditEvent({
      ...validInput,
      clientEventId: '2e5fe668-b226-41fe-9e39-95cf162ec24a',
      traceId: 'job:rewrite-17',
      occurredAt: '2026-09-05T08:00:00.000+08:00',
    }, fixedRuntime)

    expect(event).toMatchObject({
      clientEventId: '2e5fe668-b226-41fe-9e39-95cf162ec24a',
      traceId: 'job:rewrite-17',
      occurredAt: '2026-09-05T08:00:00.000+08:00',
    })
  })

  it.each([
    'password',
    'cookie',
    'prompt',
    'phone',
    'email',
    'resume',
    'messageBody',
    'rawParams',
    'authorization',
    'absolutePath',
    'stack',
  ])('rejects forbidden field %s at any nesting depth', (field) => {
    expect(() => buildYootunAuditEvent({
      ...validInput,
      effects: [{ target: 'remote', outcome: 'failed', nested: { [field]: 'secret' } }],
    } as never, fixedRuntime)).toThrow('audit_field_forbidden')
  })

  it('rejects an unregistered action code', () => {
    expect(() => buildYootunAuditEvent({
      ...validInput,
      actionCode: 'unknown.action.executed',
    } as never, fixedRuntime)).toThrow('audit_action_unregistered')
  })

  it('requires category, target type and change fields to match the action projector', () => {
    expect(() => buildYootunAuditEvent({ ...validInput, category: 'update' } as never, fixedRuntime))
      .toThrow('audit_action_mismatch')
    expect(() => buildYootunAuditEvent({
      ...validInput,
      target: { type: 'contact', id: 'lead-1' },
    } as never, fixedRuntime)).toThrow('audit_action_mismatch')
    expect(() => buildYootunAuditEvent({
      ...validInput,
      changes: [{ field: 'phone', after: '13800000000' }],
    } as never, fixedRuntime)).toThrow('audit_field_forbidden')
  })

  it('enforces bounded arrays, text and serialized event size', () => {
    expect(() => buildYootunAuditEvent({
      ...validInput,
      changes: Array.from({ length: 21 }, () => ({ field: 'stage', after: 'new' })),
    }, fixedRuntime)).toThrow('audit_changes_too_many')
    expect(() => buildYootunAuditEvent({
      ...validInput,
      effects: Array.from({ length: 11 }, (_, index) => ({
        target: `remote-${index}`,
        outcome: 'succeeded' as const,
      })),
    }, fixedRuntime)).toThrow('audit_effects_too_many')
    expect(() => buildYootunAuditEvent({
      ...validInput,
      target: { type: 'lead', id: 'lead-1', label: 'x'.repeat(161) },
    }, fixedRuntime)).toThrow('audit_value_invalid')
  })

  it('keeps the recorder failure-closed contract explicit', async () => {
    const recorder: YootunAuditRecorder = {
      record: vi.fn().mockResolvedValue({ status: 'failed', clientEventId: EVENT_ID }),
    }

    await expect(recorder.record(validInput)).resolves.toEqual({
      status: 'failed',
      clientEventId: EVENT_ID,
    })
  })
})
