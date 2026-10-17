/**
 * The architecture map's data: every source file of the repository, read with
 * the TypeScript compiler, as the docs' architecture map draws it
 * (docs/engine/architecture-map.md, docs/.vitepress/theme/archmap/).
 *
 *   npx tsx tools/archmap.mts            writes docs/.vitepress/theme/archmap/data.json
 *
 * `npm run docs:build` and `docs:dev` run it first, so the map is always the code
 * it is published with; the JSON is not checked in. What it reads:
 *
 *   - a CONTAINER per workspace, and tools/;
 *   - a COMPONENT per folder that holds source (the six locales folders count
 *     as one, chrome/src/locales);
 *   - a FILE's size, its first doc comment, and the files it imports, resolved
 *     through `@dreamfactory/<pkg>/…` and relative paths, and which of those
 *     imports bring in types only;
 *   - a file's top-level SYMBOLS: classes with their public members, what they
 *     extend, and which other classes their fields and constructor parameters
 *     hold; interfaces, enums, exported functions and types.
 *
 * Tests, generated assets, game files and builds are left out. What the parts
 * are, in words, is tools/archmap-notes.ts; this file only counts and connects.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { COMPONENTS, CONTAINERS, EXTERNALS } from "./archmap-notes";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "docs/.vitepress/theme/archmap/data.json");

/** the folders no source of the map is in */
const SKIP_DIR = new Set(["node_modules", "tests", "dist", "public", "gamefiles", "coverage", "assets"]);

/** a folder as the map counts it: the locales' per-language folders are one */
export const componentOf = (path: string): string =>
  path.split("/").slice(0, -1).join("/").replace(/^chrome\/src\/locales\/.*/, "chrome/src/locales");

type SymKind = "class" | "interface" | "function" | "type" | "enum";
/** a member: [name, f(ield) | g(etter) | m(ethod), its type as written, static] */
type Member = [string, "f" | "g" | "m", string, 0 | 1];
/** a top-level symbol, its keys short because there are some three thousand */
export interface MapSymbol {
  k: SymKind;
  n: string;
  ln: number;
  d?: string;
  /** 0 when not exported */
  x?: 0;
  /** what it extends or implements, as `file#Name`, or `?Name` when outside the repo */
  e?: string[];
  /** the classes and interfaces it holds or takes, as `file#Name` */
  r?: string[];
  m?: Member[];
}
export interface MapFile {
  /** its component */
  c: string;
  /** lines */
  l: number;
  /** its first doc comment, cut to a few sentences */
  d: string;
  /** the files it imports */
  i: string[];
  /** those of them it imports types from and nothing else, which never run as an import */
  t?: string[];
  s: MapSymbol[];
}
export interface ArchModel {
  generated: string;
  commit: string;
  files: Record<string, MapFile>;
  components: Record<string, { k: string; f: string[]; l: number }>;
  containers: Record<string, { f: number; l: number; cl: number }>;
  notes: { containers: typeof CONTAINERS; externals: typeof EXTERNALS; components: typeof COMPONENTS };
}

function sources(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) {
        if (!SKIP_DIR.has(n)) walk(p);
      } else if (/\.m?ts$/.test(n) && !n.endsWith(".d.ts") && !/^vite(st)?\b/.test(n)) out.push(p);
    }
  };
  for (const c of Object.keys(CONTAINERS)) {
    const base = join(root, c);
    for (const n of readdirSync(base)) {
      const p = join(base, n);
      if (statSync(p).isDirectory()) {
        if (!SKIP_DIR.has(n)) walk(p);
      } else if (c === "tools" && /\.m?ts$/.test(n)) out.push(p);
    }
  }
  return out;
}

