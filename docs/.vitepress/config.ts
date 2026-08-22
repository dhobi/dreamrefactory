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
    title: "Titanic: Adventure Out of Time (RE)",
    description:
      "How Titanic: Adventure Out of Time and the CyberFlix DreamFactory 4.0 engine work — a guided tour from the game's main flow down to each DFile container format.",
    lastUpdated: true,
    cleanUrls: true,
    ignoreDeadLinks: false,

    // Favicon. head[].href is NOT base-prefixed automatically, so include it.
    // The shadowless mark, not globe.png: at 16px the cast shadow is a blue
    // smudge under a shrunken sphere. The full logo stays on the home page.
    head: [
      ["link", { rel: "icon", type: "image/png", href: `${base}globe-mark.png` }],
    ],

    themeConfig: {
      // Nav-bar logo (base-prefixed automatically by the theme). Lives in
      // docs/public/, so it's served from the site root. Shadowless, like the
      // favicon — the theme gives it 24px.
      logo: "/globe-mark.png",

      // The nav bar's title slot is the sidebar's width and no wider — the theme
      // sets `.VPNavBarTitle` to `--vp-sidebar-width` (272px) less its padding, so
      // the link gets 208px whatever the viewport. The full title wants 312px and
      // ran straight into the search box. So the bar gets the short name and the
      // `title` above stays the real one, which is what the tab and the search
      // index show.
      siteTitle: "TAOOT (RE)",

      nav: [
        { text: "Home", link: "/" },
        { text: "Engine", link: "/engine/" },
        { text: "Titanic", link: "/taoot/" },
        { text: "Dust", link: "/dust/" },
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
       * "Start here" is a READING PATH and not a section — the four pages it
       * lists live in three different sections, and the order they are in is the
       * order they were written to be read: what the game is, how the engine that
       * runs it is arranged, the language its logic is written in, and how the
       * story is gated. They used to carry `01-`…`04-` filename prefixes to say
       * so, which stopped working the moment two of them belonged to the engine
       * and two to the game. A sidebar can express a path across sections; a
       * filename cannot.
       */
      sidebar: [
        {
          text: "Start here",
          items: [
            { text: "Documentation home", link: "/" },
            { text: "1 · How the game works", link: "/taoot/how-the-game-works" },
            { text: "2 · Engine architecture", link: "/engine/architecture" },
            { text: "3 · The scripting language", link: "/engine/scripting-language" },
            { text: "4 · The mission flow", link: "/taoot/mission-flow" },
            { text: "Glossary", link: "/glossary" },
          ],
        },
        {
          text: "The engine",
          collapsed: false,
          items: [
            { text: "Overview", link: "/engine/" },
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
            { text: "The low-memory game", link: "/engine/runtime/low-memory" },
          ],
        },
        {
          text: "Titanic: Adventure Out of Time",
          collapsed: false,
          items: [
            { text: "Overview", link: "/taoot/" },
            { text: "How the game works", link: "/taoot/how-the-game-works" },
            { text: "The mission flow", link: "/taoot/mission-flow" },
            { text: "The sinking — mission 4's clock", link: "/taoot/sinking" },
            { text: "Languages & the chooser", link: "/taoot/languages" },
            // "How was this checked?" is a headline question for a
            // reverse-engineering project, not lookup material — so it sits with
            // the game it was checked against rather than in Reference.
            { text: "How we know it's right", link: "/taoot/verification" },
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
