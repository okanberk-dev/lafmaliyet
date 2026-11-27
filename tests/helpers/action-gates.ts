// Sunucu eylemlerinin yetki kapıları (docs/ROLLER.md; tests/roller.test.ts): her "use server" dosyasının dışa verdiği her
// eylem gövdesinde hangi kapıyı çağırıyor. Tarama TypeScript'in ayrıştırıcısıyla (tür denetimi yok): dışa verilen
// `async function` ya da `const x = async (…) =>` bildirimlerinin gövdesi okunur; gövdenin çağırdığı aynı dosyadaki
// yardımcıların gövdeleri de (bir kat) sayılır.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";

/** Kapılar: requireAdmin, requireUser, requireSignedIn, requireCan("…"), requireRole("…", …) */
export interface Gate {
  kind: "requireAdmin" | "requireUser" | "requireSignedIn" | "requireCan" | "requireRole";
  /** requireCan'ın yeteneği ya da requireRole'ün rolleri */
  args: string[];
}

export interface ActionGates {
  file: string;
  name: string;
  gates: Gate[];
}

const GATE_NAMES = new Set(["requireAdmin", "requireAnaAdmin", "requireUser", "requireSignedIn", "requireCan", "requireRole"]);
/** requireAnaAdmin önce requireAdmin'den geçer (src/server/auth/dal.ts; ana yönetici şube ekler): kapı olarak yönetici */
const GATE_ALIAS: Record<string, Gate["kind"]> = { requireAnaAdmin: "requireAdmin" };

function walk(root: string, dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(join(root, p)).isDirectory() ? walk(root, p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

/** Proje kökünden "use server" ile başlayan dosyalar (sunucu eylemi dosyaları) */
export function serverActionFiles(root: string): string[] {
  return walk(root, "src").filter((f) => /^\s*(\/\/[^\n]*\n\s*)*["']use server["']/.test(readFileSync(join(root, f), "utf8")));
}

function gatesIn(node: ts.Node, sf: ts.SourceFile): Gate[] {
  const out: Gate[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && GATE_NAMES.has(n.expression.text)) {
      out.push({ kind: GATE_ALIAS[n.expression.text] ?? (n.expression.text as Gate["kind"]), args: n.arguments.map((a) => (ts.isStringLiteral(a) ? a.text : a.getText(sf))) });
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** Aynı dosyadaki adlı fonksiyonların gövdeleri (yardımcılar) */
function localFunctions(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) out.set(st.name.text, st.body);
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) out.set(d.name.text, d.initializer.body);
      }
  }
  return out;
}

function calledNames(node: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) out.add(n.expression.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** Bir "use server" dosyasının dışa verdiği eylemler ve kapıları */
export function actionGatesOf(root: string, file: string): ActionGates[] {
  const text = readFileSync(join(root, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const helpers = localFunctions(sf);
  const out: ActionGates[] = [];
  const add = (name: string, body: ts.Node) => {
    const gates = gatesIn(body, sf);
    for (const called of calledNames(body)) {
      const h = helpers.get(called);
      if (h && h !== body) gates.push(...gatesIn(h, sf));
    }
    out.push({ file: relative(root, join(root, file)), name, gates });
  };
  for (const st of sf.statements) {
    const exported = ts.getModifiers(st as ts.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(st) && st.name && st.body) add(st.name.text, st.body);
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) add(d.name.text, d.initializer.body);
      }
  }
  return out;
}

/** Bütün sunucu eylemleri ve kapıları */
export function allActionGates(root: string): ActionGates[] {
  return serverActionFiles(root).flatMap((f) => actionGatesOf(root, f));
}
