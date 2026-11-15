export class CancellationToken {
  private cancelled = false;
  private listeners: (() => void)[] = [];

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    const listeners = this.listeners.splice(0);
    for (const cb of listeners) cb();
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  onCancel(cb: () => void): void {
    if (this.cancelled) {
      cb();
      return;
    }
    this.listeners.push(cb);
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new Error("Cancelled");
  }
}

export class CancellationRegistry {
  private tokens = new Map<string, CancellationToken>();

  register(id: string, token: CancellationToken): void {
    this.tokens.set(id, token);
  }

  cancel(id: string): boolean {
    const token = this.tokens.get(id);
    if (!token) return false;
    token.cancel();
    return true;
  }

  get(id: string): CancellationToken | undefined {
    return this.tokens.get(id);
  }

  remove(id: string): void {
    this.tokens.delete(id);
  }

  cancelAll(): void {
    for (const token of this.tokens.values()) token.cancel();
  }

  activeCount(): number {
    return this.tokens.size;
  }
}

export function withCancellation<T>(
  token: CancellationToken,
  fn: () => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      callback();
    };

    if (token.isCancelled()) {
      reject(new Error("Cancelled"));
      return;
    }

    const interval = setInterval(() => {
      if (token.isCancelled()) {
        settle(() => reject(new Error("Cancelled")));
      }
    }, 50);

    token.onCancel(() => {
      settle(() => reject(new Error("Cancelled")));
    });

    Promise.resolve()
      .then(() => fn())
      .then(
        (value) => settle(() => resolve(value)),
        (err) => settle(() => reject(err))
      );
  });
}
