import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('prepares request inventory for Desktop-owned entries and private-manifest plugins', () => {
  const require = createRequire(import.meta.url)
  const script = `
    import assert from 'node:assert/strict';
    import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { createRequire } from 'node:module';
    import { dirname, join } from 'node:path';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    const { apply } = await import(pathToFileURL(process.argv[1]).href);
    const { installProfilePackageResolver } = await import(pathToFileURL(process.argv[2]).href);
    const desktop = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    const root = mkdtempSync(join(tmpdir(), 'desktop-inventory-'));
    let release;
    try {
      writeFileSync(join(root, 'package.json'), '{"type":"module"}');
      const baseUrl = pathToFileURL(join(root, 'package.json')).href;
      const collect = async names => {
        let provider;
        const tree = { ctx: { baseUrl }, entries: () => names.map(name => ({
          options: { name }, fiber: { state: 2 }, parent: { tree }
        })) };
        // 0.1.6 inventory consults ctx.get('pluginPackages'): the authoritative
        // installation generation must win over a stale shadow copy planted in
        // nearer node_modules, while unknown packages fall through to native
        // nearest-manifest probing. No plugin code is ever evaluated.
        const realDesktopManifest = process.argv[3];
        const pluginPackages = { packageOf: (name, anchor) => {
          if (name === desktop.name) return { manifestPath: realDesktopManifest };
          let dir = dirname(fileURLToPath(anchor));
          for (;;) {
            const candidate = join(dir, 'node_modules', name, 'package.json');
            if (existsSync(candidate)) return { manifestPath: candidate };
            const parent = dirname(dir);
            if (parent === dir) return undefined;
            dir = parent;
          }
        } };
        apply({ baseUrl, loader: tree, get: (key) => key === 'pluginPackages' ? pluginPackages : undefined, deepseekLlmApiExtensions: {
          register: (key, value) => { assert.equal(key, 'dsh_plugin_packages'); provider = value; }
        } }, {});
        return (await provider.prepare({})).value.packages;
      };
      // The inventory package can find installation-owned packages from its own base.
      const installedIdentity = [{ name: desktop.name, version: desktop.version }];
      assert.deepEqual(await collect([desktop.name]), installedIdentity);
      const staleDesktop = join(root, 'node_modules', desktop.name);
      mkdirSync(staleDesktop, { recursive: true });
      writeFileSync(join(staleDesktop, 'package.json'), JSON.stringify({
        name: desktop.name, version: '0.0.1', exports: './index.js'
      }));
      writeFileSync(join(staleDesktop, 'index.js'), 'throw new Error("inventory evaluated stale plugin")');
      release = installProfilePackageResolver(baseUrl);
      assert.equal(JSON.parse(readFileSync(createRequire(baseUrl).resolve(desktop.name + '/package.json'), 'utf8')).version, desktop.version);
      assert.deepEqual(await collect([
        desktop.name, desktop.name + '/terminal', desktop.name + '/pnpm',
        desktop.name + '/diagnostics', desktop.name + '/notifications',
        desktop.name + '/profiles', desktop.name + '/updates'
      ]), [{ name: desktop.name, version: desktop.version }]);
      const plugin = join(root, 'node_modules', 'private-manifest-plugin');
      mkdirSync(plugin, { recursive: true });
      writeFileSync(join(plugin, 'package.json'), JSON.stringify({
        name: 'private-manifest-plugin', version: '1.2.3', exports: './index.js'
      }));
      writeFileSync(join(plugin, 'index.js'), 'throw new Error("inventory evaluated plugin")');
      assert.deepEqual(await collect(['private-manifest-plugin']), [{ name: 'private-manifest-plugin', version: '1.2.3' }]);
      await assert.rejects(() => collect(['inventory-nonexistent-package']), /cannot resolve.*package/);
      writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'private-manifest-plugin', exports: './index.js' }));
      await assert.rejects(() => collect(['private-manifest-plugin']), /non-empty name and version/);
      release(); release = undefined;
      // 0.1.6 caches package identities per process: disposal restores plain
      // node_modules resolution without re-reading manifests, so the resolver
      // era identity stays cached while the stale profile copy stays inert
      // (its index.js would throw if the inventory ever evaluated plugin code).
      assert.deepEqual(await collect([desktop.name]), [{ name: desktop.name, version: desktop.version }]);
      assert.equal(JSON.parse(readFileSync(join(staleDesktop, 'package.json'), 'utf8')).version, '0.0.1');
      console.log('request inventory passed');
    } finally { release?.(); rmSync(root, { recursive: true, force: true }); }
  `
  const output = execFileSync(process.execPath, [
    '--input-type=module', '-e', script,
    require.resolve('@deepseek-ai/dsh-plugin-package-inventory-deepseek'),
    fileURLToPath(new URL('../src/module-resolution.ts', import.meta.url)),
    fileURLToPath(new URL('../package.json', import.meta.url)),
  ], { encoding: 'utf8', timeout: 30_000 })
  expect(output).toContain('request inventory passed')
})
