/**
 * 真实 Cordis Loader 测试：用真正的 Cordis Context + Fiber + cordis-plugin-loader
 * 加载本插件，而不是普通对象 mock。
 *
 * Cordis / loader 从 sibling 的 dsh-desktop / deepseek-harness node_modules 解析；
 * 插件自身用 file:// URL 直接加载（不依赖本仓库之外未提交的 node_modules）。
 * 若 Cordis 不可解析，整组测试跳过（本仓库是零运行时依赖的纯插件仓库）。
 *
 * 覆盖：
 * - Loader 行 config 通过 apply(ctx, config) 传入；
 * - 没有 config / credential store / system prompt 服务时仍能加载；
 * - 工具注册幂等：重载后只存在一个 media_upload；
 * - 插件卸载后 media_upload 消失、路由清空；
 * - 注册失败时不留下半注册状态。
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = createRequire(import.meta.url)
const pluginUrl = fileURLToPath(new URL('../index.js', import.meta.url))

/** 依次在候选 node_modules 下解析 Cordis 包（相对路径定位 sibling 仓库，不写死本机绝对路径）。 */
function resolveCordis(specifier) {
  const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const bases = [
    join(workspaceRoot, 'dsh-desktop/dsh-plugin-desktop'),
    join(workspaceRoot, 'dsh-desktop'),
    join(workspaceRoot, 'deepseek-harness/vendor/cordis'),
    join(workspaceRoot, 'deepseek-harness'),
  ]
  for (const base of bases) {
    try {
      return here.resolve(`${specifier}`, { paths: [base] })
    } catch {
      // 尝试下一个候选。
    }
  }
  return null
}

const cordisEntry = resolveCordis('@deepseek-ai/cordis')
const loaderEntry = resolveCordis('@deepseek-ai/cordis-plugin-loader')
const resolvable = Boolean(cordisEntry && loaderEntry)

test('real cordis + loader are resolvable from the sibling checkout', { skip: resolvable ? false : 'cordis/loader 未解析到（无 sibling checkout）' }, () => {
  assert.ok(cordisEntry, '@deepseek-ai/cordis 必须可从 sibling 解析')
  assert.ok(loaderEntry, '@deepseek-ai/cordis-plugin-loader 必须可从 sibling 解析')
})

const cordis = cordisEntry && loaderEntry ? await import(cordisEntry) : null
const loaderModule = cordisEntry && loaderEntry ? await import(loaderEntry) : null
const { Context } = cordis ?? {}
const Loader = loaderModule?.Loader ?? loaderModule?.default

/** 提供一个真实 Cordis Context，并在 root 作用域提供 webServer/tools/credentials/systemPrompt。 */
async function bootServices({ withCredentials = true, withSystemPrompt = true } = {}) {
  const root = new Context()
  const state = { routes: new Map(), tools: new Map(), sections: [] }

  await root.plugin((ctx) => {
    ctx.provide('webServer', {
      port: 3000,
      register(route) {
        state.routes.set(route.path, route.handler)
        return () => state.routes.delete(route.path)
      },
    })
    ctx.provide('tools', {
      register(tool) {
        state.tools.set(tool.name, tool)
        return () => state.tools.delete(tool.name)
      },
    })
    if (withCredentials) {
      ctx.provide('credentials', {
        async resolve(key) { return { value: `${key}-stored` } },
      })
    }
    if (withSystemPrompt) {
      ctx.provide('systemPrompt', {
        section(section) {
          state.sections.push(section)
          return () => {
            const index = state.sections.indexOf(section)
            if (index >= 0) state.sections.splice(index, 1)
          }
        },
      })
    }
  })

  await root.plugin(Loader)
  const loader = root.get('loader')
  // 普通 Node 进程里没有 dsh CLI 的内部 ESM loader，退回 `import(name)`；
  // 本测试的 entry name 是 file:// URL，可直接 import。
  loader.internal = undefined
  return { root, loader, state }
}

/** 通过 Loader 加载本插件（file:// URL），等待激活完成。 */
async function loadEntry(loader, { id = 'dofe-yootun-tos-upload', config } = {}) {
  const entryId = await loader.create({ id, name: pluginUrl, config })
  await loader.await()
  return entryId
}

