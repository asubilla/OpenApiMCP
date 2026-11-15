export interface ProgressEvent {
  progress: number;
  total?: number;
  message?: string;
  timestamp: string;
}

export class ProgressTracker {
  private total?: number;
  private progress = 0;
  private completed = false;
  private readonly callbacks: Array<(event: ProgressEvent) => void> = [];

  constructor(total?: number) {
    this.total = total;
  }

  private emit(progress: number, message?: string): ProgressEvent {
    this.progress = progress;
    const event: ProgressEvent = {
      progress: this.progress,
      total: this.total,
      message,
      timestamp: new Date().toISOString(),
    };
    for (const callback of this.callbacks) callback(event);
    return event;
  }

  update(progress: number, message?: string): ProgressEvent {
    return this.emit(progress, message);
  }

  increment(amount = 1, message?: string): ProgressEvent {
    return this.emit(this.progress + amount, message);
  }

  complete(message?: string): ProgressEvent {
    this.completed = true;
    const target = this.total !== undefined ? this.total : 100;
    return this.emit(target, message);
  }

  getProgress(): number {
    return this.progress;
  }

  getTotal(): number | undefined {
    return this.total;
  }

  isComplete(): boolean {
    if (this.completed) return true;
    if (this.total !== undefined) return this.progress >= this.total;
    return this.progress >= 100;
  }

  onProgress(callback: (event: ProgressEvent) => void): void {
    this.callbacks.push(callback);
  }
}

export function formatProgress(event: ProgressEvent): string {
  const prefix =
    event.total !== undefined
      ? `[${event.progress}/${event.total}]`
      : `[${event.progress}%]`;
  return event.message ? `${prefix} ${event.message}` : prefix;
}

export function createProgressTracker(total?: number): ProgressTracker {
  return new ProgressTracker(total);
}