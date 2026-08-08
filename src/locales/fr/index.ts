/**
 * French. The words are in the JSON files beside this one so that a
 * translator, a machine-translation pass or a TMS can read and return them
 * without touching TypeScript; this module's only job is to assemble them and
 * hold them to {@link Catalogue}, which turns a missing key into a compile
 * error. tests/auto/locales.ts covers what a type cannot see: an extra key, an
 * empty value, a tag outside the allowlist, a mangled link.
 */
import type { Catalogue } from "../en";
import common from "./common.json";
import counts from "./counts.json";
import site from "./site.json";
import home from "./home.json";
import play from "./play.json";
import collection from "./collection.json";
import editors from "./editors.json";
import puppets from "./puppets.json";
import casts from "./casts.json";
import sets from "./sets.json";
import shops from "./shops.json";
import stages from "./stages.json";
import movies from "./movies.json";
import tracks from "./tracks.json";

const fr: Catalogue = { common, counts, site, home, play, collection, editors, puppets, casts, sets, shops, stages, movies, tracks };
export default fr;
