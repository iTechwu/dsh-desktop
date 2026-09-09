# OpenMontage Tool Loop Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the Desktop OpenMontage reference-clone workflow from exposing invalid MCP alternatives or repeatedly executing unchanged failures.

**Architecture:** Extend the existing `@dofe/dsh-openmontage-mcp` Host plugin with per-Agent reference-inspection state, Agent-scoped tool restrictions, and a result-aware circuit breaker. Mount that same package in the Desktop composition while `dofe-managed` remains the sole MCP transport owner.

**Tech Stack:** Cordis, DeepSeek Harness tools and Agent services, JavaScript ESM, TypeScript/Vitest integration tests, pnpm workspace composition.

**Spec:** `docs/superpowers/specs/2026-09-08-openmontage-tool-loop-hardening-design.md`

## Global Constraints

- Use Node.js `^22.19.0` or `>=24.0.0` and Corepack pnpm `11.7.0`.
- Preserve the unmodified Desktop user's `.ci` worktree changes and stage only named files.
- Implement harness behavior on sibling branch `dev`; do not edit it from a Desktop feature branch.
- Write Chinese Conventional Commit messages and push every completed commit to `origin`.
- Keep the OpenMontage MCP transport owned by `dofe-managed`; mounting the guidance module must not create a second client.
- The general `repeat-tool-reminder` remains advisory and unchanged.

---

### Task 1: Add failing workflow-guard tests in the Harness fork

**Files:**
- Modify: `../deepseek-harness/plugins/dsh-openmontage-mcp/test/plugin.test.mjs`

**Interfaces:**
- Consumes: `apply(ctx, { stalledOutcomeThreshold })` from `@dofe/dsh-openmontage-mcp`.
- Produces: behavioral requirements for scoped schema projection and `tools.guard()` denial.

- [ ] **Step 1: Add a real Cordis test harness**

Mount the real tools, system-prompt, session-projection, and agent-loop services. Register deterministic content tools named with the real `mcp__openmontage__*` and unrelated MCP names, then create Agents through `AgentLoop`.

- [ ] **Step 2: Add the prepared-stage projection test**

Execute a successful `mcp__openmontage__prepare_reference_clone` result containing `{"status":"prepared","project_id":"clone-1"}`. Assert that `agent.ctx.tools.schemas()` retains `read_project_file` and `submit_video_job` but removes `prepare_reference_clone`, `list_video_artifacts`, and an unrelated MCP tool. Execute a successful submission result carrying `jobId`, then assert that the removed schemas return.

- [ ] **Step 3: Add result-aware circuit tests**

Execute the same failing OpenMontage tool three times with different `job_id` arguments but identical error content. Assert that a fourth call returns a guard error without incrementing the real tool-body counter. Repeat the assertion for three identical successful `list_project_files` results.

- [ ] **Step 4: Add isolation, polling, and reset tests**

Assert that repeated `reference_clone_status` calls remain executable, another Agent is unaffected by an open circuit, and a new user message clears the affected Agent's restriction and circuit before its next request.

- [ ] **Step 5: Run the focused tests and verify RED**

Run:

```bash
corepack pnpm --dir ../deepseek-harness exec vitest run plugins/dsh-openmontage-mcp/test/plugin.test.mjs
```

Expected: the new tests fail because the plugin currently registers only guidance and has no `tools` policy.

### Task 2: Implement the OpenMontage workflow guard

**Files:**
- Modify: `../deepseek-harness/plugins/dsh-openmontage-mcp/index.js`
- Modify: `../deepseek-harness/plugins/dsh-openmontage-mcp/package.json`

**Interfaces:**
- Consumes: `ctx.tools.schemas()`, `agent.ctx.tools.restrict()`, `ctx.tools.guard()`, `tools/post-execute`, and `agent/pre-step`.
- Produces: `Config.stalledOutcomeThreshold`, the `reference-inspection` tool projection, and per-Agent open circuits.

- [ ] **Step 1: Add validated configuration**

Declare a Schemastery config with `stalledOutcomeThreshold` defaulting to `3`. Reject direct-construction values that are not integers greater than or equal to two.

- [ ] **Step 2: Normalize model-visible results**

Build a deterministic signature from tool-result content. Parse a text block only when it is a complete JSON object. Treat DSH errors, `success: false`, and `status: "failed" | "error"` as failures; keep unparseable successful content successful.

- [ ] **Step 3: Apply Agent-scoped inspection restrictions**

On a prepared reference result, derive the current global schema names and deny every `mcp__*` name outside the approved inspection set. Refresh the disposer before later steps, clear it on successful job submission, and clear all state on a new user message.

- [ ] **Step 4: Open and enforce stalled-outcome circuits**

Count equivalent errors per Agent and tool regardless of argument changes. Count unchanged successful listings only for `list_project_files`. Exempt `reference_clone_status`, `get_video_job`, and `list_video_job_events`. At the threshold, attach a plugin-sourced corrective context and mark the tool open; deny later calls synchronously before the body executes.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 1 command. Expected: all OpenMontage plugin tests pass without network access.

- [ ] **Step 6: Run the owning package tests**

Run:

```bash
corepack pnpm --dir ../deepseek-harness --filter @dofe/dsh-openmontage-mcp test
```

Expected: PASS.

### Task 3: Document and publish the Harness behavior

**Files:**
- Modify: `../deepseek-harness/plugins/dsh-openmontage-mcp/README.md`
- Modify: `../deepseek-harness/plugins/dsh-openmontage-mcp/README.zh.md`
- Create: `../deepseek-harness/.agents/notes/implemented/feature/2026-09-08-openmontage-agent-tool-loop-hardening.md`

