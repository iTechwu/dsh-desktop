import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { apply } from '../index.js'
test('retrofit package exposes a DSH client and guarded host route', async () => { const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url))); assert.equal(manifest.name, '@dofe/dsh-yootun-retrofit'); assert.equal(manifest.exports['./client'], './lib/client.js') })
test('host delegates to the available custom-car tool without exposing credentials', async () => { let route; const calls = []; apply({ tools: { schemas: () => [{ name: 'custom_car_monitoring' }], execute: async value => { calls.push(value); return { content: [{ type: 'text', text: 'ok' }, { type: 'image', data: 'secret' }] } } }, webServer: { register(value) { route = value; return () => {} } }, effect(factory) { return factory() } }); const result = await invoke(route, { query: 'SUV 灯光升级' }); assert.equal(result.status, 200); assert.equal(result.body.status, 'ready'); assert.equal(calls[0].name, 'custom_car_monitoring'); assert.deepEqual(result.body.result.content, [{ type: 'text', text: 'ok' }]) })
async function invoke(route, body) { let status; let raw = ''; await route.handler({ method: 'POST', body }, { writeHead(value) { status = value; return this }, end(value) { raw += value } }); return { status, body: JSON.parse(raw) } }
