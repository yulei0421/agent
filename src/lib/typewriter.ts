export type Typewriter = {
  push(text: string): void;
  drain(): Promise<void>;
  cancel(): void;
};

export function createTypewriter(onUpdate: (text: string) => void, intervalMs = 18): Typewriter {
  const delay = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 18;
  const queue: string[] = [];
  const waiters: Array<() => void> = [];
  let content = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const resolveWhenIdle = () => {
    if (timer || queue.length > 0) return;
    while (waiters.length > 0) waiters.shift()?.();
  };

  const schedule = () => {
    if (timer || queue.length === 0 || cancelled) return;
    timer = setTimeout(() => {
      timer = undefined;
      const character = queue.shift();
      if (character !== undefined) {
        content += character;
        onUpdate(content);
      }
      schedule();
      resolveWhenIdle();
    }, delay);
  };

  return {
    push(text) {
      if (cancelled || !text) return;
      queue.push(...text);
      schedule();
    },
    drain() {
      if (!timer && queue.length === 0) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    cancel() {
      cancelled = true;
      queue.length = 0;
      if (timer) clearTimeout(timer);
      timer = undefined;
      resolveWhenIdle();
    }
  };
}
