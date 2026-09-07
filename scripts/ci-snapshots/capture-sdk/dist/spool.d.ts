import type { SpooledEvent } from './idempotency';
export type SpoolPushResult = {
    /** True when the spool was full and the OLDEST event was evicted. */
    evicted: boolean;
};
/**
 * Bounded in-memory spool (docs/0906/ai-memory §3.1): the agent hot path
 * pushes and never blocks on the network. Capacity defaults to the contract
 * checkpoint event cap (500); when full, the oldest event is evicted so a
 * stalled flush cannot grow memory without bound.
 */
export declare class BoundedSpool {
    private readonly maxSize;
    private readonly queue;
    private evictedTotal;
    constructor(maxSize: number);
    get size(): number;
    get evictedCount(): number;
    push(event: SpooledEvent): SpoolPushResult;
    /** Removes and returns up to `max` events in seq order. */
    drain(max?: number): SpooledEvent[];
    /** Puts drained events back at the head, preserving seq order, when the
     *  flush failed and must be retried. */
    requeue(events: SpooledEvent[]): void;
}
//# sourceMappingURL=spool.d.ts.map