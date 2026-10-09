type Handler = (...args: unknown[]) => void;

export class Emitter {
  private handlers = new Map<string, Handler[]>();

  on(evt: string, h: Handler): this {
    const list = this.handlers.get(evt) ?? [];
    list.push(h);
    this.handlers.set(evt, list);
    return this;
  }

  off(evt: string, h: Handler): this {
    const list = this.handlers.get(evt);
    if (!list) return this;
    const i = list.indexOf(h);
    if (i >= 0) list.splice(i);
    return this;
  }

  once(evt: string, h: Handler): this {
    const wrapper: Handler = (...args) => {
      h(...args);
    };
    return this.on(evt, wrapper);
  }

  emit(evt: string, ...args: unknown[]): boolean {
    const list = this.handlers.get(evt) ?? [];
    for (const h of list) h(...args);
    return list.length > 0;
  }
}
