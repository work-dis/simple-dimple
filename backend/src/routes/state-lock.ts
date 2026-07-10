// Сериализует конкурентные мутации connection-state ОДНОГО юзера (два
// одновременных POST /api/connect от того же юзера не должны прочитать
// stale status), но не блокирует разных юзеров друг относительно друга.
// Один instance разделяется между /api/connect, /api/server и
// /api/account/profile — все три мутируют одно и то же per-user состояние.
export function createStateLock() {
  const locks = new Map<string, Promise<unknown>>();

  return function withStateLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(userId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    locks.set(userId, next.then(() => void 0, () => void 0));
    return next;
  };
}

export type StateLock = ReturnType<typeof createStateLock>;
