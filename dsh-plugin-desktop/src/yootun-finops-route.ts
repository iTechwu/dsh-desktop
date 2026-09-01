/** Private, local-only FinOps summary. Cost values are supplied by the Desktop aggregator. */
import type { IncomingMessage, ServerResponse } from 'node:http'
export const YOOTUN_FINOPS_PATH = '/api/desktop/yootun/finops'
export interface FinopsSummary { summary: { spend?: string; budget?: string; remaining?: string; alerts: number }; models: Array<{ id: string; name: string; requests: number; tokens: string; cost: string }>; alerts: Array<{ id: string; title: string; status: string }>; budgets: Array<{ id: string; name: string; limit: string; used: string }> }
export function finopsSnapshot(): FinopsSummary { return { summary: { alerts: 0 }, models: [], alerts: [], budgets: [] } }
function send(res: ServerResponse, status: number, value: object, allow?: string) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); if (allow) res.setHeader('Allow', allow); res.end(JSON.stringify(value)) }
export async function handleYootunFinopsRequest(req: IncomingMessage, res: ServerResponse, rendererOrigin: string): Promise<void> { if (req.headers.origin && req.headers.origin !== rendererOrigin) { send(res, 403, { error: 'origin_forbidden' }); return } if (req.method === 'GET') { send(res, 200, finopsSnapshot()); return } send(res, 405, { error: 'method_not_allowed' }, 'GET') }