/** the first doc comment of a file (or its leading `//` lines), cut to about 260 characters */
function fileDoc(text: string): string {
  const m = /\/\*\*([\s\S]*?)\*\//.exec(text);
  let s: string;
  if (m && m.index < 4000) s = m[1];
  else {
    const lines: string[] = [];
    for (const l of text.split("\n").slice(0, 30)) {
      if (/^\s*\/\//.test(l)) lines.push(l.replace(/^\s*\/\/\s?/, ""));
      else if (lines.length) break;
    }
    s = lines.join(" ");
  }
  s = s.replace(/^\s*\*\s?/gm, "").replace(/\s+/g, " ").trim();
  let d = "";
  for (const sentence of s.split(/(?<=[.:])\s+(?=[A-Z`])/)) {
    if (`${d} ${sentence}`.length > 260) break;
    d = d ? `${d} ${sentence}` : sentence;
  }
  return d || s.slice(0, 260);
}

/** a declaration's own doc comment, its first sentence */
function symbolDoc(node: ts.Node): string {
  const jd = (node as unknown as { jsDoc?: ts.JSDoc[] }).jsDoc;
  if (!jd?.length) return "";
  const c = jd[0].comment;
  const s = (typeof c === "string" ? c : (c ?? []).map((x) => x.text).join("")).replace(/\s+/g, " ").trim();
  const first = s.split(/(?<=\.)\s+/)[0] ?? "";
  return first.length > 220 ? `${first.slice(0, 217)}…` : first;
}

/** every type name a node mentions, and every class it constructs */
function typeNames(n: ts.Node | undefined, acc: Set<string>): void {
  if (!n) return;
  if (ts.isTypeReferenceNode(n)) acc.add(n.typeName.getText());
  if (ts.isExpressionWithTypeArguments(n)) acc.add(n.expression.getText());
  if (ts.isNewExpression(n)) acc.add(n.expression.getText());
  n.forEachChild((c) => typeNames(c, acc));
}

interface RawSymbol {
  kind: SymKind;
  name: string;
  exported: boolean;
  doc: string;
  extends: string[];
  members: Member[];
  refs: string[];
  line: number;
}

function classSymbol(st: ts.ClassDeclaration, exported: boolean, line: number): RawSymbol {
  const refs = new Set<string>();
  const ext = (st.heritageClauses ?? []).flatMap((h) => h.types.map((t) => t.expression.getText()));
  const members: Member[] = [];
  for (const m of st.members) {
    const mods = ts.getCombinedModifierFlags(m as ts.Declaration);
    if (mods & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) continue;
    if (m.name && ts.isPrivateIdentifier(m.name)) continue;
    const name = m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : null;
    const isStatic: 0 | 1 = mods & ts.ModifierFlags.Static ? 1 : 0;
    if (ts.isPropertyDeclaration(m) && name) {
      typeNames(m.type, refs);
      typeNames(m.initializer, refs);
      members.push([name, "f", m.type ? m.type.getText().replace(/\s+/g, " ").slice(0, 60) : "", isStatic]);
    } else if (ts.isMethodDeclaration(m) && name) members.push([name, "m", "", isStatic]);
    else if (ts.isGetAccessor(m) && name) members.push([name, "g", "", 0]);
    else if (ts.isConstructorDeclaration(m)) for (const p of m.parameters) typeNames(p.type, refs);
  }
  return { kind: "class", name: st.name!.text, exported, doc: symbolDoc(st), extends: ext, members, refs: [...refs], line };
}

function symbolsOf(sf: ts.SourceFile): RawSymbol[] {
  const out: RawSymbol[] = [];
  const exported = (n: ts.Node): boolean => !!(ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export);
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const plain = (kind: SymKind, name: string, n: ts.Node): RawSymbol =>
    ({ kind, name, exported: exported(n), doc: symbolDoc(n), extends: [], members: [], refs: [], line: lineOf(n) });
  for (const st of sf.statements) {
    if (ts.isClassDeclaration(st) && st.name) out.push(classSymbol(st, exported(st), lineOf(st)));
    else if (ts.isInterfaceDeclaration(st)) {
      const refs = new Set<string>();
      for (const m of st.members) typeNames((m as ts.PropertySignature).type, refs);
      const members: Member[] = st.members
        .filter((m) => m.name && ts.isIdentifier(m.name))
        .slice(0, 40)
        .map((m) => [(m.name as ts.Identifier).text, ts.isMethodSignature(m) ? "m" : "f", "", 0]);
      const ext = (st.heritageClauses ?? []).flatMap((h) => h.types.map((t) => t.expression.getText()));
      out.push({ ...plain("interface", st.name.text, st), extends: ext, members, refs: [...refs] });
    } else if (ts.isFunctionDeclaration(st) && st.name && exported(st)) out.push(plain("function", st.name.text, st));
    else if (ts.isEnumDeclaration(st)) out.push(plain("enum", st.name.text, st));
    else if (ts.isTypeAliasDeclaration(st) && exported(st)) out.push(plain("type", st.name.text, st));
  }
  return out;
}

/** the git commit the map is read from, or "working tree" outside a checkout */
function commitOf(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "working tree";
  }
}

/** `import type …`, `export type …`, or a list of names that are all `type` ones: gone once compiled */
function typeOnly(st: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(st)) {
    const c = st.exportClause;
    return st.isTypeOnly || (!!c && ts.isNamedExports(c) && c.elements.length > 0 && c.elements.every((e) => e.isTypeOnly));
  }
  const c = st.importClause;
  if (!c) return false;
  if (c.isTypeOnly) return true;
  const b = c.namedBindings;
  return !c.name && !!b && ts.isNamedImports(b) && b.elements.length > 0 && b.elements.every((e) => e.isTypeOnly);
}

/** the repository files a file imports, sorted, and those of them it takes types from and nothing else */
function importsOf(sf: ts.SourceFile, self: string, resolveSpec: (spec: string) => string | null): { imports: string[]; types: string[] } {
  const all = new Set<string>();
  const values = new Set<string>();
  for (const st of sf.statements) {
    if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const t = resolveSpec(st.moduleSpecifier.text);
    if (!t || t === self) continue;
    all.add(t);
    if (!typeOnly(st)) values.add(t);
  }
  const imports = [...all].sort();
  return { imports, types: imports.filter((t) => !values.has(t)) };
}

export function buildModel(root: string = ROOT): ArchModel {
  const abs = sources(root);
  const rel = (p: string): string => relative(root, p).split(sep).join("/");
  const known = new Set(abs.map(rel));
  const resolveImport = (from: string, spec: string): string | null => {
    let target: string;
    const pkg = /^@dreamfactory\/([a-z]+)\/(.*)$/.exec(spec);
    if (pkg) target = `${pkg[1]}/src/${pkg[2]}`;
    else if (spec.startsWith(".")) target = rel(resolve(dirname(join(root, from)), spec));
    else return null;
    target = target.replace(/\.m?[jt]s$/, "");
    return [`${target}.ts`, `${target}.mts`, `${target}/index.ts`].find((c) => known.has(c)) ?? null;
  };

  const raw = new Map<string, { lines: number; doc: string; imports: string[]; types: string[]; symbols: RawSymbol[] }>();
  for (const p of abs) {
    const r = rel(p);
    const text = readFileSync(p, "utf8");
    const sf = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
    const { imports, types } = importsOf(sf, r, (spec) => resolveImport(r, spec));
    raw.set(r, { lines: text.split("\n").length, doc: fileDoc(text), imports, types, symbols: symbolsOf(sf) });
  }

  // a name used in a file is the symbol of that name in the file itself, else in
  // a file it imports, else the only one of that name anywhere
  const byName = new Map<string, string[]>();
  for (const [p, f] of raw) for (const s of f.symbols) byName.set(s.name, [...(byName.get(s.name) ?? []), `${p}#${s.name}`]);
  const resolveName = (file: string, imports: string[], name: string): string | null => {
    const cands = byName.get(name.split(".").pop()!.replace(/<.*/, ""));
    if (!cands) return null;
    return cands.find((c) => c.startsWith(`${file}#`)) ?? cands.find((c) => imports.includes(c.split("#")[0])) ?? (cands.length === 1 ? cands[0] : null);
  };

  const model: ArchModel = {
    generated: new Date().toISOString().slice(0, 10),
    commit: commitOf(root),
    files: {},
    components: {},
    containers: {},
    notes: { containers: CONTAINERS, externals: EXTERNALS, components: COMPONENTS },
  };
  for (const [p, f] of raw) {
    const c = componentOf(p);
    const s: MapSymbol[] = f.symbols.map((sym) => {
      const own = `${p}#${sym.name}`;
      const o: MapSymbol = { k: sym.kind, n: sym.name, ln: sym.line };
      if (sym.doc) o.d = sym.doc;
      if (!sym.exported) o.x = 0;
      const ext = sym.extends.map((e) => resolveName(p, f.imports, e) ?? `?${e}`);
      if (ext.length) o.e = ext;
      const refs = [...new Set(sym.refs.map((r) => resolveName(p, f.imports, r)))].filter((r): r is string => !!r && r !== own && !ext.includes(r));
      if (refs.length) o.r = refs;
      if (sym.members.length) o.m = sym.members;
      return o;
    });
    model.files[p] = { c, l: f.lines, d: f.doc, i: f.imports, s };
    if (f.types.length) model.files[p].t = f.types;
    const comp = (model.components[c] ??= { k: p.split("/")[0], f: [], l: 0 });
    comp.f.push(p);
    comp.l += f.lines;
    const cont = (model.containers[comp.k] ??= { f: 0, l: 0, cl: 0 });
    cont.f++;
    cont.l += f.lines;
    cont.cl += s.filter((x) => x.k === "class").length;
  }
  return model;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const model = buildModel();
  const missing = Object.keys(model.components).filter((c) => !COMPONENTS[c]);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(model));
  console.log(
    `archmap: ${Object.keys(model.files).length} files in ${Object.keys(model.components).length} folders, read from ${model.commit}` +
      (missing.length ? ` · no description in tools/archmap-notes.ts for ${missing.join(", ")}` : ""),
  );
  if (!existsSync(OUT)) process.exit(1);
}
