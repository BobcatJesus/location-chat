import type { Actor } from './Actor';

export class World {
  private actors: Actor[] = [];

  add<T extends Actor>(actor: T): T {
    this.actors.push(actor);
    return actor;
  }

  remove(actor: Actor): void {
    const i = this.actors.indexOf(actor);
    if (i !== -1) this.actors.splice(i, 1);
  }

  each(fn: (actor: Actor) => void): void {
    for (const a of this.actors) fn(a);
  }

  /** Call at the end of Scene.update, after all movement has happened. */
  sync(): void {
    for (const a of this.actors) a.sync();
  }
}