/**
 * Bounded in-memory spool (docs/0906/ai-memory §3.1): the agent hot path
 * pushes and never blocks on the network. Capacity defaults to the contract
 * checkpoint event cap (500); when full, the oldest event is evicted so a
 * stalled flush cannot grow memory without bound.
 */
export class BoundedSpool {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.queue = [];
        this.evictedTotal = 0;
        if (maxSize < 1)
            throw new Error('BoundedSpool.maxSize must be >= 1');
    }
    get size() {
        return this.queue.length;
    }
    get evictedCount() {
        return this.evictedTotal;
    }
    push(event) {
        this.queue.push(event);
        let evicted = false;
        while (this.queue.length > this.maxSize) {
            this.queue.shift();
            this.evictedTotal += 1;
            evicted = true;
        }
        return { evicted };
    }
    /** Removes and returns up to `max` events in seq order. */
    drain(max = this.maxSize) {
        return this.queue.splice(0, max);
    }
    /** Puts drained events back at the head, preserving seq order, when the
     *  flush failed and must be retried. */
    requeue(events) {
        if (events.length === 0)
            return;
        this.queue.unshift(...events);
        while (this.queue.length > this.maxSize) {
            this.queue.shift();
            this.evictedTotal += 1;
        }
    }
}
