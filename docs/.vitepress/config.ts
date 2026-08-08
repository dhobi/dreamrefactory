import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

// The docs are hosted as a GitHub Pages *project* site, served from
// https://dhobi.github.io/taoot-web/ — hence the base path. If this ever
// moves to a custom domain or a user/org site, set base back to "/".
const base = "/taoot-web/";

// The doc set uses README.md as the "index" of each folder (GitHub
// convention). VitePress serves directory roots from index.md, so remap.
const rewrites = {
  "README.md": "index.md",
  "formats/README.md": "formats/index.md",
  "runtime/README.md": "runtime/index.md",
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
        { text: "Concepts", link: "/01-how-the-game-works" },
        { text: "File formats", link: "/formats/" },
        { text: "Runtime", link: "/runtime/" },
        { text: "Editors", link: "/editors/" },
        { text: "Glossary", link: "/glossary" },
        // Points at the section index rather than a page inside it, like every
        // other nav entry — the index is what lists the glossary and the rest.
        { text: "Reference", link: "/reference/" },
        { text: "GitHub", link: "https://github.com/dhobi/taoot-web" },
      ],

      sidebar: [
        {
          text: "Start here",
          items: [
            { text: "Documentation home", link: "/" },
            { text: "Glossary", link: "/glossary" },
          ],
        },
        {
          text: "Concepts — how it works",
          collapsed: false,
          items: [
            { text: "How the game works", link: "/01-how-the-game-works" },
            { text: "Engine architecture", link: "/02-engine-architecture" },
            { text: "The scripting language", link: "/03-scripting-language" },
            { text: "The mission flow", link: "/04-mission-flow" },
          ],
        },
        {
          // Its own group rather than a page inside Reference: "how was this
          // checked?" is a headline question for a reverse-engineering project,
          // not lookup material.
          text: "Verification",
          collapsed: false,
          items: [{ text: "How we know it's right", link: "/verification" }],
        },
        {
          text: "File formats — DFile containers",
          collapsed: false,
          items: [
            { text: "The DFile container format", link: "/formats/" },
            { text: "The image codec", link: "/formats/image-codec" },
            { text: "SET — rooms, scenes & views", link: "/formats/set" },
            { text: "SHP — props", link: "/formats/shp" },
            { text: "MOV — movies & close-ups", link: "/formats/mov" },
            { text: "STG — stage files & UI", link: "/formats/stg" },
            { text: "Audio — TRK / SFX / 11K / SND", link: "/formats/audio" },
            { text: "BOOTFILE — startup & library", link: "/formats/bootfile" },
            { text: "The script container on disk", link: "/formats/script-container" },
            { text: "PUP & CST — characters", link: "/formats/pup-cst" },
            { text: "Saved games (.ti)", link: "/formats/savegame" },
          ],
        },
        {
          text: "Runtime — how the port plays it",
          collapsed: false,
          items: [
            { text: "Overview", link: "/runtime/" },
            { text: "Timing — heartbeat, loops & crickets", link: "/runtime/timing" },
            { text: "Stage & UI — flats & overlays", link: "/runtime/stage-ui" },
            { text: "Characters — actors & puppets", link: "/runtime/characters" },
            { text: "Audio — channels & volumes", link: "/runtime/audio" },
            { text: "Saving & loading", link: "/runtime/saves" },
            { text: "The browser host", link: "/runtime/host" },
            { text: "Languages & the chooser", link: "/runtime/languages" },
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

      socialLinks: [{ icon: "github", link: "https://github.com/dhobi/taoot-web" }],

      search: { provider: "local" },

      editLink: {
        pattern: "https://github.com/dhobi/taoot-web/edit/master/docs/:path",
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
