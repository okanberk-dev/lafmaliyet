// Eylem hatası bekçisi (denetim E-51): istemcide çağrılan her sunucu eyleminin reddi (ağ kesildi, sunucuya ulaşılamadı,
// panel yeniden yayınlandı) bir yerde yakalanmalı; yoksa düğme kilitli kalır, iyimser değişiklik sessizce döner ya da
// sayfa hata ekranına düşer (React 19 geçişin içindeki hatayı en yakın hata sınırına atar).
//
// Tarama sözdizimi ağacı üstünde (TypeScript derleyicisinin ayrıştırıcısı ve ad çözümü; tür denetimi yok): "use client"
// dosyalarında `@/server/actions/*`ten ya da başka bir "use server" dosyasından (ör. ./actions) alınan her adın her
// kullanımı izlenir. Sözün reddi şu yollardan biriyle
// yakalanmış sayılır:
//
// - `try { … } catch` içinde beklenir (`await`), ya da zincirinde `.catch(…)` / iki bağımsız değişkenli `.then` vardır;
// - içinde bulunduğu fonksiyonun sonucu yakalanmış bir yere gider: useActionTransition'ın başlatıcısı
//   (src/components/ui/action-error.ts), kendisi yakalayan yerel bir sarmalayıcı (ör. `start(key, run)` içinde
//   `try { await run() } catch`), kendisi yakalayan bir bileşenin özelliği (ör. ConfirmPasswordDialog'un `onConfirm`'ü)
//   ya da yakalanmış bir çağrı (`await save()` try içinde).
//
// Yakalanmamış sayılanlar: React'in çıplak startTransition'ı ya da useTransition'ı, olay özellikleri (`onClick`,
// `<form action>`), useEffect, zamanlayıcılar, bildirim düğmeleri (`toast(…, { action: { onClick } })`), `void x()` ve
// beklenmeyen çağrılar. Çözülemeyen her yol yakalanmamış sayılır (bekçi kuşkuda uyarır).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";

export interface Unhandled {
  file: string;
  line: number;
  /** Eylemin adı */
  action: string;
  /** Yakalanmadığı yer: yolun son halkası */
  why: string;
}

const ACTIONS_PREFIX = "@/server/actions";
const SAFE_WRAPPER_HOOK = "useActionTransition";
/** Bu çağrılara verilen fonksiyonun hatası kimseye dönmez */
const LOGICAL = new Set([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken]);
const DROPPING_CALLS = new Set(["useEffect", "useLayoutEffect", "setTimeout", "setInterval", "queueMicrotask", "requestAnimationFrame"]);

