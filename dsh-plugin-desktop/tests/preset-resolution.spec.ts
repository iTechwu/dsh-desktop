import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('checks preset package presence while leaving entry validation to the Desktop resolver', () => {
  const require = createRequire(import.meta.url)
  const script = `
    import assert from 'node:assert/strict';
    import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { createRequire } from 'node:module';
    import { dirname, join } from 'node:path';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    const { scanRoot } = await import(pathToFileURL(process.argv[1]).href);
    const { installProfilePackageResolver } = await import(pathToFileURL(process.argv[2]).href);
    const root = mkdtempSync(join(tmpdir(), 'desktop-preset-resolution-'));
    let release;
    try {
      const profile = join(root, 'profile');
      const presets = join(root, 'presets');
      mkdirSync(profile);
      writeFileSync(join(profile, 'package.json'), '{"type":"module"}');
      const define = (id, name) => {
        mkdirSync(join(presets, id), { recursive: true });
        writeFileSync(join(presets, id, 'agent.cordis.yml'), JSON.stringify([{ id: 'check', name }]));
      };
      define('installed', '@deepseek-ai/dsh-persona');
      define('subpath', '@deepseek-ai/dsh-tool-subagent-control/list-agents');
      define('missing', '@desktop-regression/nonexistent');
      define('bad-export', '@deepseek-ai/dsh-persona/nonexistent-export');
      const base = pathToFileURL(profile + '/').href;
      const scan = () => scanRoot({ path: presets, trust: 'system' }, base);
      assert.ok((await scan()).find(p => p.id === 'installed').broken);
      release = installProfilePackageResolver(pathToFileURL(join(profile, 'package.json')).href);
      // 0.1.6 presence discovery probes physical node_modules and accepts an
      // injected probe. Inject one that resolves through the Desktop resolver
      // hook, mirroring the production boot where the profile overlays the
      // installed Desktop graph.
      // 0.1.6 presence discovery probes physical node_modules and accepts an
      // injected probe: profile-local packages via the Desktop resolver hook,
      // and harness workspace packages via their physical source trees.
      const packagesRoot = dirname(dirname(dirname(dirname(process.argv[1]))));
      const workspaceNames = new Map();
      const walkWorkspace = (dir, depth) => {
        if (depth > 3) return;
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const child = join(dir, entry.name);
          const manifest = join(child, 'package.json');
          if (existsSync(manifest)) {
            try {
              const name = JSON.parse(readFileSync(manifest, 'utf8')).name;
              if (typeof name === 'string' && !workspaceNames.has(name)) workspaceNames.set(name, child);
            } catch { /* not a package manifest */ }
          }
          walkWorkspace(child, depth + 1);
        }
      };
      walkWorkspace(packagesRoot, 0);
      const probe = (name, probeBase) => {
        const pkg = name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/');
        let dir = dirname(fileURLToPath(probeBase));
        for (;;) {
          if (existsSync(join(dir, 'node_modules', pkg, 'package.json'))) return true;
          const parent = dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
        const mapped = workspaceNames.get(name);
        if (mapped !== undefined && existsSync(join(mapped, 'package.json'))) return true;
        try {
          createRequire(probeBase).resolve(pkg + '/package.json');
          return true;
        } catch {
          return false;
        }
      };
      const rows = await scanRoot({ path: presets, trust: 'system' }, base, probe);
      assert.equal(rows.find(p => p.id === 'installed').broken, undefined);
      assert.equal(rows.find(p => p.id === 'subpath').broken, undefined);
      assert.ok(rows.find(p => p.id === 'missing').broken);
      // Discovery reports package presence, including source workspaces not built yet.
      // Actual entry resolution must still refuse an export the package does not expose.
      assert.equal(rows.find(p => p.id === 'bad-export').broken, undefined);
      const requireFromProfile = createRequire(pathToFileURL(join(profile, 'package.json')));
      assert.throws(() => requireFromProfile.resolve('@deepseek-ai/dsh-persona/nonexistent-export'), {
        code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      });
      const shipped = await scanRoot({ path: join(dirname(process.argv[1]), '../presets'), trust: 'system' }, base, probe);
      const standard = shipped.find(p => p.id === 'standard');
      assert.ok(standard);
      assert.equal(standard.broken, undefined);
      // Profile plugins are visible, but discovery must not evaluate their code.
      const override = join(profile, 'node_modules', '@desktop-regression', 'probe');
      mkdirSync(override, { recursive: true });
      writeFileSync(join(override, 'package.json'), '{"name":"@desktop-regression/probe","type":"module","exports":"./index.js"}');
      writeFileSync(join(override, 'index.js'), 'throw new Error("discovery evaluated plugin")');
      define('probe', '@desktop-regression/probe');
      assert.equal((await scan()).find(p => p.id === 'probe').broken, undefined);
      release();
      release = undefined;
      assert.ok((await scan()).find(p => p.id === 'installed').broken);
      console.log('preset resolution passed');
    } finally {
      release?.();
      rmSync(root, { recursive: true, force: true });
    }
  `
  const output = execFileSync(process.execPath, [
    '--input-type=module', '-e', script,
    require.resolve('@deepseek-ai/dsh-agent-presets'),
    fileURLToPath(new URL('../src/module-resolution.ts', import.meta.url)),
  ], { encoding: 'utf8', timeout: 30_000 })
  expect(output).toContain('preset resolution passed')
})
