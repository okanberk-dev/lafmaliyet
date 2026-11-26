/*
 * Ayrı Paraşüt firması bağlanırken "Aynı vergi numarası mı?" denetiminin saf kuralları (docs/PARASUT.md › Şube başına
 * Paraşüt hesabı › Aynı vergi numarası). Ağa ve veritabanına dokunmaz; okuma src/server/parasut/company.ts'te, akış
 * src/server/parasut/connect.ts'te, soru Paraşüt ekranında (src/app/panel/parasut/connect-question.tsx). Denemesi
 * tests/parasut-firma.test.ts.
 *
 * Neden: gelen e-faturalar GİB'de vergi numarasına gelir. Aynı vergi numaralı iki Paraşüt firması (aynı işletme için
 * açılmış iki kayıt) aynı faturaları ayrı kimliklerle verir; iki hesap da eşitlenirse her fatura iki kez yazılır ve
 * gider iki kez sayılır. Firma numarasının aynı olması zaten reddedilir (companyClash); burada firma numarası farklı
 * ama vergi numarası aynı olan durum yakalanır.
 */

export interface ParasutCompany {
  /** Paraşüt firma numarası */
  id: string;
  name: string;
  /** VKN (10) ya da TCKN (11), yalnız rakam; okunamadıysa null */
  taxNumber: string | null;
}

/** VKN (10 hane) ya da TCKN (11 hane): yalnız rakam; başka uzunluk bilinmiyor sayılır */
export function companyTaxNumber(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length === 10 || digits.length === 11 ? digits : null;
}

/** `GET /v4/me?include=companies` yanıtındaki firmalar (`included` › `companies`: name, legal_name, tax_number) */
export function companiesOf(me: unknown): ParasutCompany[] {
  const included = (me as { included?: unknown } | null)?.included;
  if (!Array.isArray(included)) return [];
  const out: ParasutCompany[] = [];
  for (const r of included as ({ type?: unknown; id?: unknown; attributes?: Record<string, unknown> | null } | null)[]) {
    if (!r || r.type !== "companies" || (typeof r.id !== "string" && typeof r.id !== "number")) continue;
    const a = r.attributes ?? {};
    const name = [a.name, a.legal_name].find((x): x is string => typeof x === "string" && x.trim() !== "");
    out.push({ id: String(r.id), name: name?.trim() ?? String(r.id), taxNumber: companyTaxNumber(a.tax_number) });
  }
  return out;
}

/** Karşılaştırılan öbür hesap: sahibi şubenin adı ve firmasının vergi numarası (okunamadıysa null) */
export interface OtherCompany {
  name: string;
  taxNumber: string | null;
}

/**
 * Sonuç: `clear` sorulmadan bağlanır; `same` aynı vergi numarası (uyarı ve onay); `unknown` vergi numarası okunamadı
 * (bağlanan firmanınki ya da öbür hesabınki): karşılaştırılamadığı için yöneticiye sorulur
 */
export type TaxVerdict =
  | { kind: "clear" }
  | { kind: "same"; taxNumber: string; others: string[] }
  | { kind: "unknown"; taxNumber: string | null; others: string[] };

export type TaxQuestion = Exclude<TaxVerdict, { kind: "clear" }>;

/**
 * Bağlanan firmanın vergi numarası (`mine`) öbür hesapların firmalarıyla karşılaştırılır. Öbür hesap yoksa soru da
 * yoktur. Aynısı varsa `same` (okunamayanlar olsa da: kesin bilinen risk önce gelir); yoksa ve bir taraf okunamadıysa
 * `unknown`; hepsi okunmuş ve farklıysa `clear`
 */
export function taxVerdict(mine: string | null, others: readonly OtherCompany[]): TaxVerdict {
  if (!others.length) return { kind: "clear" };
  if (mine) {
    const same = others.filter((o) => o.taxNumber === mine);
    if (same.length) return { kind: "same", taxNumber: mine, others: same.map((o) => o.name) };
  }
  const unknown = mine ? others.filter((o) => !o.taxNumber) : others;
  if (unknown.length) return { kind: "unknown", taxNumber: mine, others: unknown.map((o) => o.name) };
  return { kind: "clear" };
}

/** Kayıttan okunan sonucu doğrular (bozuksa null) */
export function parseTaxQuestion(raw: unknown): TaxQuestion | null {
  const v = raw as { kind?: unknown; taxNumber?: unknown; others?: unknown } | null;
  if (!v || !Array.isArray(v.others) || !v.others.length || !v.others.every((o) => typeof o === "string")) return null;
  const others = v.others as string[];
  if (v.kind === "same" && typeof v.taxNumber === "string") return { kind: "same", taxNumber: v.taxNumber, others };
  if (v.kind === "unknown") return { kind: "unknown", taxNumber: typeof v.taxNumber === "string" ? v.taxNumber : null, others };
  return null;
}

const listTR = (names: readonly string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} ve ${names[names.length - 1]}` : (names[0] ?? ""));

/** Onay penceresinin metni ve işlem geçmişine düşen not (ekran ve kayıt aynı kuraldan) */
export function taxConfirmCopy(v: TaxQuestion, accountName: string): { title: string; description: string; confirmLabel: string; log: string } {
  const others = listTR(v.others);
  const many = v.others.length > 1;
  const withTheirs = many ? "şubelerinin Paraşüt firmalarıyla" : "şubesinin Paraşüt firmasıyla";
  if (v.kind === "same") {
    return {
      title: "Aynı vergi numarası",
      description:
        `${accountName} için bağladığınız Paraşüt firması ${others} ${withTheirs} aynı vergi numarasını taşıyor (${v.taxNumber}). ` +
        "Gelen e-faturalar vergi numarasına geldiği için aynı faturalar iki hesaptan da gelebilir ve iki kez sayılır. " +
        `Aynı işletmeyse bağlamayın, Şube ayarları'ndan “${v.others[0]} ile aynı”yı açın. Faturaları gerçekten ayrıysa bağlayabilirsiniz.`,
      confirmLabel: "Yine de bağla",
      log: `aynı vergi numarası uyarısı onaylandı (${v.taxNumber}; ${others})`,
    };
  }
  return {
    title: "Aynı vergi numarası mı?",
    description:
      (v.taxNumber
        ? `${others} ${many ? "şubelerinin Paraşüt firmalarının" : "şubesinin Paraşüt firmasının"} vergi numarası okunamadı; ${accountName} için bağladığınız firmanınki ${v.taxNumber}. `
        : `${accountName} için bağladığınız Paraşüt firmasının vergi numarası okunamadı; ${others} ${withTheirs} karşılaştırılamadı. `) +
      "İki firma aynı vergi numarasını taşıyorsa aynı faturalar iki hesaptan da gelebilir ve iki kez sayılır. Vergi numaraları farklıysa bağlayın, aynıysa vazgeçin.",
    confirmLabel: "Farklı, bağla",
    log: `vergi numarası karşılaştırılamadı (${others}); yönetici farklı olduğunu onayladı`,
  };
}