function walk(root: string, dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(join(root, p)).isDirectory() ? walk(root, p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

type Fn = ts.FunctionLikeDeclaration;

export function scanActionErrors(root: string): { files: string[]; unhandled: Unhandled[] } {
  const all = walk(root, "src");
  const program = ts.createProgram(
    all.map((f) => join(root, f)),
    { noResolve: true, noLib: true, types: [], jsx: ts.JsxEmit.Preserve, allowJs: false, noEmit: true, target: ts.ScriptTarget.Latest },
  );
  const checker = program.getTypeChecker();
  const sourceOf = (abs: string) => program.getSourceFile(abs);

  // Dosya başına: ad → kullanımları (aynı sembol)
  const refsCache = new Map<ts.SourceFile, Map<ts.Symbol, ts.Identifier[]>>();
  function refsIn(sf: ts.SourceFile): Map<ts.Symbol, ts.Identifier[]> {
    let m = refsCache.get(sf);
    if (m) return m;
    m = new Map();
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n)) {
        const sym = checker.getSymbolAtLocation(n);
        if (sym) {
          const list = m!.get(sym) ?? [];
          list.push(n);
          m!.set(sym, list);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    refsCache.set(sf, m);
    return m;
  }
  /** Bildirimin adı dışındaki kullanımlar */
  function usesOf(name: ts.Identifier): ts.Identifier[] {
    const sym = checker.getSymbolAtLocation(name);
    if (!sym) return [];
    return (refsIn(name.getSourceFile()).get(sym) ?? []).filter((r) => r !== name);
  }

  const isClient = (sf: ts.SourceFile) => sf.statements[0] && ts.isExpressionStatement(sf.statements[0]) && ts.isStringLiteral(sf.statements[0].expression) && sf.statements[0].expression.text === "use client";

  // useActionTransition'dan gelen başlatıcıların sembolleri
  const safeRunners = new Set<ts.Symbol>();
  // React'in startTransition'ı (içe aktarılan ya da useTransition'dan gelen)
  const reactStarts = new Set<ts.Symbol>();
  for (const sf of program.getSourceFiles()) {
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.initializer && ts.isCallExpression(n.initializer) && ts.isIdentifier(n.initializer.expression)) {
        const el = n.name.elements[1];
        const callee = n.initializer.expression.text;
        if (el && ts.isBindingElement(el) && ts.isIdentifier(el.name)) {
          const sym = checker.getSymbolAtLocation(el.name);
          if (sym && callee === SAFE_WRAPPER_HOOK) safeRunners.add(sym);
          if (sym && callee === "useTransition") reactStarts.add(sym);
        }
      }
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === "react") {
        const nb = n.importClause?.namedBindings;
        if (nb && ts.isNamedImports(nb))
          for (const e of nb.elements) {
            if ((e.propertyName ?? e.name).text !== "startTransition") continue;
            const sym = checker.getSymbolAtLocation(e.name);
            if (sym) reactStarts.add(sym);
          }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  const unwrap = (n: ts.Node): ts.Node => {
    let p = n;
    while (p.parent && (ts.isParenthesizedExpression(p.parent) || ts.isAsExpression(p.parent) || ts.isNonNullExpression(p.parent) || ts.isSatisfiesExpression(p.parent))) p = p.parent;
    return p;
  };
  const fnOf = (n: ts.Node): Fn | null => {
    let p = n.parent;
    while (p && !ts.isFunctionLike(p)) p = p.parent;
    return (p as Fn | undefined) ?? null;
  };

  type Verdict = string | null; // null: yakalandı; metin: neden yakalanmadı
  // Her soru (söz, fonksiyon sonucu, fonksiyon değeri) kendi önbelleğinde: aynı düğüm iki soruda da geçer
  const memo = new Map<string, Map<ts.Node, Verdict>>();
  const busy = new Map<string, Set<ts.Node>>();
  function cached(kind: string, key: ts.Node, fn: () => Verdict): Verdict {
    const m = memo.get(kind) ?? memo.set(kind, new Map()).get(kind)!;
    const b = busy.get(kind) ?? busy.set(kind, new Set()).get(kind)!;
    if (m.has(key)) return m.get(key)!;
    if (b.has(key)) return null; // döngü: başka bir yol karar verir
    b.add(key);
    const v = fn();
    b.delete(key);
    m.set(key, v);
    return v;
  }
  const where = (n: ts.Node) => {
    const sf = n.getSourceFile();
    return `${relative(root, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  };

  /** `expr`in ürettiği sözün reddi yakalanıyor mu */
  function promiseHandled(expr: ts.Node): Verdict {
    return cached("promise", expr, () => {
      const e = unwrap(expr);
      const p = e.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === e && ts.isCallExpression(p.parent) && p.parent.expression === p) {
        const m = p.name.text;
        if (m === "catch") return null;
        if (m === "then" && p.parent.arguments.length >= 2) return null;
        if (m === "then" || m === "finally") return promiseHandled(p.parent);
        return `${where(p)}: .${m}`;
      }
      if (ts.isAwaitExpression(p)) return throwHandled(p);
      if (ts.isReturnStatement(p)) {
        const f = fnOf(p);
        return f ? fnResultHandled(f) : `${where(p)}: return`;
      }
      if (ts.isArrowFunction(p) && p.body === e) return fnResultHandled(p);
      if (ts.isConditionalExpression(p) && p.condition !== e) return promiseHandled(p);
      if (ts.isBinaryExpression(p) && LOGICAL.has(p.operatorToken.kind)) return promiseHandled(p);
      // Sözü bekleyen bir fonksiyona verilmesi: run(kaydet(…), "Kaydedildi")
      if (ts.isCallExpression(p) && p.arguments.includes(e as ts.Expression)) {
        const w = resolveFn(p.expression);
        const param = w?.parameters[p.arguments.indexOf(e as ts.Expression)];
        if (!param || !ts.isIdentifier(param.name)) return `${where(p)}: ${p.expression.getText()}(…) sözü yakalamıyor ya da çözülemedi`;
        const uses = usesOf(param.name);
        if (!uses.length) return `${where(param)}: söz kullanılmıyor`;
        for (const u of uses) {
          const v = promiseHandled(u);
          if (v) return v;
        }
        return null;
      }
      if (ts.isArrayLiteralExpression(p) && ts.isCallExpression(p.parent) && ts.isPropertyAccessExpression(p.parent.expression) && ts.isIdentifier(p.parent.expression.expression) && p.parent.expression.expression.text === "Promise") {
        const m = p.parent.expression.name.text;
        return m === "allSettled" ? null : promiseHandled(p.parent);
      }
      if (ts.isVariableDeclaration(p) && p.initializer === e && ts.isIdentifier(p.name)) {
        const uses = usesOf(p.name);
        if (!uses.length) return `${where(p)}: beklenmeyen söz`;
        for (const u of uses) {
          const v = promiseHandled(u);
          if (v) return v;
        }
        return null;
      }
      if (ts.isVoidExpression(p)) return `${where(p)}: void`;
      if (ts.isExpressionStatement(p)) return `${where(p)}: beklenmeden çağrıldı`;
      return `${where(p)}: ${ts.SyntaxKind[p.kind]}`;
    });
  }

  /** `n` noktasında atılan hata yakalanıyor mu (aynı fonksiyonda try/catch ya da fonksiyonun sonucu) */
  function throwHandled(n: ts.Node): Verdict {
    let c: ts.Node = n;
    while (c.parent) {
      const p: ts.Node = c.parent;
      if (ts.isTryStatement(p) && p.tryBlock === c && p.catchClause) return null;
      if (ts.isFunctionLike(p)) return fnResultHandled(p as Fn);
      c = p;
    }
    return `${where(n)}: dosya düzeyinde`;
  }

  /** Fonksiyonun sonucu (sözü ya da attığı hata) yakalanıyor mu: fonksiyonun bütün kullanımlarına bakılır */
  function fnResultHandled(f: Fn): Verdict {
    return cached("result", f, () => {
      if (ts.isFunctionDeclaration(f) && f.name) return usesHandled(f.name, `${where(f)}: ${f.name.text} hiç çağrılmıyor`);
      if (ts.isMethodDeclaration(f)) return `${where(f)}: yöntem (${f.name.getText()})`;
      return fnValueHandled(f);
    });
  }

  /** Bir adın (fonksiyon, eylem, özellik) bütün kullanımları yakalanıyor mu */
  function usesHandled(name: ts.Identifier, none: string): Verdict {
    const uses = usesOf(name);
    if (!uses.length) return none;
    for (const u of uses) {
      const v = fnValueHandled(u);
      if (v) return v;
    }
    return null;
  }

  /**
   * Nesne özelliği olarak saklanan fonksiyon (ör. duruma yazılan `run`): çağrıldığı yer izlenemez. Hatası başka yerde
   * yakalanıyorsa özelliğin hemen üstündeki yorum `eylem-hatası: <nerede>` der; bekçi bu yorumları ayrıca sayar.
   */
  function marked(n: ts.Node): boolean {
    const text = n.getSourceFile().text;
    return (ts.getLeadingCommentRanges(text, n.getFullStart()) ?? []).some((c) => /eylem-hatası: \S/.test(text.slice(c.pos, c.end)));
  }

  /** Bir fonksiyon değeri (ad ya da ifade) nereye gidiyor: çağrılıyor, bir sarmalayıcıya ya da bileşene veriliyor … */
  function fnValueHandled(v: ts.Node): Verdict {
    return cached("value", v, () => {
      const e = unwrap(v);
      const p = e.parent;
      if (ts.isCallExpression(p) && p.expression === e) return promiseHandled(p);
      if (ts.isCallExpression(p) && p.arguments.includes(e as ts.Expression)) return argHandled(p, p.arguments.indexOf(e as ts.Expression));
      if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) return jsxPropHandled(p.parent);
      if (ts.isVariableDeclaration(p) && p.initializer === e && ts.isIdentifier(p.name)) return usesHandled(p.name, `${where(p)}: ${p.name.text} kullanılmıyor`);
      // Yalnız varlığına bakılır (`undo ? … : …`, `if (undo)`, `!undo`, `undo && …`): çağrılmaz
      if ((ts.isConditionalExpression(p) && p.condition === e) || (ts.isIfStatement(p) && p.expression === e) || ts.isPrefixUnaryExpression(p) || ts.isTypeOfExpression(p)) return null;
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.left === e) return null;
      if (ts.isConditionalExpression(p)) return fnValueHandled(p);
      if (ts.isBinaryExpression(p) && LOGICAL.has(p.operatorToken.kind)) return fnValueHandled(p);
      if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && marked(p)) return null;
      if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) return `${where(p)}: nesne özelliği (${p.name.getText()})`;
      // Değeri çağrılmayan kullanımlar: fn.name, içe / dışa aktarma, tür
      if (ts.isPropertyAccessExpression(p) && p.expression === e) return null;
      if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return null;
      if (ts.isTypeQueryNode(p) || ts.isTypeReferenceNode(p) || ts.isQualifiedName(p)) return null;
      return `${where(p)}: ${ts.SyntaxKind[p.kind]}`;
    });
  }

  /** Fonksiyon, `call`ın `i`. bağımsız değişkeni */
  function argHandled(call: ts.CallExpression, i: number): Verdict {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) {
      const sym = checker.getSymbolAtLocation(callee);
      if (sym && safeRunners.has(sym)) return null;
      if (sym && reactStarts.has(sym)) return `${where(call)}: React'in çıplak startTransition'ı (useActionTransition kullanın)`;
      if (callee.text === "useCallback" && i === 0) {
        const d = unwrap(call).parent;
        if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name)) return usesHandled(d.name, `${where(d)}: ${d.name.text} kullanılmıyor`);
        return `${where(call)}: useCallback`;
      }
      if (DROPPING_CALLS.has(callee.text)) return `${where(call)}: ${callee.text}`;
      // Bileşenin özelliği ya da fonksiyonun parametresi olarak gelen başlatıcı: verildiği her yerde güvenli mi
      const passed = passedIn(callee);
      if (passed) return passed.length ? passed.map((v) => runnerHandled(v, i)).find((v) => v !== null) ?? null : `${where(call)}: ${callee.text} hiçbir yerden verilmiyor`;
    }
    if (ts.isPropertyAccessExpression(callee) && ["then", "finally", "catch"].includes(callee.name.text)) return promiseHandled(call);
    const w = resolveFn(callee);
    if (w) return paramHandled(w, i, callee.getText());
    return `${where(call)}: ${callee.getText()}(…) fonksiyonu yakalamıyor ya da çözülemedi`;
  }

  /** `v` (bir başlatıcı ya da sarmalayıcı) kendisine verilen fonksiyonun (i. bağımsız değişken) hatasını yakalıyor mu */
  function runnerHandled(v: ts.Expression, i: number): Verdict {
    if (ts.isIdentifier(v)) {
      const sym = checker.getSymbolAtLocation(v);
      if (sym && safeRunners.has(sym)) return null;
      if (sym && reactStarts.has(sym)) return `${where(v)}: React'in çıplak startTransition'ı (useActionTransition kullanın)`;
    }
    const w = resolveFn(v);
    return w ? paramHandled(w, i, v.getText()) : `${where(v)}: ${v.getText()} çözülemedi`;
  }

  /**
   * Ad bir fonksiyonun parametresiyse (ya da bileşenin özelliğiyse) ona verilen değerler: `<Kart start={start}>`,
   * `f(start)`. Parametre değilse null.
   */
  function passedIn(name: ts.Identifier): ts.Expression[] | null {
    const decl = checker.getSymbolAtLocation(name)?.declarations?.[0];
    if (!decl) return null;
    let owner: Fn | null = null;
    let prop: string | null = null;
    let index = 0;
    if (ts.isBindingElement(decl) && ts.isObjectBindingPattern(decl.parent) && ts.isParameter(decl.parent.parent) && ts.isFunctionLike(decl.parent.parent.parent)) {
      owner = decl.parent.parent.parent as Fn;
      index = owner.parameters.indexOf(decl.parent.parent);
      prop = ((decl.propertyName ?? decl.name) as ts.Identifier).text;
    } else if (ts.isParameter(decl) && ts.isFunctionLike(decl.parent)) {
      owner = decl.parent as Fn;
      index = owner.parameters.indexOf(decl);
    } else return null;
    const ownerName = ts.isFunctionDeclaration(owner) ? owner.name : ts.isVariableDeclaration(unwrap(owner).parent) ? ((unwrap(owner).parent as ts.VariableDeclaration).name as ts.Identifier) : undefined;
    if (!ownerName || !ts.isIdentifier(ownerName)) return [];
    const out: ts.Expression[] = [];
    for (const u of usesOf(ownerName)) {
      const p = u.parent;
      if (prop !== null && (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p)) && p.tagName === u) {
        const attr = p.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === prop);
        if (attr?.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) out.push(attr.initializer.expression);
      } else if (prop === null && ts.isCallExpression(p) && p.expression === u && p.arguments[index]) out.push(p.arguments[index]);
    }
    return out;
  }

  /**
   * Çağrılan fonksiyonun tanımı: aynı dosyada (fonksiyon, `const f = () => …`, useCallback), içe aktarıldığı dosyada ya
   * da bir kancanın döndürdüğü nesnede (`const { run } = useX()`, `const x = useX(); x.guard(…)`)
   */
  function resolveFn(e: ts.Expression): Fn | null {
    const x = unwrapInit(e);
    if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) return x;
    if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression)) {
      const d = checker.getSymbolAtLocation(x.expression)?.declarations?.[0];
      if (d && ts.isVariableDeclaration(d) && d.initializer && ts.isCallExpression(d.initializer)) return hookMember(d.initializer, x.name.text);
      return null;
    }
    if (!ts.isIdentifier(x)) return null;
    const sym = checker.getSymbolAtLocation(x);
    const decl = sym?.declarations?.[0];
    if (!decl) return null;
    if (ts.isImportSpecifier(decl)) {
      const target = importedFile(decl, x.getSourceFile());
      return target ? topFunction(target, (decl.propertyName ?? decl.name).text) : null;
    }
    if (ts.isBindingElement(decl) && ts.isObjectBindingPattern(decl.parent) && ts.isVariableDeclaration(decl.parent.parent) && decl.parent.parent.initializer && ts.isCallExpression(decl.parent.parent.initializer)) {
      return hookMember(decl.parent.parent.initializer, ((decl.propertyName ?? decl.name) as ts.Identifier).text);
    }
    return fnDecl(decl);
  }
  /** Kancanın (useX()) döndürdüğü nesnedeki `name` özelliğinin fonksiyonu */
  function hookMember(hookCall: ts.CallExpression, name: string): Fn | null {
    const hook = resolveFn(hookCall.expression);
    if (!hook?.body || !ts.isBlock(hook.body)) return null;
    for (const st of hook.body.statements) {
      if (!ts.isReturnStatement(st) || !st.expression || !ts.isObjectLiteralExpression(st.expression)) continue;
      for (const pr of st.expression.properties) {
        if (pr.name?.getText() !== name) continue;
        if (ts.isShorthandPropertyAssignment(pr)) {
          const d = checker.getShorthandAssignmentValueSymbol(pr)?.declarations?.[0];
          return d ? fnDecl(d) : null;
        }
        if (ts.isPropertyAssignment(pr)) return resolveFn(pr.initializer);
        if (ts.isMethodDeclaration(pr)) return pr;
      }
    }
    return null;
  }
  function importedFile(decl: ts.ImportSpecifier, from: ts.SourceFile): ts.SourceFile | undefined {
    const mod = (decl.parent.parent.parent as ts.ImportDeclaration).moduleSpecifier;
    return ts.isStringLiteral(mod) ? moduleFile(mod.text, from) : undefined;
  }
  /** Göreli ya da @/ yolunun dosyası (paketler çözülmez) */
  function moduleFile(spec: string, from: ts.SourceFile): ts.SourceFile | undefined {
    const base = spec.startsWith("@/") ? join(root, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from.fileName), spec) : null;
    if (!base) return undefined;
    return [".tsx", ".ts", "/index.tsx", "/index.ts"].map((x) => sourceOf(base + x)).find(Boolean);
  }
  /** "use server" dosyası: dışa aktardığı her ad bir sunucu eylemi (ör. src/app/panel/sayim/actions.ts) */
  const isServerModule = (sf: ts.SourceFile | undefined) => {
    const first = sf?.statements[0];
    return Boolean(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server");
  };
  const unwrapInit = (n: ts.Expression): ts.Expression => {
    let e = n;
    // useCallback(fn, deps)
    while (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "useCallback" && e.arguments[0]) e = e.arguments[0];
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
    return e;
  };

  /** Sarmalayıcının `i`. parametresi (ya da bileşenin `prop` özelliği) yakalanarak mı çağrılıyor */
  function paramHandled(w: Fn, i: number, label: string, prop?: string): Verdict {
    const param = w.parameters[i];
    if (!param) return `${where(w)}: ${label} ${i}. parametreyi almıyor`;
    if (prop === undefined) {
      if (ts.isIdentifier(param.name)) return usesHandled(param.name, `${where(param)}: ${label} parametreyi kullanmıyor`);
      return `${where(param)}: ${label} parametresi çözülemedi`;
    }
    if (ts.isObjectBindingPattern(param.name)) {
      const el = param.name.elements.find((x) => ((x.propertyName ?? x.name) as ts.Identifier).text === prop);
      if (!el || !ts.isIdentifier(el.name)) return `${where(param)}: ${label} ${prop} özelliğini almıyor`;
      return usesHandled(el.name, `${where(el)}: ${label} ${prop} özelliğini kullanmıyor`);
    }
    if (ts.isIdentifier(param.name)) {
      // props.run
      const uses = usesOf(param.name).filter((u) => ts.isPropertyAccessExpression(u.parent) && u.parent.expression === u && u.parent.name.text === prop);
      if (!uses.length) return `${where(param)}: ${label} ${prop} özelliğini kullanmıyor`;
      for (const u of uses) {
        const v = fnValueHandled(u.parent);
        if (v) return v;
      }
      return null;
    }
    return `${where(param)}: ${label} özellikleri çözülemedi`;
  }

  /** JSX özelliği olarak verilen fonksiyon: bileşen onu yakalayarak mı çağırıyor */
  function jsxPropHandled(attr: ts.JsxAttribute): Verdict {
    const el = attr.parent.parent; // JsxAttributes → JsxOpeningElement | JsxSelfClosingElement
    const tag = (el as ts.JsxOpeningElement).tagName;
    const prop = attr.name.getText();
    if (!ts.isIdentifier(tag) || /^[a-z]/.test(tag.text)) return `${where(attr)}: <${tag.getText()} ${prop}>`;
    const comp = componentOf(tag);
    if (!comp) return `${where(attr)}: <${tag.text}> bileşeni çözülemedi`;
    return paramHandled(comp, 0, `<${tag.text}>`, prop);
  }

  /** Etiketin bileşeni: aynı dosyada ya da içe aktarıldığı dosyada (göreli ya da @/ yolu) tanımlı fonksiyon */
  function componentOf(tag: ts.Identifier): Fn | null {
    return resolveFn(tag);
  }
  function fnDecl(decl: ts.Declaration): Fn | null {
    if (ts.isFunctionDeclaration(decl)) return decl;
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      const i = unwrapInit(decl.initializer);
      if (ts.isArrowFunction(i) || ts.isFunctionExpression(i)) return i;
    }
    return null;
  }
  function topFunction(sf: ts.SourceFile, name: string): Fn | null {
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) return fnDecl(d);
    }
    return null;
  }

  const files: string[] = [];
  const unhandled: Unhandled[] = [];
  for (const rel of all) {
    const sf = sourceOf(join(root, rel));
    if (!sf || !isClient(sf)) continue;
    const imports: ts.Identifier[] = [];
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.importClause?.isTypeOnly) continue;
      if (!st.moduleSpecifier.text.startsWith(ACTIONS_PREFIX) && !isServerModule(moduleFile(st.moduleSpecifier.text, sf))) continue;
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) if (!e.isTypeOnly) imports.push(e.name);
    }
    if (!imports.length) continue;
    files.push(rel);
    for (const name of imports) {
      for (const u of usesOf(name)) {
        const why = fnValueHandled(u);
        if (why) unhandled.push({ file: rel, line: sf.getLineAndCharacterOfPosition(u.getStart()).line + 1, action: name.text, why });
      }
    }
  }
  return { files, unhandled };
}

/** Bir dosyanın metni (bekçinin örnek dosyaları için) */
export const readText = (root: string, p: string) => readFileSync(join(root, p), "utf8");

/**
 * useActionTransition'a verilen geri çağırmada, bir eylem beklendikten sonra try/finally dışında kendi meşgul durumunu
 * bırakan satırlar (`setBusy(false)`, `setBusyId(null)` …): eylem atarsa başlatıcı hatayı yakalar ama o satır hiç
 * çalışmaz, düğme kilitli kalır. `await tryAction(…)` atmadığı için sayılmaz.
 */
export function scanBusyAfterAwait(root: string): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  const BUSY = /^set\w*(Busy|Pending|Saving|Sending|Loading|Working)\w*$/;
  for (const f of walk(root, "src")) {
    const text = readFileSync(join(root, f), "utf8");
    if (!text.startsWith('"use client"')) continue;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const runners = new Set<string>();
    const collect = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.initializer && ts.isCallExpression(n.initializer) && ts.isIdentifier(n.initializer.expression) && n.initializer.expression.text === SAFE_WRAPPER_HOOK) {
        const el = n.name.elements[1];
        if (el && ts.isBindingElement(el) && ts.isIdentifier(el.name)) runners.add(el.name.text);
      }
      ts.forEachChild(n, collect);
    };
    collect(sf);
    const check = (n: ts.Node) => {
      const fn = ts.isCallExpression(n) && ts.isIdentifier(n.expression) && runners.has(n.expression.text) ? n.arguments[0] : undefined;
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
        // awaited: atabilecek bir bekleme geçti (catch'li try içindeki ya da tryAction'ın beklemesi atmaz)
        let awaited = false;
        const inner = (m: ts.Node, guarded: boolean, caught: boolean) => {
          if (ts.isFunctionLike(m)) return;
          if (ts.isAwaitExpression(m) && !caught && !(ts.isCallExpression(m.expression) && ts.isIdentifier(m.expression.expression) && m.expression.expression.text === "tryAction")) awaited = true;
          if (ts.isTryStatement(m)) {
            inner(m.tryBlock, true, caught || Boolean(m.catchClause));
            if (m.catchClause) inner(m.catchClause.block, guarded, caught);
            if (m.finallyBlock) inner(m.finallyBlock, true, caught);
            return;
          }
          if (awaited && !guarded && ts.isCallExpression(m) && ts.isIdentifier(m.expression) && BUSY.test(m.expression.text)) {
            const a = m.arguments[0];
            if (a && (a.kind === ts.SyntaxKind.FalseKeyword || a.kind === ts.SyntaxKind.NullKeyword)) out.push({ file: f, line: sf.getLineAndCharacterOfPosition(m.getStart()).line + 1, text: m.getText() });
          }
          ts.forEachChild(m, (c) => inner(c, guarded, caught));
        };
        ts.forEachChild(fn.body, (c) => inner(c, false, false));
      }
      ts.forEachChild(n, check);
    };
    check(sf);
  }
  return out;
}
