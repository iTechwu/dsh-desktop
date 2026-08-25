# DSH Desktop repository rules

This repository owns the desktop product around an unmodified DeepSeek Harness checkout.

## Workflow contract

- After every modification to this repository, commit the change (每次修改之后进行 commit). Keep each change in a small, reviewable commit.
- Write commit messages in Chinese (提交信息一律使用中文), using Conventional Commits style (`feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:`); the body describes what the change actually does.
- After committing, push to `origin` (所有提交和 push 均到 origin, per the repository owner's standing instruction).
- Verify with the relevant gate (`pnpm check` / `pnpm check:layout` / package typecheck/build) before a change is considered complete.

## Prerequisites and setup

- Use Node.js `^22.19.0` or `>=24.0.0` and the root pnpm `11.7.0` release through Corepack.
- The DeepSeek Harness source is a sibling checkout at `../deepseek-harness`, exposed in this repository through the `deepseek-harness` symlink. Ensure that checkout exists and is at the commit recorded in `upstream.json` before running operations.
- Install the combined root/sibling workspace with `corepack pnpm install --frozen-lockfile`.

## Build, run, and verify

- Start the desktop development workflow with `corepack pnpm dev`.
- Build the desktop package with `corepack pnpm build`.
- Run unit tests with `corepack pnpm test`.
- Run type checking with `corepack pnpm typecheck`.
- Run the complete headless gate with `corepack pnpm check`.
- Run upstream operations through the root scripts, such as `corepack pnpm upstream:build`.

- `../deepseek-harness/` is the DeepSeek Harness source (a sibling checkout, not vendored). Never edit files inside it from a desktop feature branch.
- `dsh-plugin-desktop/` owns the Cordis Host and Client faces, Electron bootstrap, packaging, and release tests.
- `dsh-community-fabric/` owns the community interoperability RFC. Until schemas and a reviewed reference adapter exist, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- `dsh-community-market/` owns the community-market shell. Until its runtime is implemented, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- The outer repository and all owned packages use the root pnpm release with `nodeLinker: node-modules`.
- The upstream sibling checkout keeps its own pnpm workspace. Run upstream commands through the root `upstream:*` scripts, whose pnpm portable-shell commands `cd ../deepseek-harness` before invoking Corepack.
- Compatibility mode must run the upstream default client without overrides. Advanced presentation belongs to desktop-owned client plugins and may replace documented slots or services through profile composition.
- Keep graphical application launch explicit. Builds, typechecks, unit tests, and Loader smokes must remain headless-safe.
- Commit before major changes of direction and keep the upstream commit update separate from desktop behavior changes.
- Keep the repository topology and direct sibling workspace boundary consistent with the [owning Agent Note](.agents/notes/implemented/process/2026-08-15-pinned-upstream-and-isolated-pnpm-workspace.md).
