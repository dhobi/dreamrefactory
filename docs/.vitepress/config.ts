import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

// Served from https://www.danielhobi.ch/dreamrefactory/docs/ — hence the base
// path, and unlike the three game/site builds this one cannot be relative:
// VitePress needs an absolute base for its router and its hydration. So this is
// the ONE place in the repository that knows the deployment's URL.
//
// It is under /docs/ rather than at the root because a VitePress site owns its
// whole route namespace, and this doc set already has an `editors/` section that
// would land exactly on top of the editors application (.github/workflows/
// docs.yml says the same). It was a GitHub Pages project site at
// dhobi.github.io/taoot-web/ until the site moved.
const base = "/dreamrefactory/docs/";

// The doc set uses README.md as the "index" of each folder (GitHub
// convention). VitePress serves directory roots from index.md, so remap.
const rewrites = {
  "README.md": "index.md",
  "engine/README.md": "engine/index.md",
  "engine/formats/README.md": "engine/formats/index.md",
  "engine/runtime/README.md": "engine/runtime/index.md",
  "taoot/README.md": "taoot/index.md",
  "dust/README.md": "dust/index.md",
  "editors/README.md": "editors/index.md",
  "reference/README.md": "reference/index.md",
};

export default withMermaid(
  defineConfig({
    base,
    rewrites,
    lang: "en-US",
    title: "dreamREfactory",
    description:
      "How CyberFlix's DreamFactory engine works, and how this project reimplemented it — from a game's main flow down to each DFile container format. Titanic (DreamFactory 4) and Dust (DreamFactory 1).",
    lastUpdated: true,
    /**
     * FALSE, and it has to be. `cleanUrls` emits links without `.html` and relies
     * on the SERVER to resolve `/docs/glossary` to `glossary.html` — which GitHub
     * Pages does and a plain Apache host does not. The first deploy to the new
     * home returned 404 for every page that is not a directory index; only the
     * `.html` form answered.
     *
     * The premise of this whole deployment is that it needs nothing but a file
     * server, so the links carry the extension rather than the host carrying a
     * rewrite rule.
     */
    cleanUrls: false,
    ignoreDeadLinks: false,

    // Favicon. head[].href is NOT base-prefixed automatically, so include it.
    // The shadowless mark, not globe.png: at 16px the cast shadow is a blue
    // smudge under a shrunken sphere. The full logo stays on the home page.
    head: [
      ["link", { rel: "icon", type: "image/svg+xml", href: `${base}globe-mark.svg` }],
    ],

    themeConfig: {
      // Nav-bar logo (base-prefixed automatically by the theme). Lives in
      // docs/public/, so it's served from the site root. Shadowless, like the
      // favicon — the theme gives it 24px.
      logo: "/globe-mark.svg",

      // The nav bar's title slot is the sidebar's width and no wider — the theme
      // sets `.VPNavBarTitle` to `--vp-sidebar-width` (272px) less its padding, so
      // the link gets 208px whatever the viewport. The full title wants 312px and
      // ran straight into the search box. So the bar gets the short name and the
      // `title` above stays the real one, which is what the tab and the search
      // index show.
      siteTitle: "dreamREfactory",

      nav: [
        { text: "Home", link: "/" },
        { text: "Engine", link: "/engine/" },
        // oldest engine first, as the sidebar and the registry have it
        { text: "Dust", link: "/dust/" },
        { text: "Titanic", link: "/taoot/" },
        { text: "Editors", link: "/editors/" },
        { text: "Glossary", link: "/glossary" },
        // Points at the section index rather than a page inside it, like every
        // other nav entry — the index is what lists the glossary and the rest.
        { text: "Reference", link: "/reference/" },
        { text: "GitHub", link: "https://github.com/dhobi/dreamrefactory" },
      ],

      /**
       * Four sections, mirroring the repository: the engine, each game, and the
       * project's own tooling and reference.
       *
       * "Start here" is a READING PATH and not a section — its four pages live in
       * three different sections, and the order is general to specific: what kind
       * of game this engine makes, how the engine is arranged, and then each game
       * that runs on it. They used to carry `01-`…`04-` filename prefixes to say
       * so, which stopped working the moment they no longer shared a directory. A
       * sidebar can express a path across sections; a filename cannot.
       *
       * The two games come oldest first — DreamFactory 1 before 4 — which is the
       * order `GAMES` lists them in (site/src/games.ts), the order the format
       * pages introduce the two generations in, and the order that makes the pair
       * read as a progression rather than an arbitrary couple. Dust is also the
       * smaller door: one page and one disc, where Titanic is six editions and a
       * timed endgame.
       *
       * The scripting language leaves the path and stays in "The engine". It is
       * the right third step for someone implementing the engine and the wrong
       * one for someone finding their way in — a grammar before either game has
       * been introduced.
       */
      sidebar: [
        {
          text: "Start here",
          items: [
            { text: "Documentation home", link: "/" },
            { text: "1 · How a DreamFactory game works", link: "/engine/how-a-game-works" },
            { text: "2 · Engine architecture", link: "/engine/architecture" },
            { text: "3 · Dust: A Tale of the Wired West", link: "/dust/" },
            { text: "4 · Titanic: Adventure Out of Time", link: "/taoot/" },
            { text: "Glossary", link: "/glossary" },
          ],
        },
        {
          text: "The engine",
          collapsed: false,
          items: [
            { text: "Overview", link: "/engine/" },
            { text: "How a DreamFactory game works", link: "/engine/how-a-game-works" },
            { text: "Engine architecture", link: "/engine/architecture" },
            { text: "The scripting language", link: "/engine/scripting-language" },
          ],
        },
        {
          text: "File formats — DFile containers",
          collapsed: false,
          items: [
            { text: "The DFile container format", link: "/engine/formats/" },
            { text: "The image codec", link: "/engine/formats/image-codec" },
            { text: "SET — rooms, scenes & views", link: "/engine/formats/set" },
            { text: "SHP — props", link: "/engine/formats/shp" },
            { text: "MOV — movies & close-ups", link: "/engine/formats/mov" },
            { text: "STG — stage files & UI", link: "/engine/formats/stg" },
            { text: "Audio — TRK / SFX / 11K / SND", link: "/engine/formats/audio" },
            { text: "BOOTFILE — startup & library", link: "/engine/formats/bootfile" },
            { text: "The script container on disk", link: "/engine/formats/script-container" },
            { text: "PUP & CST — characters", link: "/engine/formats/pup-cst" },
            { text: "Saved games (.ti)", link: "/engine/formats/savegame" },
            { text: "Saved games, DF1 (.rtd)", link: "/engine/formats/savegame-v1" },
          ],
        },
        {
          text: "Runtime — how the port plays it",
          collapsed: false,
          items: [
            { text: "Overview", link: "/engine/runtime/" },
            { text: "Timing — heartbeat, loops & crickets", link: "/engine/runtime/timing" },
            { text: "Stage & UI — flats & overlays", link: "/engine/runtime/stage-ui" },
            { text: "Characters — actors & puppets", link: "/engine/runtime/characters" },
            { text: "Audio — channels & volumes", link: "/engine/runtime/audio" },
            { text: "Saving & loading", link: "/engine/runtime/saves" },
            { text: "The browser host", link: "/engine/runtime/host" },
          ],
        },
        {
          text: "Dust: A Tale of the Wired West",
          collapsed: false,
          items: [
            { text: "Overview", link: "/dust/" },
            { text: "Music & sound — the 40 banks", link: "/dust/audio" },
          ],
        },
        {
          text: "Titanic: Adventure Out of Time",
          collapsed: false,
          items: [
            { text: "Overview", link: "/taoot/" },
            { text: "The mission flow", link: "/taoot/mission-flow" },
            { text: "The sinking — mission 4's clock", link: "/taoot/sinking" },
            { text: "Languages & the chooser", link: "/taoot/languages" },
            // The engine only offers `lowmemory()` and `heapsize()`; BOOTFILE
            // shadows the first and every branch is in this game's scripts.
            // Titanic's data names it in 112 files, Dust's in none.
            { text: "The low-memory game", link: "/taoot/low-memory" },
            // "How was this checked?" is a headline question for a
            // reverse-engineering project, not lookup material — so it sits with
            // the game it was checked against rather than in Reference.
            { text: "How we know it's right", link: "/taoot/verification" },
          ],
        },
        {
          text: "Editors — the browser tools",
          collapsed: true,
          items: [
            { text: "Overview", link: "/editors/" },
            { text: "The set editor", link: "/editors/sets" },
            { text: "The shop editor", link: "/editors/shops" },
            { text: "The movie editor", link: "/editors/movies" },
            { text: "The stage editor", link: "/editors/stages" },
            { text: "The track editor", link: "/editors/tracks" },
            { text: "The puppet editor", link: "/editors/puppets" },
            { text: "The cast editor", link: "/editors/casts" },
          ],
        },
        {
          text: "Reference",
          collapsed: true,
          items: [
            { text: "Overview", link: "/reference/" },
            { text: "Glossary", link: "/glossary" },
            { text: "Builtin commands", link: "/reference/builtins" },
            { text: "Tools", link: "/reference/tools" },
            { text: "Tests — the inventory", link: "/reference/tests" },
            { text: "Continuous integration", link: "/reference/ci" },
            { text: "Releasing and deploying", link: "/reference/deploy" },
            { text: "The route", link: "/reference/route" },
          ],
        },
      ],

      socialLinks: [{ icon: "github", link: "https://github.com/dhobi/dreamrefactory" }],

      search: { provider: "local" },

      editLink: {
        pattern: "https://github.com/dhobi/dreamrefactory/edit/master/docs/:path",
        text: "Edit this page on GitHub",
      },

      footer: {
        message:
          "Docs licensed GPL-3.0 (the decoder is ported from DFET). Game data © CyberFlix — not included.",
        copyright: "Reverse-engineering credit: M3tox (DFET) and MRXstudios.",
      },
    },
  }),
);
