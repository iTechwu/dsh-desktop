# OpenMontage Tool Loop Hardening Design

## Problem

The Desktop composition can expose hundreds of native tools while omitting the complete OpenMontage workflow guidance from the assembled model prompt. In the observed reference-clone session, the model successfully prepared a project, repeatedly stated that it needed `read_project_file`, but emitted `list_project_files` or `list_video_artifacts` instead. The exact-call reminder did not stop the loop because the model varied invalid arguments, and the session ended only when the user aborted it.

The provider stream and the persisted tool calls contained the same wrong names and arguments. The local adapter, parser, router, and UI therefore did not rename the intended call. The failure arose from the model-facing combination of an oversized tool catalog, missing workflow guidance, and an advisory guard whose identity key included arguments.

## Goals

- Include the existing complete OpenMontage guidance in the Desktop's final Host composition.
- After a reference project is prepared, expose only the MCP tools needed to inspect that project and submit the video job.
- Stop repeated unchanged project listings and repeated equivalent OpenMontage failures before they can continue invoking the remote service.
- Preserve legitimate status polling and leave the default DeepSeek Harness repeat reminder unchanged.
- Prove the behavior through the real tool registry and agent scope, then verify the packaged Desktop composition resolves and boots.

## Non-Goals

- Do not infer tool intent by parsing model reasoning text.
- Do not change the LLM adapter or rewrite streamed tool names.
- Do not remove local development tools or permanently disable other MCP capabilities.
- Do not change the OpenMontage server API.
- Do not turn the general `repeat-tool-reminder` package into a mandatory blocking policy.

## Ownership

The user's `../deepseek-harness` fork owns the reusable `@dofe/dsh-openmontage-mcp` plugin. The plugin remains the single source of the complete guidance and gains the OpenMontage-specific workflow guard. The Desktop repository owns inclusion of that plugin in its shipped composition and the corresponding dependency closure.

The two repositories remain independently reviewable. Harness behavior is committed and pushed on `dev` first. The Desktop then advances the fork version in a separate commit after its composition change.

## Runtime Design

### Guidance assembly

The Desktop composition mounts `@dofe/dsh-openmontage-mcp` as a normal Host plugin next to `dofe-managed`. Mounting the module registers guidance and policy only; it does not apply the package's bundle patch or create a second MCP client. `dofe-managed` continues to own the authenticated OpenMontage transport.

### Reference-inspection tool projection

The plugin observes final tool results for each Agent. A successful `prepare_reference_clone`, or a successful `reference_clone_status` whose returned status is `prepared`, enters the Agent into `reference-inspection` state.

While that state is active, the plugin registers an Agent-scoped tool restriction. Local tools stay visible. Global MCP tools are hidden except this explicit inspection set:

- `mcp__openmontage__openmontage_capabilities`
- `mcp__openmontage__reference_clone_status`
- `mcp__openmontage__list_project_files`
- `mcp__openmontage__read_project_file`
- `mcp__openmontage__read_project_image`
- `mcp__openmontage__sync_project_exports`
- `mcp__openmontage__export_project_file`
- `mcp__openmontage__submit_video_job`

This removes `prepare_reference_clone` after preparation so the model cannot create duplicate projects. It also removes `list_video_artifacts` before a Job exists. The restriction is refreshed before each subsequent Agent step so MCP reconnects cannot reintroduce unrelated schemas.

A successful `submit_video_job` leaves inspection state and restores the full tool view for client-stage execution, progress tracking, human approval delivery, and final artifact retrieval. A new user message also clears the state and every open circuit before the next request is assembled.

### Result-aware circuit breaker

The guard tracks stalled outcomes per Agent and per OpenMontage tool. Other tool calls do not erase a stalled tool's count.

An outcome is stalled when either condition holds:

- the tool result is an error and its normalized model-visible content matches the preceding error for that tool, even when arguments differ;
- `list_project_files` succeeds but returns the same normalized content repeatedly.

The following polling tools are exempt because unchanged results can be expected progress checks:

- `reference_clone_status`
- `get_video_job`
- `list_video_job_events`

The threshold is a validated plugin configuration value with a default of three. When the threshold is reached, the result remains auditable and the model receives a source-attributed notice explaining the stalled outcome and required alternative. The circuit then opens for that Agent and tool. Later attempts are denied by `tools.guard()` before the remote body runs. A successful changed outcome resets that tool's counter. A new user message resets the complete per-Agent state.

The circuit breaker never parses chain-of-thought or guesses a desired tool. The reference-inspection projection makes the screenshot's stated-A/emitted-B mismatch non-executable by removing invalid alternatives from the next request schema.

## Result Interpretation

MCP results may be DSH errors or successful content containing a JSON object. The plugin derives semantic status only from text blocks that parse as complete JSON objects. `isError: true`, `success: false`, or `status` equal to `failed` or `error` is a failure. A `prepared` status activates inspection. A successful job submission is recognized from a non-failure result carrying a Job identifier or a created/submitted/running status.

Unparseable successful text is not treated as a semantic failure and cannot activate or leave a workflow state. This fails conservatively without blocking an otherwise valid tool result.

## Lifecycle and Isolation

State is keyed by Agent, never session id or global tool name alone. Agent-scoped restriction disposers are called when state clears. Plugin disposal lifts restrictions through Cordis effects. Direct tool executions without an Agent are observed but cannot change workflow state or open a circuit.

## Verification

Harness tests use the real Cordis context, tools service, and Agent scope to prove:

- prepared reference results remove unrelated MCP tools and keep inspection tools;
- successful job submission restores the full tool view;
- equivalent errors with changing arguments open the circuit at the configured threshold;
- repeated unchanged project listings open the circuit;
- polling calls remain executable;
- Agent state is isolated and a new user message resets it;
- the complete guidance still assembles.

Desktop tests load the workspace package and assemble its prompt section. The packaged profile boot and runtime-closure checks prove that the new dependency resolves from the shipped composition without creating a second MCP transport.

## Rollout

The guard is active only where `@dofe/dsh-openmontage-mcp` is mounted. The Desktop explicitly mounts it. Compatibility mode and deployments that do not include this plugin retain their current tool behavior. The general repeat reminder remains advisory and continues to cover exact repetitions independently.
