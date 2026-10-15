/**
 * The engine's About box: what F12 puts up in TI.EXE.
 *
 * The F12 arm of the window proc's WM_KEYDOWN table (0x41b118, byte index
 * 0x41b158) is 0x41ae39: `call 0x41b920`, then `xor al, al`, so the key never
 * reaches the scripts. 0x41b920 formats the text below, suspends the game's UI
 * (0x420500), shows it through 0x41ba70 (word-wrap, then
 * MessageBox(…, "About", MB_ICONINFORMATION | MB_TASKMODAL)) and resumes the UI
 * (0x4205e0). Addresses are the October 1996 TI.EXE's (the en and ru trees). The
 * builds of the other editions carry the same format, with their own dates.
 *
 * Timelapse's tl.exe (September 1996) has the same box: F12 arm 0x4055db,
 * formatter 0x4060c0, wrap 0x4047a0 (byte-identical to TI.EXE's), with the same
 * format string and the same OS, sound and joystick words.
 */

/**
 * TI.EXE's message-box word wrap (0x41a000). It copies up to 40 characters a
 * line, ending a line early at a newline. A line that reaches 40 backs up to the
 * last space (or to the end of the text) and breaks there. Spaces at the start of
 * the next line are skipped, but only after such a break.
 */
export function wordWrapText(src: string): string {
  const out: string[] = [];
  let s = 0;
  let remain = src.length;
  for (;;) {
    let inner = 0;
    while (remain !== 0 && inner < 40) {
      const c = src[s++];
      out.push(c);
      remain--;
      if (c === "\n") break;
      inner++;
    }
    if (inner === 40) {
      // the exe walks on past the start of a line with no space at all (into
      // whatever precedes the buffer); here such a line stops at the start
      while (s < src.length && src[s] !== " " && s > 0) {
        s--;
        remain++;
        out.pop();
      }
      out.push("\n");
    }
    if (s >= src.length) break;
    if (inner === 40 && src[s] === " ") {
      do {
        s++;
        remain--;
      } while (src[s] === " ");
    }
  }
  return out.join("");
}

/** what the About box reports about the machine it runs on */
export interface AboutBoxFacts {
  /** the exe's build stamp, `__DATE__ " at " __TIME__`, e.g. "Oct  7 1996 at 08:42:02" */
  compiled: string;
  /** the heap descriptor's zone size, +0xc of 0x433af0 */
  heapZoneBytes: number;
  /** the largest free block (0x433b10) */
  heapFreeBytes: number;
}

/**
 * The About box's text, before the wrap, as 0x41b920 builds it. The OS line is
 * chosen by the Win95 flag ([0x487dc0], "Windows 95, build %ld" with the build
 * number masked to 16 bits) or the Win 3.1 flag ([0x487b94]), else "Windows NT,
 * build %ld". The port answers as the retail Windows 95 the game was made for
 * (4.00.950). The sound line is "16-bit"/"8-bit" ([0x4896d0]) and
 * "stereo"/"mono" ([0x489878]); the port mixes 16-bit stereo. There is no
 * joystick ([0x4856f8]). Both heap figures are divided by 1024 rounding toward
 * zero (`cdq; and edx, 0x3ff; add; sar 0xa`).
 */
export function aboutBoxText(facts: AboutBoxFacts): string {
  const k = (bytes: number) => Math.trunc(bytes / 1024);
  return (
    "DreamFactory v4.0\n(C) Copyright 1993-1996 CyberFlix, Inc.\nAll rights reserved.\n\n" +
    "Windows RT4 engine, standard version\n" +
    `Compiled ${facts.compiled}\n\n` +
    "Windows 95, build 950\n" +
    `Heap zone is ${k(facts.heapZoneBytes)}K\n` +
    `${k(facts.heapFreeBytes)}K is currently free\n` +
    "Joystick disabled\n" +
    "Audio is 16-bit stereo via WinMM"
  );
}
