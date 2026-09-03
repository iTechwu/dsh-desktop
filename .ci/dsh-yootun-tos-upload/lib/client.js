/**
 * 客户端半空壳：本插件是纯宿主插件，无客户端能力。
 * 存在意义：dsh-plugin-desktop/tests/package.spec.ts 目前对每个 DoFe 插件断言
 * `.ci/<name>/lib/client.js` 必须存在（方案第十节选项 A），不动桌面仓库测试。
 */
export function apply() {}