if (!cordis || !Loader) {
  test('cordis loader integration (skipped: cordis not resolvable)', { skip: true }, () => {})
} else {
  test('loader passes row config through apply(ctx, config)', async () => {
    const { loader, state } = await bootServices()
    await loadEntry(loader, { config: { tool: { timeoutMs: 4242 } } })

    const tool = state.tools.get('media_upload')
    assert.ok(tool, 'media_upload 必须通过真实 Loader 注册')
    assert.equal(tool.timeoutMs, 4242, 'Loader 行 config.tool.timeoutMs 必须传入 apply 第二参数')
    assert.equal(state.routes.has('/_dsh/uploader/pick-file'), true)
    assert.equal(state.routes.has('/_dsh/uploader/upload'), true)
    await loader.remove('dofe-yootun-tos-upload')
    assert.equal(state.tools.size, 0)
    assert.equal(state.routes.size, 0)
  })

  test('loads with an empty config object and degrades on missing credentials', async () => {
    const { loader, state } = await bootServices({ withCredentials: false })
    await loadEntry(loader, { config: {} })
    const tool = state.tools.get('media_upload')
    assert.ok(tool, '没有 credential store 时插件仍必须加载')
    assert.deepEqual(await tool.execute({}, {}), { ok: false, error: 'uploader_not_configured' })
    await loader.remove('dofe-yootun-tos-upload')
  })

  test('loads without a system prompt service', async () => {
    const { loader, state } = await bootServices({ withSystemPrompt: false })
    await loadEntry(loader, {})
    assert.ok(state.tools.get('media_upload'), '没有 system prompt 服务时工具仍必须注册')
    assert.equal(state.sections.length, 0)
    await loader.remove('dofe-yootun-tos-upload')
  })

  test('reloading the same entry leaves exactly one media_upload tool', async () => {
    const { loader, state } = await bootServices()
    await loadEntry(loader, {})
    const first = state.tools.get('media_upload')
    assert.ok(first)

    // 重新加载同一 entry（相同 id 覆盖旧配置，不产生第二个条目）。
    await loader.remove('dofe-yootun-tos-upload')
    await loadEntry(loader, {})
    const second = state.tools.get('media_upload')
    assert.notEqual(first, second, '重载后必须是新实例')
    assert.equal(state.tools.size, 1, '只允许一个 media_upload')
    assert.equal(state.routes.size, 2, '同路径路由只允许一组')

    await loader.remove('dofe-yootun-tos-upload')
    assert.equal(state.tools.size, 0, '卸载后 media_upload 消失')
    assert.equal(state.routes.size, 0)
  })

  test('no duplicate tool when the desktop patch and plugin bundle share an entry id', async () => {
    // 桌面 cordis.patch.yml 与插件 dsh.bundle.patch 使用同一 entry id；合并时
    // 相同 id 是“替换”而非“并列”，因此只有一条 media_upload。
    const { loader, state } = await bootServices()
    const id = await loader.create({ id: 'dofe-yootun-tos-upload', name: pluginUrl, config: {} })
    await loader.await()
    // 再次 create 同一 id：EntryGroup.create 用已有 Entry 替换 options，不是新增。
    await loader.create({ id: 'dofe-yootun-tos-upload', name: pluginUrl, config: {} })
    await loader.await()
    assert.equal(state.tools.size, 1, '相同 entry id 只产生一个工具')
    await loader.remove(id)
    assert.equal(state.tools.size, 0)
  })

  test('failed tool registration rolls back routes and leaves no half-state', async () => {
    const root = new Context()
    const state = { routes: new Map(), tools: new Map() }
    await root.plugin((ctx) => {
      ctx.provide('webServer', {
        port: 3000,
        register(route) {
          state.routes.set(route.path, route.handler)
          return () => state.routes.delete(route.path)
        },
      })
      ctx.provide('tools', {
        register() { throw new Error('boom from tools.register') },
      })
      ctx.provide('credentials', { async resolve(key) { return { value: `${key}-stored` } } })
    })
    await root.plugin(Loader)
    const loader = root.get('loader')
    loader.internal = undefined
    // EntryGroup.create 会等待插件 apply，注册失败在此抛出并回滚。
    await assert.rejects(
      () => loader.create({ id: 'dofe-yootun-tos-upload', name: pluginUrl, config: {} }),
      /boom from tools\.register|failed to apply/,
    )
    assert.equal(state.tools.size, 0, '工具注册失败不得留下半注册工具')
    assert.equal(state.routes.size, 0, '工具注册失败时路由必须回滚')
  })
}
