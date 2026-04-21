export class PushableAsyncIterable<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolvers: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    const r = this.resolvers.shift();
    if (r) r({ value: item, done: false });
    else this.queue.push(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.resolvers.length) {
      this.resolvers.shift()!({ value: undefined as unknown as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.queue.length) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined as unknown as T, done: true });
      },
    };
  }
}
