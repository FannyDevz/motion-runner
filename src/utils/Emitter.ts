type Listener<T> = (payload: T) => void;

/** Minimal typed event emitter. `Events` maps event names to payload types. */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set = (this.listeners[event] ??= new Set());
    set.add(listener);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners[event]?.delete(listener);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners[event]?.forEach((listener) => listener(payload));
  }
}
