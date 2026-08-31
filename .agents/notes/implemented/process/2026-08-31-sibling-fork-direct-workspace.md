# Agent Note: Sibling fork direct workspace

Status: implemented

English | [中文](2026-08-31-sibling-fork-direct-workspace.zh.md)

## Problem

Tracking the DeepSeek Harness source as a pinned git submodule and consuming the runtime as vendored tarballs blocked the owner's local-use behaviors from taking effect and stuffed 241 tarballs plus machine-specific absolute `file:` paths into the repository. A submodule pin freezes the source at one official commit, while the product actually needs to track the owner's fork (branch `dev`) where desktop behaviors live as ordinary commits.

## Decision

`deepseek-harness/` is a git symlink (mode `120000`) to `../deepseek-harness` — the owner's fork `iTechwu/deepseek-harness`, branch `dev`. It is a member of the root pnpm workspace through the `deepseek-harness/{apps,packages,native,vendor}/**` globs, so the fork's `workspace:^` dependencies resolve natively and `linkWorkspacePackages` links every `@deepseek-ai/dsh*`, cordis-family, and schemastery dependency to the fork's source.

`upstream.json` declares exactly `repository` (SSH fork URL), `branch`, `localCheckout`, and `sourceVersion`. It does not pin a commit; the source of truth is the sibling working tree, and `sourceVersion` must equal the sibling's root version. CI clones the fork to `../deepseek-harness` (SSH, `--depth 1 --branch dev`) before `pnpm install`, and `scripts/upstream-workspace-link.mjs` materializes the Windows junction before any install.

Desktop-owned behaviors are native fork commits. The former `patches/` DSH behavior patches and `scripts/apply-upstream-patches.mjs` are deleted; `patches/` keeps only the three toolchain patches (`app-builder-lib`, `dshmarket`, `open`) governed by `patchedDependencies`. `dsh-plugin-desktop/tests/package.spec.ts` asserts the ported behaviors directly against the fork's sources.

## Consequences

The fork's own `overrides`/`allowBuilds`/`patchedDependencies` do not apply in the merged graph; the root `pnpm-workspace.yaml` must keep declaring `allowBuilds` for the packages that need build scripts. Cordis-family dependencies pinned to registry versions would create dual instances, so they must stay `workspace:*` (enforced by `verify-layout`). The two workspaces must pin the same pnpm release (`pnpm@11.7.0`). The desktop build now depends on the sibling's state: the fork's `allowBuilds`-governed native builds and `lib/` output are produced by `upstream:install` + `upstream:build`, and CI needs the `SSH_KEY` secret (read-only key) to clone the fork.

## Supersedes

[2026-08-15-pinned-upstream-and-isolated-yarn-workspace](2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md) — the pinned submodule with an exact commit and the isolated-workspace contract are retired; the sibling-direct topology replaces them.