**Interfaces:**
- Consumes: behavior implemented in Task 2.
- Produces: current-state operator documentation and the architectural rationale required for a non-trivial harness change.

- [ ] **Step 1: Update both README languages**

Document when reference-inspection projection starts and ends, the exact allowed tool set, the default threshold, polling exemptions, Agent isolation, and reset behavior.

- [ ] **Step 2: Add the Agent Note**

Record the observed failure chain, why provider-name rewriting was rejected, why product-specific policy stays in the OpenMontage plugin, and which tests pin the decision.

- [ ] **Step 3: Run documentation and focused behavior gates**

Run:

```bash
corepack pnpm --dir ../deepseek-harness run test:docs
corepack pnpm --dir ../deepseek-harness exec vitest run plugins/dsh-openmontage-mcp/test/plugin.test.mjs
```

- [ ] **Step 4: Commit and push the Harness behavior**

Stage only the OpenMontage plugin and Agent Note files. Commit with:

```text
fix: 阻断 OpenMontage 工具空转循环
```

Push `dev` to `origin` and verify local and remote OIDs match.

### Task 4: Advance the Harness source version

**Files:**
- Modify: `../deepseek-harness/package.json`

**Interfaces:**
- Consumes: completed Harness behavior commit.
- Produces: fork source version `0.1.3-alpha.2` for Desktop pinning.

- [ ] **Step 1: Change only the root source version**

Update `version` from `0.1.3-alpha.1` to `0.1.3-alpha.2` without changing package dependencies.

- [ ] **Step 2: Verify the version**

Run:

```bash
corepack pnpm --dir ../deepseek-harness --version
node -p "require('./package.json').version"
```

The second command runs from `../deepseek-harness` and must print `0.1.3-alpha.2`.

- [ ] **Step 3: Commit and push separately**

Commit with:

```text
chore: 递增 Harness 源码版本
```

Push `dev` to `origin` and verify the remote OID.

### Task 5: Add failing Desktop composition tests

**Files:**
- Create: `dsh-plugin-desktop/tests/openmontage-workflow-guard.spec.ts`

**Interfaces:**
- Consumes: the workspace-resolved `@dofe/dsh-openmontage-mcp` package and Desktop patch text.
- Produces: evidence that the Desktop dependency assembles the full guidance and is selected by the shipped patch.

- [ ] **Step 1: Add the composition test**

Mount the real system-prompt service and imported OpenMontage plugin, assemble the prompt, and assert that the section includes the prepared-project `read_project_file` sequence. Read `cordis.patch.yml` only for the Desktop-owned selection assertion and verify the selected row is `@dofe/dsh-openmontage-mcp`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/openmontage-workflow-guard.spec.ts
```

Expected: dependency resolution or patch-selection assertion fails because the package is not yet in the Desktop workspace or composition.

### Task 6: Mount the guard in the Desktop composition

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `dsh-plugin-desktop/package.json`
- Modify: `dsh-plugin-desktop/cordis.patch.yml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `@dofe/dsh-openmontage-mcp` from the sibling symlink at `deepseek-harness/plugins/dsh-openmontage-mcp`.
- Produces: one Desktop Host plugin row that registers guidance and policy while reusing the `dofe-managed` transport.

- [ ] **Step 1: Include the exact sibling plugin workspace**

Add `deepseek-harness/plugins/dsh-openmontage-mcp` to the root workspace list and add `@dofe/dsh-openmontage-mcp: workspace:*` to `dsh-plugin-desktop` dependencies.

- [ ] **Step 2: Select the Host plugin**

Insert an `openmontage-guidance` row using `@dofe/dsh-openmontage-mcp` next to `dofe-managed`. Do not add or apply the package's `cordis.patch.yml`, so no `mcp-openmontage` transport row is duplicated.

- [ ] **Step 3: Regenerate the lockfile**

Run:

```bash
corepack pnpm install --lockfile-only
```

- [ ] **Step 4: Run the focused test and layout gate**

Run:

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/openmontage-workflow-guard.spec.ts
corepack pnpm check:layout
```

Expected: PASS.

- [ ] **Step 5: Commit and push the Desktop composition**

Stage only the five Task 5-6 files. Commit with:

```text
fix: 接入 OpenMontage 工作流防空转能力
```

Push the current Desktop branch to `origin` and verify the remote OID.

### Task 7: Advance the Desktop fork pointer

**Files:**
- Modify: `upstream.json`

**Interfaces:**
- Consumes: Harness root version `0.1.3-alpha.2`.
- Produces: matching Desktop `sourceVersion`.

- [ ] **Step 1: Update only `sourceVersion`**

Change `0.1.3-alpha.1` to `0.1.3-alpha.2`.

- [ ] **Step 2: Verify the sibling match**

Run the repository's upstream version/layout checks and confirm both values are identical.

- [ ] **Step 3: Commit and push separately**

Commit with:

```text
chore: 更新 Harness 源码版本指针
```

Push to `origin` and verify the remote OID.

### Task 8: Run final gates and audit both repositories

**Files:**
- No new files.

**Interfaces:**
- Consumes: every prior task.
- Produces: final verification evidence and clean scoped diffs.

- [ ] **Step 1: Run Harness checks selected for the outgoing diff**

Run the focused OpenMontage test, package test, documentation gate, and any build/hygiene check required by the changed manifest and public plugin config.

- [ ] **Step 2: Run the Desktop complete headless gate**

Run:

```bash
corepack pnpm check
corepack pnpm check:layout
```

- [ ] **Step 3: Audit status and remote heads**

Confirm the Harness worktree is clean. Confirm the Desktop has only the user's four pre-existing `.ci` changes. Verify both local branch heads equal their corresponding `origin` refs and report every command actually run.
