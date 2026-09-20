/**
 * The bedsit's VR mode in a real browser, against a headset that is not there.
 *
 * Run against a live dev server (`npm run dev -w taoot`):
 *
 *   npm run test:browser:vr -w taoot
 *   HEADED=1 …                              # watch it
 *
 * It needs no rip: `/bedsit/` is a model of a room, and with no `gamefiles/` it
 * is plaster and three lamps, which is still a room and still two eyes' worth
 * of it.
 *
 * ## Why this suite exists
 *
 * `bedsit/src/bedsit-xr.ts` has a suite of its own (`tests/auto/bedsit-xr.ts`)
 * and that one does the geometry — where the eyes are, which way the visitor
 * walks, that the disparity has the right sign. What it cannot do is touch GL.
 * It hands the module a context of six recorded calls, so everything that can
 * only go wrong against a real driver is invisible to it: a layer that will not
 * construct on a WebGL 1 context, a framebuffer bound to the wrong thing, a
 * program left on the wrong one between eyes, a viewport that puts both eyes in
 * the same half. Every one of those renders a black headset and passes the
 * whole headless gate.
 *
 * So this one is the real page, the real shader, and a real framebuffer — and
 * it reads the pixels back out of it.
 *
 * ## The headset is faked, and only as far as the first real thing
 *
 * There is no headset in CI and there is no way to fake one that a browser will
 * believe, so `navigator.xr` is replaced before the page's first line: a
 * session that hands back poses, and an `XRWebGLLayer` that builds an ACTUAL
 * framebuffer out of the page's own context. From `new XRWebGLLayer` onward
 * nothing is pretend — the page's shader draws the room into that framebuffer
 * through its own uniforms, and `readPixels` is what says whether it did.
 *
 * ## What it asserts, and why not less
 *
 * The intended outcome, never mere difference. That the button is ABSENT until
 * both of its conditions hold and present after — the whole point of it is that
 * it never appears where it cannot work. That `V` opens a session even with the
 * pointer locked, which is the state this page is in for all of its life and
 * the reason the key exists at all. That BOTH halves of the framebuffer come
 * back lit, and that they are not the same picture, which is the difference
 * between stereo and one eye drawn twice. That the furniture can be taken out
 * mid-session — that re-bakes three shadow cubes through a framebuffer of their
 * own — and the room comes back. And that handing the headset over gives the
 * flat page its loop and its button back.
 */
import { chromium } from "playwright";

const HEADED = !!process.env.HEADED && process.env.HEADED !== "0";

/**
 * The room's URL: `/bedsit/`, under whatever root the runner was given.
 *
 * Not built on `playUrl` from `driver.ts` the way the workbench's is. That one
 * names the PLAY page and swaps its last segment, and everything it carries —
 * the edition, the language, the game — is about a page that boots a rip. This
 * page boots nothing.
 */
const bedsitUrl = (): string => {
  const url = new URL(process.env.APP_URL ?? "http://localhost:5175/");
  url.pathname = url.pathname.replace(/(play\/?)?$/, "") + "bedsit/";
  return url.toString();
};

/** how big each eye's half of the framebuffer is, in this suite's headset */
const EYE = 512;

/**
 * The headset, as a string of plain JavaScript.
 *
 * A STRING, and not a function handed to `addInitScript`. Playwright serialises
 * such a function by calling `toString()` on it — but this file is TypeScript,
 * so what it would serialise is esbuild's OUTPUT, which refers to helpers
 * (`__name`) that live in the module and not in the page. The page throws on
 * the first one and `navigator.xr` is never replaced, and the only symptom is a
 * button that never appears, which reads exactly like the feature being broken.
 */
