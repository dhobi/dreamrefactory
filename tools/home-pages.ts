/**
 * What each game's home page says (tools/vite-home.ts): the facts that were all
 * that differed between six copies of one page. Titanic's front page is its own
 * (taoot/index.html), because it is translated.
 *
 * `playing` and `status` complete the page's one paragraph: "…implemented in
 * JavaScript (TypeScript), playing <playing>. <status>, but it is younger than
 * the original engine by some years."
 */
export interface HomePage {
  /** the folder, which names the mark, logo and icon in `public/` (`<dir>-logo.png`) */
  dir: string;
  /** the name, in bold in the top bar and as the installed app's title */
  name: string;
  /** what follows the name in the top bar: the subtitle, ending in RE */
  subtitle: string;
  /** the page's title and heading, where the subtitle is a tag rather than a name — absent, "<name>: <subtitle>" and the subtitle */
  heading?: string;
  /** the original's year, in the brand's title */
  year: number;
  /** the browser's chrome colour, the theme's deepest */
  themeColor: string;
  /** the logo's own size: `public/<dir>-logo.png` */
  logo: { width: number; height: number };
  playing: string;
  status: string;
  /** a speedrun workbench at speedrun/, which Play then folds in */
  speedrun?: boolean;
  /** more ways in, after Play: Dust's collection page */
  links?: readonly { href: string; text: string; title?: string }[];
}

export const HOME_PAGES: readonly HomePage[] = [
  {
    dir: "dust",
    name: "Dust",
    subtitle: "A Tale of the Wired West RE",
    year: 1995,
    themeColor: "#0a0705",
    logo: { width: 900, height: 332 },
    playing: "their 1995 Western",
    status: "It plays through to the credits",
    speedrun: true,
    links: [{ href: "./collection/", text: "Collection" }],
  },
  {
    dir: "timelapse",
    name: "Timelapse",
    subtitle: "Ancient Civilizations RE",
    year: 1996,
    themeColor: "#04050e",
    logo: { width: 900, height: 378 },
    playing: "GTE Interactive Media's 1996 journey through time, built on that engine",
    status: "It plays through to the end",
    speedrun: true,
  },
  {
    dir: "redjack",
    name: "RedJack",
    subtitle: "Revenge of the Brethren RE",
    year: 1998,
    themeColor: "#070402",
    logo: { width: 900, height: 573 },
    playing: "CyberFlix's last game, the 1998 pirate adventure on the engine's last version",
    status: "It plays all seven days to the end and it saves",
    speedrun: true,
  },
  {
    dir: "lunicus",
    name: "Lunicus",
    subtitle: "RE · DreamFactory 0",
    heading: "Lunicus RE",
    year: 1994,
    themeColor: "#040716",
    logo: { width: 900, height: 789 },
    playing:
      "CyberFlix's first game, which has no scripts at all: the whole of it is in its executable, and it was ported from the disassembly",
    status: "A moon base, six days and the hive at the end; it plays through to the queen, and it saves",
  },
  {
    dir: "jumpraven",
    name: "Jump Raven",
    subtitle: "RE · DreamFactory 0",
    heading: "Jump Raven RE",
    year: 1994,
    themeColor: "#040814",
    logo: { width: 900, height: 614 },
    playing: "CyberFlix's second game, on Lunicus's engine and ported from its executable the same way",
    status:
      "Three days over a drowned New York in a hovercraft; it plays through to the pilot's ending, it saves, and it can play itself",
  },
  {
    dir: "skullcracker",
    name: "Skull Cracker",
    subtitle: "RE — experimental",
    heading: "Skull Cracker RE",
    year: 1996,
    themeColor: "#080202",
    logo: { width: 900, height: 384 },
    playing:
      "CyberFlix's 1996 shooter — the same studio and file formats with no interpreter, its logic read out of the executable rather than scripted in the data",
    status: "The films and the game's own menu play and a level is walkable, so it is an experiment more than a game",
  },
];
