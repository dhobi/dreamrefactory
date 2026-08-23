import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import ByteMap from "./bytemap/ByteMap.vue";

/**
 * The default VitePress theme, plus the one component this doc set needs that
 * markdown cannot express: <ByteMap>, the switchable table/block view of a byte
 * layout (docs/.vitepress/theme/bytemap/).
 *
 * A custom theme is safe alongside `withMermaid`: that plugin registers its
 * <Mermaid> component by transforming vitepress's own client entry
 * (`vitepress/dist/client/app/index.js`), not the theme, so it is unaffected by
 * anything here.
 */
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("ByteMap", ByteMap);
  },
} satisfies Theme;
