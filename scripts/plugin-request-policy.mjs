import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const readRequests = [
  ['audit', 'requestJson("", suppliedSignal)'],
  ['content-command', 'load(suppliedSignal)'],
  ['dashboard', 'loadDashboard("7d", "self", suppliedSignal)'],
  ['finops', 'load("week", suppliedSignal)'],
  ['finops', 'loadSeries(7, suppliedSignal)'],
  ['knowledge', 'load(suppliedSignal)'],
  ['recruiter', 'load(suppliedSignal)'],
  ['sales', 'load(suppliedSignal)'],
  ['supply-watch', 'load(suppliedSignal)'],
  ['daily-report', 'Overlay({ t: key => key })'],
]

// Execute the real client request code. Controlled deadlines let this check
// prove both cancellation paths without waiting 30 seconds or using a network.
async function verifyRequest(source, expression, mode, daily) {
  const requests = []
  const deadlines = []
  const effects = []
  const controllers = []
  const supplied = new AbortController()
  const cancelled = new DOMException('View closed', 'AbortError')
  if (mode === 'already-cancelled') supplied.abort(cancelled)
  const react = {
    createElement: () => null,
    useState: initial => [initial, () => {}],
    useRef: initial => ({ current: initial }),
    useSyncExternalStore: () => true,
    useEffect: callback => effects.push(callback),
  }
  const module = { exports: {} }
  const context = vm.createContext({
    require: name => name === 'react' ? react : {},
    module,
    exports: module.exports,
    AbortController: class extends AbortController {
      constructor() { super(); controllers.push(this) }
    },
    AbortSignal: {
      any: signals => AbortSignal.any(signals),
      timeout: ms => {
        const controller = new AbortController()
        deadlines.push({ ms, controller })
        return controller.signal
      },
    },
    suppliedSignal: mode === 'without-caller' ? undefined : supplied.signal,
    requestAnimationFrame: callback => callback(),
    fetch: async (url, options) => {
      requests.push({ url, options })
      return { ok: true, json: async () => ({}) }
    },
  })
  vm.runInContext(source, context)
  await vm.runInContext(expression, context)
  const cleanups = daily ? effects.map(callback => callback()).filter(Boolean) : []
  try {
    assert.equal(requests.length, 1, 'must dispatch one request')
    assert.equal(deadlines.length, 1, 'a caller signal must not bypass the deadline')
    assert.equal(deadlines[0].ms, 30000, 'must bound reads to 30 seconds')
    const { signal, credentials, redirect } = requests[0].options
    assert(signal instanceof AbortSignal, 'fetch must receive a cancellation signal')
    assert.equal(credentials, 'same-origin')
    assert.equal(redirect, 'error')
    const caller = daily ? controllers[0] : supplied
    if (mode === 'already-cancelled') {
      assert.equal(signal.aborted, true, 'must retain an already-cancelled caller')
      assert.equal(signal.reason, cancelled)
    } else if (mode === 'cancel') {
      caller.abort(cancelled)
      assert.equal(signal.aborted, true, 'closing the view must cancel its request')
      assert.equal(signal.reason, cancelled)
    } else {
      const timeout = new DOMException('Request timed out', 'TimeoutError')
      deadlines[0].controller.abort(timeout)
      assert.equal(signal.aborted, true, 'a deadline must cancel requests with a caller signal')
      assert.equal(signal.reason, timeout)
      assert.equal(caller.signal.aborted, false, 'timeout must not cancel the view controller')
    }
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
}

export async function auditPluginRequestCancellation(ciRoot) {
  const failures = []
  for (const [name, expression] of readRequests) {
    const source = await readFile(new URL(`dsh-yootun-${name}/src/client.js`, ciRoot), 'utf8')
    const daily = name === 'daily-report'
    for (const mode of daily ? ['timeout', 'cancel'] : ['timeout', 'cancel', 'already-cancelled', 'without-caller']) {
      try {
        await verifyRequest(source, expression, mode, daily)
      } catch (error) {
        failures.push(`dsh-yootun-${name}: ${expression} (${mode}): ${error.message.split('\n')[0]}`)
      }
    }
  }
  return failures
}
