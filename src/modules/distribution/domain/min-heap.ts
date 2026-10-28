/**
 * Binary min-heap ordered by `compare` (negative = `a` comes out first).
 *
 * Why a heap and not a sort: the distribution engine re-scores an order when
 * it reaches the top (taking stock changes the expiry pressure of the orders
 * still waiting). A sorted array would need a full re-sort or an O(n) insert
 * for every re-push; the heap re-inserts in O(log n) and always gives the best
 * remaining order in O(log n), so n orders with k lazy re-pushes cost
 * O((n + k) log n) instead of O(n · k).
 */
export class MinHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private before(i: number, j: number): boolean {
    return this.compare(this.items[i] as T, this.items[j] as T) < 0;
  }

  private swap(i: number, j: number): void {
    const tmp = this.items[i] as T;
    this.items[i] = this.items[j] as T;
    this.items[j] = tmp;
  }

  private siftUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (!this.before(child, parent)) return;
      this.swap(child, parent);
      child = parent;
    }
  }

  private siftDown(index: number): void {
    let parent = index;
    const length = this.items.length;
    for (;;) {
      const left = 2 * parent + 1;
      const right = left + 1;
      let best = parent;
      if (left < length && this.before(left, best)) best = left;
      if (right < length && this.before(right, best)) best = right;
      if (best === parent) return;
      this.swap(parent, best);
      parent = best;
    }
  }
}