const FAKE_HEADSET = `(() => {
  const EYE = ${EYE};
  const ID = () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
  const tf = (m) => ({
    matrix: m,
    position: { x: m[12], y: m[13], z: m[14] },
    get inverse() {
      const o = ID();
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[c * 4 + r] = m[r * 4 + c];
      for (let r = 0; r < 3; r++) o[12 + r] = -(m[12] * o[r] + m[13] * o[4 + r] + m[14] * o[8 + r]);
      return tf(o);
    },
  });
  const bag = { cb: null, end: null, layer: null, gl: null, frames: 0 };
  window.__xr = bag;

  // The one piece of this that is not pretend: a real framebuffer, with a real
  // colour texture and a real depth buffer, made out of the page's own context.
  window.XRWebGLLayer = function (session, gl) {
    const fb = gl.createFramebuffer();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, EYE * 2, EYE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    const db = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, db);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, EYE * 2, EYE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.framebuffer = fb;
    this.framebufferWidth = EYE * 2;
    this.framebufferHeight = EYE;
    // side by side, which is what a headset's layer does
    this.getViewport = (v) => ({ x: v.eye === "left" ? 0 : EYE, y: 0, width: EYE, height: EYE });
    bag.layer = this; bag.gl = gl;
  };

  const session = {
    renderState: { baseLayer: null },
    inputSources: [],
    updateRenderState(st) { if (st.baseLayer) session.renderState.baseLayer = st.baseLayer; },
    requestReferenceSpace: () => Promise.resolve({}),
    requestAnimationFrame(cb) { bag.cb = cb; return 1; },
    end() { bag.end && bag.end(); return Promise.resolve(); },
    addEventListener(_t, l) { bag.end = l; },
  };
  // \`navigator.xr\` is a readonly accessor on the prototype: a plain assignment
  // to it is dropped without a word
  const xr = {
    isSessionSupported: () => Promise.resolve(true),
    requestSession: () => Promise.resolve(session),
  };
  Object.defineProperty(Navigator.prototype, "xr", { configurable: true, get: () => xr });
  // a browser with no XR device refuses this outright; the page carries on
  // regardless, and this keeps the refusal out of the way of what is being
  // tested rather than testing the refusal
  WebGLRenderingContext.prototype.makeXRCompatible = () => Promise.resolve();

  // One controller, installed the first time the suite asks for it. Left, so
  // it is the one that GLIDES — and the y axis only, because x on the stick
  // that turns would snap the room round mid-measurement.
  const pad = {
    axes: [0, 0, 0, 0],
    buttons: [0, 1, 2, 3, 4].map(() => ({ pressed: false, touched: false, value: 0 })),
  };
  const hand = { handedness: "left", targetRayMode: "tracked-pointer", gamepad: pad };
  const inHand = () => { if (!session.inputSources.length) session.inputSources.push(hand); };
  bag.stick = (y) => { inHand(); pad.axes[3] = y; };
  bag.press = (on) => { inHand(); pad.buttons[4].pressed = on; };

  /**
   * One headset frame, head level and 1.6 m up, eyes 64 mm apart.
   *
   * The field is 1.6 radians — 92° — and not something narrower, because the
   * vignette is measured in the ANGLE off the eye's axis and a narrow fake
   * would sit entirely inside the ring's widest setting and never see it. A
   * Quest 3 shows about 90° vertically per eye, so this is the shape of the
   * thing the numbers were chosen for.
   */
  bag.frame = () => {
    const pose = ID(); pose[13] = 1.6;
    const views = ["left", "right"].map((eye) => {
      const m = new Float32Array(pose);
      m[12] += eye === "left" ? -0.032 : 0.032;
      const p = new Float32Array(16);
      const f = 1 / Math.tan(0.8), n = 0.03, fa = 40;
      p[0] = f; p[5] = f; p[10] = (fa + n) / (n - fa); p[11] = -1; p[14] = (2 * fa * n) / (n - fa);
      return { eye, projectionMatrix: p, transform: tf(m) };
    });
    const cb = bag.cb; bag.cb = null;
    if (cb) cb(bag.frames++ * 16, { session, getViewerPose: () => ({ transform: tf(pose), views }) });
    return bag.frames;
  };

  /** one eye's half, read back: how much of it is not the clear colour, and a
   *  cheap signature of what is in it */
  bag.read = (half) => {
    const gl = bag.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, bag.layer.framebuffer);
    const px = new Uint8Array(EYE * EYE * 4);
    gl.readPixels(half * EYE, 0, EYE, EYE, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let lit = 0, sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      // the page clears to (0.02, 0.03, 0.04): anything above that was drawn
      if (px[i] > 12 || px[i + 1] > 14 || px[i + 2] > 16) lit++;
      sum += px[i] * (i % 997);            // position-sensitive, so two eyes differ
    }
    return { lit: lit / (EYE * EYE), sum };
  };

  /**
   * The middle of an eye against its rim, which is what a vignette IS.
   *
   * A ring that closes takes the periphery and leaves the middle alone, so one
   * number cannot show it: a picture that went dark all over is a lamp being
   * turned off, and a picture whose rim went dark while its middle did not is
   * the ring. The disc and the annulus are in fractions of the half-height, so
   * they mean the same thing whatever the eye's pixels are.
   */
  bag.zones = (half) => {
    const gl = bag.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, bag.layer.framebuffer);
    const px = new Uint8Array(EYE * EYE * 4);
    gl.readPixels(half * EYE, 0, EYE, EYE, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const R = EYE / 2;
    let cs = 0, cn = 0, es = 0, en = 0;
    for (let y = 0; y < EYE; y++) for (let x = 0; x < EYE; x++) {
      const i = (y * EYE + x) * 4;
      const l = px[i] + px[i + 1] + px[i + 2];
      const d = Math.sqrt((x - R) * (x - R) + (y - R) * (y - R)) / R;
      if (d < 0.35) { cs += l; cn++; }
      else if (d > 0.82 && d < 1.0) { es += l; en++; }
    }
    return { centre: cs / cn, edge: es / en };
  };
})();`;

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 200 : 0 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  let bad = 0;
  const check = (ok: boolean, said: string): void => {
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${said}`);
  };

  await page.addInitScript({ content: FAKE_HEADSET });
  const url = bedsitUrl();
  console.log(`opening ${url}`);
  await page.goto(url);

  await page.waitForFunction(
    () => document.querySelector("#splash")?.getAttribute("data-state") === "ready",
    null,
    { timeout: 300_000 },
  );
  // the room is not the visitor's yet, so neither is the way into it
  check(await page.locator("#vr").isHidden(), "no VR button before the room is handed over");

  await page.click("#load");
  await page.keyboard.press("Escape");          // past the intro
  await page.waitForFunction(
    () => (window as unknown as { bedsit?: { ready?: boolean } }).bedsit?.ready === true,
    null,
    { timeout: 300_000 },
  );
  await page.waitForFunction(
    () => !document.querySelector("#vr")?.hasAttribute("hidden"),
    null,
    { timeout: 60_000 },
  );
  check(true, "the VR button is offered once the room is up");
  const keys = (await page.locator("#keys").textContent()) ?? "";
  check(/V\s*headset/.test(keys), `the key list names the key too (${keys.trim().split("·").pop()?.trim()})`);

  /**
   * The pointer is LOCKED, and that is why the key is the way in.
   *
   * This page takes pointer lock at the Start press and keeps it, and a locked
   * pointer sends every mouse event to the element holding the lock whatever is
   * drawn on top. So a click aimed at the button lands on the canvas, and this
   * checks that rather than working around it: the day the page stops locking
   * the pointer, the click becomes the way in and this line is what says so.
   */
  await page.evaluate(() => {
    (window as unknown as { __hit?: string }).__hit = "";
    addEventListener("click", (e) => {
      (window as unknown as { __hit?: string }).__hit = (e.target as Element).id;
    }, true);
  });
  const box = (await page.locator("#vr").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const hit = await page.evaluate(() => (window as unknown as { __hit?: string }).__hit);
  check(hit === "gl", `a click over the button goes to the canvas while the pointer is locked (${hit})`);

  await page.keyboard.press("v");
  await page.waitForFunction(
    () => !!(window as unknown as { __xr: { cb: unknown } }).__xr.cb,
    null,
    { timeout: 60_000 },
  );
  check(true, "V opened a session with the pointer locked");
  check(
    (await page.locator("#vr").textContent()) !== "VR",
    "the button says the headset has it",
  );

  const drive = async (n = 3): Promise<void> => {
    for (let i = 0; i < n; i++) {
      await page.evaluate(() => (window as unknown as { __xr: { frame(): number } }).__xr.frame());
      await page.waitForTimeout(120);
    }
  };
  type Eye = { lit: number; sum: number };
  const eyes = async (): Promise<Eye[]> =>
    page.evaluate(() => {
      const xr = (window as unknown as { __xr: { read(h: number): Eye } }).__xr;
      return [xr.read(0), xr.read(1)];
    }) as Promise<Eye[]>;

  await drive();
  const [l, r] = await eyes();
  check(l.lit > 0.2, `the left eye has a room in it (${(l.lit * 100).toFixed(0)}% drawn)`);
  check(r.lit > 0.2, `the right eye has a room in it (${(r.lit * 100).toFixed(0)}% drawn)`);
  // two eyes of one room, not one eye drawn twice: alike, and not identical
  check(Math.abs(l.lit - r.lit) < 0.05, "both eyes are looking at the same room");
  check(l.sum !== r.sum, "and they are looking at it from different places");

  /**
   * The vignette, in pixels.
   *
   * The session's own suite has the numbers on their way to the shader — how
   * far the ring has closed, how black the blink is — and cannot have anything
   * else, because it hands the module a context that does not draw. What is
   * only true against a real driver is HERE: that a second program drawing a
   * blended quad over the room leaves the room's attribute arrays and its
   * program exactly as it found them. Get that wrong and the ring is perfect
   * and the next frame of the room is not.
   *
   * So: the rim against the middle, before, during and after.
   */
  const zones = async (): Promise<{ centre: number; edge: number }> =>
    page.evaluate(() => (window as unknown as {
      __xr: { zones(h: number): { centre: number; edge: number } };
    }).__xr.zones(0));
  const stick = async (y: number): Promise<void> => {
    await page.evaluate((v) => (window as unknown as { __xr: { stick(y: number): void } }).__xr.stick(v), y);
  };

  const still = await zones();
  await stick(-1);                              // pushed away from the hand is forward
  await drive(30);                              // a few time constants of gliding
  const gliding = await zones();
  check(gliding.edge < still.edge * 0.5,
    `the rim goes dark while gliding (${still.edge.toFixed(1)} → ${gliding.edge.toFixed(1)})`);
  check(gliding.centre > still.centre * 0.8,
    `and the middle is left alone (${still.centre.toFixed(1)} → ${gliding.centre.toFixed(1)})`);

  /**
   * The restore, and how to ask about it without asking the wrong question.
   *
   * The obvious check — the room before the glide against the room after it —
   * is not a check at all: the visitor has GLIDED, which is to say they are
   * two thirds of a metre further into the room and looking at something else.
   * It fails on a working restore and would have to be loosened until it could
   * not fail on a broken one either.
   *
   * Two questions do hold still. The ring is drawn BETWEEN the eyes — room,
   * ring, room, ring — so a program or an attribute array left wrong by the
   * first ring is read by the second eye, and the two eyes stop agreeing. And
   * from a standing start two consecutive frames are one picture, so a leak
   * that accumulates shows as drift where there should be none. Neither asks
   * where the visitor is.
   */
  const [gl0, gl1] = await eyes();
  check(Math.abs(gl0.lit - gl1.lit) < 0.05,
    `the second eye is still right with a ring drawn before it (${(gl0.lit * 100).toFixed(0)}% / ${(gl1.lit * 100).toFixed(0)}%)`);

  await stick(0);
  await drive(40);
  const opened = await zones();
  check(opened.edge > still.edge * 0.8,
    `the rim comes back when the stick is let go (${opened.edge.toFixed(1)})`);

  const settle = (await eyes())[0].lit;
  await drive(1);
  const again = (await eyes())[0].lit;
  check(Math.abs(settle - again) < 0.01,
    `and the room holds still when the visitor does (${(settle * 100).toFixed(1)}% → ${(again * 100).toFixed(1)}%)`);

  /**
   * The blink: at the bottom of it the view is black, in both eyes, and the
   * standpoint has changed under it.
   */
  await page.evaluate(() => (window as unknown as { __xr: { press(on: boolean): void } }).__xr.press(true));
  const dark: number[] = [];
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => (window as unknown as { __xr: { frame(): number } }).__xr.frame());
    await page.waitForTimeout(60);
    dark.push((await zones()).centre);
  }
  await page.evaluate(() => (window as unknown as { __xr: { press(on: boolean): void } }).__xr.press(false));
  check(Math.min(...dark) < 1, `the view goes fully black for the jump (darkest ${Math.min(...dark).toFixed(2)})`);
  await drive(20);
  check((await zones()).centre > 1, "and comes back out of it");

  /**
   * The furniture, out, mid-session.
   *
   * That checkbox re-bakes three shadow cubes, each through a framebuffer of
   * its own, in the middle of a session that owns the screen — the one thing
   * on this page that binds a framebuffer outside the frame loop. If it gives
   * back the wrong one, this is where it shows.
   */
  const took = await page.evaluate(() => {
    const box = document.querySelector<HTMLInputElement>("#furniture input[type=checkbox]");
    if (!box) return "";
    box.checked = !box.checked;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    return box.parentElement?.textContent?.trim() ?? "a piece";
  });
  await drive();
  const after = await eyes();
  check(after[0].lit > 0.2 && after[1].lit > 0.2,
    `the room survives a re-bake in the headset (took out: ${took || "nothing to take"})`);

  await page.evaluate(() => (window as unknown as { __xr: { end(): void } }).__xr.end());
  await page.waitForTimeout(500);
  check((await page.locator("#vr").textContent()) === "VR", "the button comes back");
  const moving = await page.evaluate(async () => {
    // the flat loop resizes the canvas to the window on its first frame, which
    // is the cheapest proof it is running again
    const cv = document.querySelector<HTMLCanvasElement>("#gl")!;
    cv.width = 8;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return cv.width !== 8;
  });
  check(moving, "and the flat page has its own loop back");

  await browser.close();
  if (errors.length) {
    console.log(`\nPAGE ERRORS — the room may be drawn and still broken:\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }
  if (bad) {
    console.log(`\n${bad} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
};

void main();
