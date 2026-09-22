# Workflow Contract

## Read path

- `supply_chain_suppliers_list`: database-only supplier inventory; paginate until exhausted.
- `supply_chain_qcc_capabilities_get`: local catalog; no QCC connection or charge.
- `supply_chain_qcc_company_data_list`: database-only QCC records.
- `supply_chain_relationships_list`: database-only relationships and review state.
- `supply_chain_intelligence_report_get`: persisted-facts report; no independent LLM summary.

## External path

- `supply_chain_qcc_company_data_get`: database-first 30-minute cache. A stale or missing key may make one QCC MCP call, then persists success before returning the stored record.
- `supply_chain_social_monitoring_collect`: command for approved sources and verified suppliers. Use `confirm=true`, a stable `idempotencyKey`, and poll `supply_chain_run_get` to a terminal state.

## Stop conditions

Stop the affected branch without automatic retry on provider unavailable, authentication, account, entitlement, balance, budget, or environment failures. A failed refresh must not replace an older successful record. Keep the original `runId` when polling or recovering an accepted command.

## Evidence language

- Confirmed: persisted evidence with the required entity and review status.
- Candidate: a search hit or unreviewed relationship; suitable for follow-up, not a risk fact.
- Gap: unavailable source, unverified supplier, expired cache, missing capability, or no stored evidence.

Every conclusion must retain a supplier anchor and enough source metadata to locate its stored evidence.
