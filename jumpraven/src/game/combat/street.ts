/**
 * The streets' rules the jeep (0x40cded), the fuel station (0x409e30) and the
 * weapons ship (0x42982f) each carry their own copy of in RAVEN.EXE: choose one
 * of three ways at a cell's centre, roll on to the cell's edge or turn the
 * corner about it, and at the edge go into the next cell and choose again. The
 * three records share the fields at the same offsets (src/game/combat/jeep.ts,
 * src/game/combat/fuel.ts).
 */
import { turnToward } from "./lib";
import { cosMul, dist, sinMul, type Obj, type World } from "./world";

/** what a street-bound record holds for the drive */
export interface StreetRec extends Obj {
  /** +0x30 the state: 0 choose, 1 and 2 roll along x or y, 3 and 4 turn */
  state: number;
  /** +0x34 the heading it is turning to */
  goal: number;
  /** +0x38, +0x3c the point it is going to: the cell's edge, or in a turn the corner it turns about */
  goalX: number;
  goalY: number;
  /** +0x40 rolling: 1 up x or y, 0 down; turning: the step a frame */
  way: number;
  /** +0x44 its speed */
  speed: number;
  /** +0x48 a turn's radius */
  radius: number;
  /** the cell it is going to */
  toX: number;
  toY: number;
}

/**
 * State 0's choice of the three `way`s (0x40cded, 0x409e30, 0x42982f): the
 * first if it is `open`, but one time in ten the second or third even so;
 * else the second, else the third. False when it is boxed in.
 */
export function chooseWay(w: World, r: StreetRec, way: [number, number, number], open: (a: number) => boolean): boolean {
  if (open(way[0])) {
    r.goal = way[0];
    if (w.roll(10) <= 1) {
      if (open(way[1])) r.goal = way[1];
      else if (open(way[2])) r.goal = way[2];
    }
  } else if (open(way[1])) r.goal = way[1];
  else if (open(way[2])) r.goal = way[2];
  else return false;
  return true;
}

/**
 * 0x431578 (the jeep's), 0x43135c (the station's), 0x43139c (the station's
 * drive off): on to the cell's far edge along its heading, from wherever
 * `goalX`, `goalY` already are
 */
export function farEdge(r: StreetRec): void {
  switch (r.angle) {
    case 0:
      r.goalX += 0x80;
      r.state = 1;
      r.way = 1;
      r.toX++;
      break;
    case 0x40:
      r.goalY += 0x80;
      r.state = 2;
      r.way = 1;
      r.toY++;
      break;
    case 0x80:
      r.goalX -= 0x80;
      r.state = 1;
      r.way = 0;
      r.toX--;
      break;
    case 0xc0:
      r.goalY -= 0x80;
      r.state = 2;
      r.way = 0;
      r.toY--;
      break;
  }
}

/**
 * The way chosen, set off from the cell's centre: straight on to its far
 * edge, or round the corner the turn is about (0x431598, the station's
 * 0x43137c) at a step of heading that makes the quarter circle at its speed
 */
export function setOff(r: StreetRec): void {
  r.toX = r.cellX;
  r.toY = r.cellY;
  r.goalX = (r.cellX << 8) + 0x80;
  r.goalY = (r.cellY << 8) + 0x80;
  if (r.goal === r.angle) return farEdge(r);
  switch (r.angle) {
    case 0:
      if (r.goal === 0xc0) {
        r.state = 3;
        r.goalX -= 0x80;
        r.goalY -= 0x80;
        r.toY--;
      }
      if (r.goal === 0x40) {
        r.state = 4;
        r.goalX -= 0x80;
        r.goalY += 0x80;
        r.toY++;
      }
      break;
    case 0x40:
      if (r.goal === 0) {
        r.state = 3;
        r.goalX += 0x80;
        r.goalY -= 0x80;
        r.toX++;
      }
      if (r.goal === 0x80) {
        r.state = 4;
        r.goalX -= 0x80;
        r.goalY -= 0x80;
        r.toX--;
      }
      break;
    case 0x80:
      if (r.goal === 0xc0) {
        r.state = 4;
        r.goalX += 0x80;
        r.goalY -= 0x80;
        r.toY--;
      }
      if (r.goal === 0x40) {
        r.state = 3;
        r.goalX += 0x80;
        r.goalY += 0x80;
        r.toY++;
      }
      break;
    case 0xc0:
      if (r.goal === 0x80) {
        r.state = 3;
        r.goalX -= 0x80;
        r.goalY += 0x80;
        r.toX--;
      }
      if (r.goal === 0) {
        r.state = 4;
        r.goalX += 0x80;
        r.goalY += 0x80;
        r.toX++;
      }
      break;
  }
  r.radius = dist(r.goalX - r.x, r.goalY - r.y, 0);
  // a quarter circle, 0x3d5b / 0x2710 ≈ π/2 of the radius, in 0x40 of heading
  r.way = Math.trunc((r.speed << 6) / Math.trunc((r.radius * 0x3d5b) / 0x2710));
}

/**
 * States 1 and 2: along x or y at its speed to the cell's edge, wobbling up to
 * `wobble` across the street (the jeep's 0x40, the station's 0x33, the ship's
 * 0x2a), and at the edge on into the next cell
 */
export function rollAlong(w: World, r: StreetRec, wobble: number): void {
  const alongX = r.state === 1;
  const t = alongX ? r.goalY : r.goalX;
  let across = (alongX ? r.y : r.x) + w.roll(5) - 3;
  if (t - wobble > across) across = t - wobble;
  if (t + wobble < across) across = t + wobble;
  if (alongX) r.y = across;
  else r.x = across;
  const goal = alongX ? r.goalX : r.goalY;
  if (r.way) {
    if (alongX) r.x += r.speed;
    else r.y += r.speed;
    if ((alongX ? r.x : r.y) >= goal) arrive(r);
  } else {
    if (alongX) r.x -= r.speed;
    else r.y -= r.speed;
    if ((alongX ? r.x : r.y) <= goal) arrive(r);
  }
}

/** States 3 and 4: a step round the quarter circle about the corner, and at its end on into the next cell */
export function turnRound(r: StreetRec): void {
  r.angle = turnToward(r.angle, r.goal, r.way, 0x100);
  const a = (r.angle + (r.state === 3 ? 0x40 : -0x40)) & 0xff;
  r.x = cosMul(a, r.radius) + r.goalX;
  r.y = sinMul(a, r.radius) + r.goalY;
  if (r.angle === r.goal) arrive(r);
}

/** 0x40d782 (the jeep's), 0x40ad36 / 0x42a6e1: at the edge — into the next cell, its point on the edge, and choose again */
export function arrive(r: StreetRec): void {
  r.toX = r.cellX;
  r.toY = r.cellY;
  switch (r.angle) {
    case 0:
      r.cellX++;
      r.x = r.cellX << 8;
      break;
    case 0x40:
      r.cellY++;
      r.y = r.cellY << 8;
      break;
    case 0x80:
      r.x = r.cellX << 8;
      r.cellX--;
      break;
    case 0xc0:
      r.y = r.cellY << 8;
      r.cellY--;
      break;
  }
  r.state = 0;
}
