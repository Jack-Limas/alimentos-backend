/**
 * Fixed-size circular buffer: once full, each push overwrites the oldest
 * value. Memory stays bounded however many requests the server answers.
 */
export class RingBuffer<T> {
  private readonly items: T[] = [];
  private next = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('capacity must be a positive integer');
    }
  }

  push(item: T): void {
    if (this.items.length < this.capacity) this.items.push(item);
    else this.items[this.next] = item;
    this.next = (this.next + 1) % this.capacity;
  }

  get size(): number {
    return this.items.length;
  }

  /** Oldest first. */
  values(): T[] {
    return this.items.length < this.capacity
      ? [...this.items]
      : [...this.items.slice(this.next), ...this.items.slice(0, this.next)];
  }
}
