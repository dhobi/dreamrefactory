/**
 * A session with no game behind it, for the scheduler's and the actors'
 * suites: `bare()` opens one on the set "deck" (v5 rules when asked), and
 * `actor()` stands an actor in it at a place, facing, speed and turn rate.
 */
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { GameSession } from "@dreamfactory/engine/runtime/session";

export function bare(v5 = false): GameSession {
  const s = new GameSession(() => null, new NullAudioSink());
  s.onLog = () => {};
  s.isV5 = v5;
  s.actorRuntime.currentSet = "deck";
  return s;
}

export function actor(s: GameSession, name: string, at: { x?: number; y?: number; deg?: number; speed?: number; turn?: number } = {}) {
  const a = new ActorInstance({ name, poses: [] } as never, { name: "gang.cst", members: [] } as never);
  a.name = name;
  a.setName = "deck";
  a.worldX = at.x ?? 0;
  a.worldY = at.y ?? 0;
  a.deg = at.deg ?? 0;
  a.speed = at.speed ?? 10;
  a.turn = at.turn ?? 10;
  (s.actorRuntime as unknown as { actors: Map<string, ActorInstance> }).actors.set(name, a);
  return a;
}
