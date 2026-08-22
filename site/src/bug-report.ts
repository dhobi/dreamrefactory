/**
 * The **Report bug** button: a GitHub issue with the answers the page already
 * has, so that a report arrives with the three things every report about this
 * port is missing — where the player was standing, what the engine had just
 * said, and a picture of the screen.
 *
 * GitHub takes a prefilled issue over the URL (`issues/new?title=&body=`), and
 * that is the whole of what it takes: **an image cannot be passed this way**.
 * There is no query parameter for an attachment, and a data URI for a 512x384
 * PNG is tens of kilobytes against a URL that starts failing around eight — the
 * only route an image has into a comment box is the clipboard or a drag. So the
 * screen goes to the clipboard and the body says to paste it, and a browser that
 * will not take an image on the clipboard downloads the PNG instead.
 *
 * The order in {@link installBugReport} is the load-bearing part, and both halves
 * of it are the same rule — a browser only does these things for a click:
 *
 *  1. `clipboard.write` FIRST, and called (not awaited) inside the click's own
 *     task. It refuses when the document is not focused, and the new tab is
 *     about to take the focus away.
 *  2. `window.open` straight after, still in that task. Opened from a `.then()`
 *     it is a popup, and a blocker may eat it.
 *
 * Everything that can be awaited is awaited after both, where it can only affect
 * what the player is told.
 *
 * Nothing is sent anywhere by this file. It opens a form; the player reads what
 * is in it, adds what happened and decides whether to submit — which is also the
 * answer to "what does it collect": whatever you can see in the box.
 */

/** the port's own repository — the issue is about this port, never about the game */
const ISSUE_URL = "https://github.com/dhobi/dreamrefactory/issues/new";

/**
 * How much of the log goes in. Eight lines is about one room's worth of engine
 * chatter — the movie that played, the disc that mounted, the set that was left —
 * and it is the tail that says what led up to a bug, not the head.
 */
const LOG_LINES = 8;

/**
 * A ceiling on the body, because the whole thing travels as a URL: GitHub answers
 * a long enough one with 414 and no issue at all. Four thousand characters is
 * comfortably under where that starts and far more than the fields below fill.
 */
const BODY_LIMIT = 4000;

/** what the page can answer about itself when the button is pressed */
export interface BugReportPage {
  /** the framebuffer, exactly as it stands — the picture for the clipboard */
  canvas: HTMLCanvasElement;
  /** where the player is: the set/scene/view line, or "" before a game is up */
  where(): string;
  /** which copy is running, as a sentence ("English (gamefiles/en/)") */
  edition(): string;
  /** the last `n` lines the engine logged, oldest first */
  log(n: number): string[];
  /**
   * What the downloaded screenshot is called, when the clipboard refuses it.
   *
   * The page's, because this module is shared and the file lands in a folder that
   * may already hold one from the other game. It was a constant here while only
   * Titanic reported bugs.
   */
  shotName: string;
  /** which build this is, for the issue body */
  version: string;
  /**
   * Tell the player what became of the picture — on the clipboard to paste, or
   * downloaded as a file to attach. The words are the page's, because they are
   * the only part of this the player reads and the page has the catalogue.
   */
  note(how: ShotWent): void;
}

/** the two places the screenshot can end up */
export type ShotWent = "clipboard" | "file";

export function installBugReport(
  btn: HTMLButtonElement,
  page: BugReportPage,
): void {
  btn.addEventListener("click", () => {
    // 1 and 2 — see the header: both have to happen in the click's own task
    const shot = copyScreen(page.canvas, page.shotName);
    const url = `${ISSUE_URL}?title=${encodeURIComponent(title(page))}&body=${encodeURIComponent(body(page))}`;
    window.open(url, "_blank", "noopener");
    // 3: only now, and only to say which of the two happened to the picture
    void shot.then((how) => page.note(how));
  });
}

/**
 * The screen onto the clipboard, or failing that into the downloads folder.
 *
 * `ClipboardItem` is handed the *promise* of the blob rather than the blob:
 * that form exists precisely so the write can be issued while the click is still
 * the reason for it, with the encoding still to come. Waiting for `toBlob` first
 * and writing afterwards is the same picture and a rejected write.
 */
async function copyScreen(
  canvas: HTMLCanvasElement,
  shotName: string,
): Promise<ShotWent> {
  const png = new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("no blob"))),
      "image/png",
    );
  });
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return "clipboard";
  } catch {
    // no clipboard API, no permission, or an engine that takes only text
  }
  try {
    download(await png, shotName);
  } catch {
    /* nothing left to try; the report goes without a picture */
  }
  return "file";
}

function download(png: Blob, shotName: string): void {
  const url = URL.createObjectURL(png);
  const a = document.createElement("a");
  a.href = url;
  a.download = shotName;
  a.click();
  // the object URL outlives the click by a beat, or the download never starts
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The issue's title names the room, because that is what makes an issue list
 * readable — half the reports about this port are about one view. It is a first
 * line, not a verdict: the player is looking at it in the form and will say what
 * actually happened.
 */
function title(page: BugReportPage): string {
  const room = page.where().split("·")[0].trim();
  return room ? `Bug in ${room}` : "Bug";
}

/**
 * English, whatever the page is in: the issue is read by whoever fixes it, and
 * the page's own language is the player's. The prose the PLAYER is asked to write
 * is theirs to write in any language they like.
 */
function body(page: BugReportPage): string {
  const log = page.log(LOG_LINES);
  const lines = [
    "### What went wrong",
    "",
    "<!-- What you did, and what the game did instead. Everything below was",
    "     filled in by the Report bug button — edit or delete anything you would",
    "     rather not send. -->",
    "",
    "### Where",
    "",
    `- **Room:** ${page.where() || "—"}`,
    // which build this was, so a fixed bug can be told from a live one
    `- **Port version:** ${page.version}`,
    `- **Edition:** ${page.edition()}`,
    `- **Page:** ${window.location.href}`,
    `- **Browser:** ${navigator.userAgent}`,
    `- **Window:** ${window.innerWidth}x${window.innerHeight} (dpr ${window.devicePixelRatio})`,
    "",
    "### Screenshot",
    "",
    "The screen as it was when the button was pressed is on your clipboard —",
    "paste it here with Ctrl+V (Cmd+V on a Mac). If nothing pastes, your browser",
    "would not take an image, and the same picture was downloaded as a PNG for",
    "you to attach.",
    "",
    "### Last thing the engine said",
    "",
    "```",
    ...(log.length ? log : ["(nothing logged)"]),
    "```",
  ];
  return clamp(lines.join("\n"));
}

/** keep the URL under GitHub's ceiling, and say so rather than truncating in silence */
function clamp(text: string): string {
  if (text.length <= BODY_LIMIT) return text;
  return text.slice(0, BODY_LIMIT - 40) + "\n…(cut to fit the URL)\n```";
}
