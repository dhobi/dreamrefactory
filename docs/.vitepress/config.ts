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
    head: [["link", { rel: "icon", type: "image/png", href: `${base}globe.png` }]],

    themeConfig: {
      // Nav-bar logo (base-prefixed automatically by the theme). Lives in
      // docs/public/, so it's served from the site root.
      logo: "/globe.png",

      nav: [
        { text: "Home", link: "/" },
        { text: "Concepts", link: "/01-how-the-game-works" },
        { text: "File formats", link: "/formats/" },
        { text: "GitHub", link: "https://github.com/dhobi/taoot-web" },
      ],

      sidebar: [
        {
          text: "Start here",
          items: [{ text: "Documentation home", link: "/" }],
        },
        {
          text: "Concepts — how it works",
          collapsed: false,
          items: [
            { text: "How the game works", link: "/01-how-the-game-works" },
            { text: "Engine architecture", link: "/02-engine-architecture" },
            { text: "The scripting language", link: "/03-scripting-language" },
          ],
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
