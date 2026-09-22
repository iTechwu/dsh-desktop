import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// 以受控沙箱加载 src/client.js，取回 createTaskMachine（纯逻辑，无 React/浏览器依赖）。
// 顶层的 react / primitives 只做占位，因为本测试只驱动状态机、不渲染组件。
function loadClient(source) {
  const module = { exports: {} }
  const require = name => {
    if (name === 'react') return { createElement: () => ({}), useEffect: () => {}, useState: () => [undefined, () => {}], useSyncExternalStore: () => undefined }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconCloseOutline16: {}, IconEditOutline16: {}, MarkdownText: {}, Tooltip: {} }
    throw new Error(`unexpected require: ${name}`)
  }
  const window = {}
  const document = {}
  new Function('require', 'module', 'exports', 'window', 'document', source)(require, module, module.exports, window, document)
  return module.exports
}

const { createTaskMachine } = loadClient(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'))

const VERSIONS = [{ version: 'A', title: 'a', body: '**a**', tags: [] }, { version: 'B', title: 'b', body: 'b', tags: [] }, { version: 'C', title: 'c', body: 'c', tags: [] }]

// 手动假定时器：schedule 捕获回调，测试里用 fire() 手动推进到下一个轮询周期。
function fakeTimers() {
  let scheduled = null
  return {
    schedule: fn => { scheduled = fn; return 1 },
    clear: () => { scheduled = null },
    fire: async () => { const fn = scheduled; scheduled = null; if (fn) await fn() },
    get pending() { return scheduled !== null },
  }
}

function makeMachine(overrides = {}) {
  const timers = fakeTimers()
  const machine = createTaskMachine({
    createTask: overrides.createTask || (async body => ({ taskId: 't-1', taskStatus: 'queued', mediaType: body.mediaType })),
    queryStatus: overrides.queryStatus || (async () => ({ taskStatus: 'running', currentStep: 'copywriting' })),
    queryResult: overrides.queryResult || (async () => ({ versions: VERSIONS })),
    cancelTask: overrides.cancelTask || (async () => {}),
    intervalMs: 30000,
    schedule: timers.schedule,
    clearSchedule: timers.clear,
    onChange: overrides.onChange || (() => {}),
  })
  return { machine, timers }
}

test('create → poll → succeeded → result returns three versions', async () => {
  const statuses = [{ taskStatus: 'running' }, { taskStatus: 'succeeded' }]
  let i = 0
  const { machine, timers } = makeMachine({ queryStatus: async () => statuses[i++] })
  await machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  assert.equal(machine.get().task.taskStatus, 'running')
  assert.ok(timers.pending)
  await timers.fire()
  assert.equal(machine.get().task.taskStatus, 'succeeded')
  assert.equal(machine.get().versions.length, 3)
  assert.equal(machine.get().error, '')
  assert.equal(timers.pending, false)
})

test('create returning failed surfaces failure', async () => {
  const { machine } = makeMachine({ createTask: async () => ({ taskId: 't-1', taskStatus: 'failed' }) })
  await machine.submit({ action: 'create', mediaType: 'video', idempotencyKey: 'k1' })
  assert.equal(machine.get().task.taskStatus, 'failed')
  assert.equal(machine.get().error, 'failed')
  assert.equal(machine.get().versions, null)
})

test('poll failed keeps step and controlled reason for display', async () => {
  const { machine } = makeMachine({
    queryStatus: async () => ({
      taskStatus: 'failed', currentStep: 'copywriting', nextStep: 'copywriting',
      errorCode: 'copywriting_failed', errorMessage: 'no fact or reference basis for copywriting',
    }),
  })
  await machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  const state = machine.get()
  assert.equal(state.error, 'failed')
  assert.deepEqual(state.failure, { step: 'copywriting', errorCode: 'copywriting_failed', errorMessage: 'no fact or reference basis for copywriting' })
})

test('poll cancelled clears failure detail', async () => {
  const { machine } = makeMachine({ queryStatus: async () => ({ taskStatus: 'cancelled', currentStep: 'copywriting' }) })
  await machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  assert.equal(machine.get().error, 'cancelled')
  assert.equal(machine.get().failure, null)
})

test('failed failure detail survives terminal resume and is cleared on resubmit', async () => {
  let statusCalls = 0
  const { machine } = makeMachine({
    createTask: async body => ({ taskId: body.idempotencyKey, taskStatus: 'queued', mediaType: body.mediaType }),
    queryStatus: async () => {
      statusCalls++
      if (statusCalls === 1) return { taskStatus: 'failed', currentStep: 'copywriting', errorCode: 'copywriting_failed', errorMessage: 'no fact or reference basis for copywriting' }
      return { taskStatus: 'queued', currentStep: 'ingest' }
    },
  })
  await machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  assert.deepEqual(machine.get().failure, { step: 'copywriting', errorCode: 'copywriting_failed', errorMessage: 'no fact or reference basis for copywriting' })
  // 终态 resume：轮询走 isTerminal 分支，failure 详情保留（跨页面开关可见）
  await machine.resume()
  assert.deepEqual(machine.get().failure, { step: 'copywriting', errorCode: 'copywriting_failed', errorMessage: 'no fact or reference basis for copywriting' })
  // 重新提交新任务（queued）：failure 清空，不残留上一轮失败引导
  await machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k2' })
  assert.equal(machine.get().failure, null)
  assert.equal(machine.get().task.idempotencyKey, 'k2')
})

test('create returning cancelled surfaces cancelled', async () => {
  const { machine } = makeMachine({ createTask: async () => ({ taskId: 't-1', taskStatus: 'cancelled' }) })
  await machine.submit({ action: 'create', mediaType: 'video', idempotencyKey: 'k1' })
  assert.equal(machine.get().error, 'cancelled')
})

test('transient status failure retries and eventually succeeds', async () => {
  let statusCalls = 0
  const { machine, timers } = makeMachine({
    queryStatus: async () => { statusCalls++; if (statusCalls === 1) throw new Error('network'); return { taskStatus: 'succeeded' } },
  })
  await machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  assert.equal(machine.get().error, 'pollFailed')
  assert.ok(timers.pending)
  await timers.fire()
  assert.equal(machine.get().task.taskStatus, 'succeeded')
  assert.equal(machine.get().versions.length, 3)
  assert.equal(machine.get().error, '')
})

test('stop() halts polling; resume() continues', async () => {
  let statusCalls = 0
  const { machine, timers } = makeMachine({ queryStatus: async () => { statusCalls++; return { taskStatus: 'running' } } })
  await machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  assert.ok(timers.pending)
  machine.stop()
  assert.equal(timers.pending, false)
  const callsAfterStop = statusCalls
  await machine.resume()
  assert.equal(statusCalls, callsAfterStop + 1)
  assert.ok(timers.pending)
})

test('result without exactly three versions sets resultFailed', async () => {
  const { machine } = makeMachine({ queryStatus: async () => ({ taskStatus: 'succeeded' }), queryResult: async () => ({ versions: [{ version: 'A' }, { version: 'B' }] }) })
  await machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  assert.equal(machine.get().error, 'resultFailed')
  assert.equal(machine.get().versions, null)
})

test('create failure surfaces createFailed and keeps no versions', async () => {
  const { machine } = makeMachine({ createTask: async () => { throw new Error('create_failed') } })
  await machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  assert.equal(machine.get().error, 'createFailed')
  assert.equal(machine.get().task, null)
  assert.equal(machine.get().versions, null)
})

test('stop during in-flight create does not start polling', async () => {
  let resolveCreate
  let statusCalls = 0
  const { machine, timers } = makeMachine({
    createTask: () => new Promise(resolve => { resolveCreate = resolve }),
    queryStatus: async () => { statusCalls++; return { taskStatus: 'running' } },
  })
  const submitPromise = machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  // 创建请求尚未返回时关闭页面
  machine.stop()
  // 创建请求返回
  resolveCreate({ taskId: 't-1', taskStatus: 'queued', mediaType: 'images' })
  await submitPromise
  // 关闭后不得启动轮询
  assert.equal(statusCalls, 0)
  assert.equal(timers.pending, false)
  // 任务已保存，重开页面 resume 可继续查询
  assert.equal(machine.get().task.taskId, 't-1')
  await machine.resume()
  assert.equal(statusCalls, 1)
})

test('reopening before in-flight create completes starts polling after create', async () => {
  let resolveCreate
  let statusCalls = 0
  const { machine, timers } = makeMachine({
    createTask: () => new Promise(resolve => { resolveCreate = resolve }),
    queryStatus: async () => { statusCalls++; return { taskStatus: 'running' } },
  })
  const submitPromise = machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  machine.stop()
  await machine.resume()
  assert.equal(statusCalls, 0)
  resolveCreate({ taskId: 't-1', taskStatus: 'queued', mediaType: 'images' })
  await submitPromise
  assert.equal(machine.get().task.taskId, 't-1')
  assert.equal(statusCalls, 1)
  assert.equal(timers.pending, true)
})

test('requestCancel stops polling and lands cancelled', async () => {
  let statusCalls = 0
  const { machine, timers } = makeMachine({ queryStatus: async () => { statusCalls++; return { taskStatus: 'running' } } })
  await machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  assert.ok(timers.pending)
  await machine.requestCancel()
  assert.equal(machine.get().task.taskStatus, 'cancelled')
  assert.equal(machine.get().error, 'cancelled')
  assert.equal(timers.pending, false)
  assert.equal(statusCalls, 1) // 取消后不再轮询
})

test('requestCancel failure resumes polling and surfaces cancelFailed', async () => {
  const { machine, timers } = makeMachine({
    queryStatus: async () => ({ taskStatus: 'running' }),
    cancelTask: async () => { throw new Error('cancel_failed') },
  })
  await machine.submit({ action: 'create', mediaType: 'images', idempotencyKey: 'k1' })
  await machine.requestCancel()
  assert.equal(machine.get().task.taskStatus, 'running')
  assert.equal(machine.get().error, 'cancelFailed')
  assert.ok(timers.pending)
})

test('requestCancel without a task is a no-op', async () => {
  const { machine, timers } = makeMachine()
  await machine.requestCancel()
  assert.equal(machine.get().task, null)
  assert.equal(machine.get().error, '')
  assert.equal(timers.pending, false)
})
