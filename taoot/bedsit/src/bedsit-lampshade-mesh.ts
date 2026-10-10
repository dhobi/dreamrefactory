/**
 * lampshade: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, at the file's own coordinates taken as metres at 1549.375 units to one.
 *
 * 96 triangles, 96 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

import { indices, positions } from "./bedsit-mesh-decode";

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-517.5, -517.5, 2527.0] as const,
  hi: [517.5, 517.5, 2979.4] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "//8AgAAA5/61kAAAUZgzg///hpgAgP//ovsgoQAAsJdZhv//Qfb7sAAAqJZiif//2e7/vwAAPZVDjP//jOXrzQAAdZPujv//gtqC2gAAV5FXkf//682M5QAA7o51k////7/Z7gAAQ4w9lf//+7BB9gAAYomolv//IKGi+wAAWYawl///tZDn/gAAM4NRmP//AID//wAAAICGmP//Sm/n/gAAzHxRmP//316i+wAApnmwl///BE9B9gAAnXaolv//AEDZ7gAAvHM9lf//FDKM5QAAEXF1k///fSWC2gAAqG5Xkf//cxrrzQAAimzujv//JhH/vwAAwmpDjP//vgn7sAAAV2liif//XQQgoQAAT2hZhv//GAG1kAAArmczg///AAAAgAAAeWcAgP//GAFKbwAArmfMfP//XQTfXgAAT2imef//vgkETwAAV2mddv//JhEAQAAAwmq8c///cxoUMgAAimwRcf//fSV9JQAAqG6obv//FDJzGgAAEXGKbP//AEAmEQAAvHPCav//BE++CQAAnXZXaf//315dBAAApnlPaP//Sm8YAQAAzHyuZ////38AAAAAAIB5Z///tZAYAQAAM4OuZ///IKFdBAAAWYZPaP//+7C+CQAAYolXaf///78mEQAAQ4zCav//681zGgAA7o6KbP//gtp9JQAAV5Gobv//jOUUMgAAdZMRcf//2e4AQAAAPZW8c///QfYETwAAqJaddv//ovvfXgAAsJemef//5/5KbwAAUZjMfP//";
const INDEX = "AAABAAIAAAACAAMAAQAEAAUAAQAFAAIABAAGAAcABAAHAAUABgAIAAkABgAJAAcACAAKAAsACAALAAkACgAMAA0ACgANAAsADAAOAA8ADAAPAA0ADgAQABEADgARAA8AEAASABMAEAATABEAEgAUABUAEgAVABMAFAAWABcAFAAXABUAFgAYABkAFgAZABcAGAAaABsAGAAbABkAGgAcAB0AGgAdABsAHAAeAB8AHAAfAB0AHgAgACEAHgAhAB8AIAAiACMAIAAjACEAIgAkACUAIgAlACMAJAAmACcAJAAnACUAJgAoACkAJgApACcAKAAqACsAKAArACkAKgAsAC0AKgAtACsALAAuAC8ALAAvAC0ALgAwADEALgAxAC8AMAAyADMAMAAzADEAMgA0ADUAMgA1ADMANAA2ADcANAA3ADUANgA4ADkANgA5ADcAOAA6ADsAOAA7ADkAOgA8AD0AOgA9ADsAPAA+AD8APAA/AD0APgBAAEEAPgBBAD8AQABCAEMAQABDAEEAQgBEAEUAQgBFAEMARABGAEcARABHAEUARgBIAEkARgBJAEcASABKAEsASABLAEkASgBMAE0ASgBNAEsATABOAE8ATABPAE0ATgBQAFEATgBRAE8AUABSAFMAUABTAFEAUgBUAFUAUgBVAFMAVABWAFcAVABXAFUAVgBYAFkAVgBZAFcAWABaAFsAWABbAFkAWgBcAF0AWgBdAFsAXABeAF8AXABfAF0AXgAAAAMAXgADAF8A";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);
