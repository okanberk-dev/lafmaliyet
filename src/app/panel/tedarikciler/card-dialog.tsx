"use client";

import { Check, FileSearch, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { keepScroll } from "@/components/ui/filters";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { BIG_FIELDS, SHEET_BTN } from "@/components/ui/mobile-filters";
import { ToggleRow } from "@/components/ui/toggle-row";
import { cn } from "@/lib/utils";
import { saveSupplier, supplierInfoFromParasut } from "@/server/actions/suppliers";

import { supplierMatchKey } from "../faturalar/rules";
import {
  bankFromIban,
  fillFromInfo,
  formatIban,
  ibanProblem,
  INFO_LABEL,
  nameMoveLines,
  nameMoves,
  normalizeIban,
  PAYMENT_METHODS,
  phoneE164,
  PLACEHOLDER_SUPPLIER_NAME,
  taxKey,
  taxNumberCheck,
  taxPreview,
  taxPreviewLines,
  whatsappHref,
  type PaymentMethod,
  type SupplierCard,
  type TaxIndex,
} from "./logic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function blankForm(card: SupplierCard | null, name: string, inferredTaxNumber: string | null) {
  return {
    name: card?.name ?? name,
    legalName: card?.legalName ?? "",
    taxNumber: card?.taxNumber || inferredTaxNumber || "",
    taxOffice: card?.taxOffice ?? "",
    iban: card?.iban ? formatIban(card.iban) : "",
    bankName: card?.bankName ?? "",
    accountHolder: card?.accountHolder ?? "",
    contactName: card?.contactName ?? "",
    phone: card?.phone ?? "",
    email: card?.email ?? "",
    address: card?.address ?? "",
    paymentTermDays: card?.paymentTermDays === null || card?.paymentTermDays === undefined ? "" : String(card.paymentTermDays),
    paymentMethod: (card?.paymentMethod ?? "") as PaymentMethod | "",
    paidOnDelivery: card?.paidOnDelivery ?? false,
    note: card?.note ?? "",
  };
}

type Form = ReturnType<typeof blankForm>;

/**
 * Tedarikçi penceresi (yeni ya da düzenleme): ad, unvan, vergi no ve dairesi, IBAN, iletişim, vade, ödeme şekli, peşin
 * çalışma, faturalarda geçen diğer adlar ve not; bunlar tedarikçinin kartında (suppliers) saklanır. Faturası olup
 * kartı olmayan tedarikçide ilk kayıt kartı açar. "Faturadan doldur" tedarikçinin en yeni Paraşüt faturasından
 * okunan bilgileri yalnız boş alanlara yazar; kartta vergi no yoksa faturalardaki tek numara alana önerilir
 * (`inferredTaxNumber`, kaydedince karta geçer; numara başka bir kartta yazılıysa önerilmez: iki kartta aynı numara
 * eşleşmeyi kapatırdı). Vergi no alanının altında o numarayla hangi faturaların bu
 * tedarikçide toplanacağı görünür (`taxIndex`); ad ya da diğer ad, vergi nosuyla başka bir kartta duran faturaların
 * adıysa onların buraya geçeceği de yazılır (ad önce gelir). Kaydedince `onSaved` yeni adres parçasıyla çağrılır (ad değiştiyse
 * sayfa oraya geçer). `onDelete` verilirse altta "Tedarikçiyi sil" çıkar (RemoveSupplierDialog).
 */
export function SupplierCardDialog({
  card,
  name = "",
  names = [],
  inferredTaxNumber = null,
  taxIndex,
  slug = null,
  suggestions = [],
  defaultTermDays,
  canFill = false,
  onClose,
  onSaved,
  onDelete,
}: {
  card: SupplierCard | null;
  /** Kartsız tedarikçinin faturalardaki adı (yeni kartın adı olur) */
  name?: string;
  /** Faturalarda geçen adlar: "Faturadan doldur" bu adlı faturalara bakar */
  names?: string[];
  /** Kartta vergi no yoksa faturalardaki tek vergi no: alana yazılı gelir, "faturadan dolduruldu" işaretlenir */
  inferredTaxNumber?: string | null;
  /** Vergi no önizlemesinin verisi (taxNameIndex) */
  taxIndex?: TaxIndex;
  /** Kartsız tedarikçinin sayfasında açıldıysa adres parçası: onun faturaları önizlemede "gelecek" sayılmaz */
  slug?: string | null;
  /** Diğer ad olabilecek kartsız adlar (aynı firmanın farklı yazılışı) */
  suggestions?: string[];
  /** Ödemeler'deki genel vade (gün): vade alanı boşken geçerli olan */
  defaultTermDays: number;
  /** Paraşüt bağlı ve tedarikçinin Paraşüt'ten gelen faturası var */
  canFill?: boolean;
  onClose: () => void;
  onSaved?: (r: { id: number; slug: string | null }) => void;
  /** Tedarikçiyi sil (pencere kapanır, silme penceresi açılır) */
  onDelete?: () => void;
}) {
  // Faturalardaki numara başka bir kartta da yazılıysa alana önerilmez: kaydedilse numara iki kartta olur ve vergi
  // noyla eşleşme ikisinde de kapanırdı (sayfadaki şerit durumu zaten söylüyor)
  const [suggested] = useState(() =>
    !card?.taxNumber && inferredTaxNumber && !(taxIndex && taxPreview(taxIndex, inferredTaxNumber, { cardId: card?.id ?? null, slug: null }).sharedCards.length)
      ? inferredTaxNumber
      : null,
  );
  const [f, setF] = useState<Form>(() => blankForm(card, name, suggested));
  const [aliases, setAliases] = useState<string[]>(() => card?.aliases ?? []);
  const [aliasInput, setAliasInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);
  const [filled, setFilled] = useState<ReadonlySet<string>>(() => new Set(suggested ? ["taxNumber"] : []));
  const [tried, setTried] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  // Alan denetimleri: hata kaydı durdurur, uyarı (VKN kontrol hanesi) yalnız söyler
  const ibanError = f.iban.trim() ? ibanProblem(f.iban) : null;
  const bank = !ibanError && f.iban.trim() ? bankFromIban(f.iban) : null;
  // Kayıtlı IBAN değişiyor: teyit uyarısı (sahte "IBAN'ımız değişti" bildirimi sık kullanılan bir dolandırıcılık)
  const ibanChanged = Boolean(card?.iban) && !ibanError && f.iban.trim() !== "" && normalizeIban(f.iban) !== card?.iban;
  const tax = taxNumberCheck(f.taxNumber);
  const taxError = tax && "error" in tax ? tax.error : null;
  const taxWarning = tax && "warning" in tax ? tax.warning : null;
  // Kontrol hanesi tutan ama formlarda örnek diye yazılan numara (1234567890 …): saklanır, eşleşmede kullanılmaz
  const taxDummy = !tax && f.taxNumber.trim() !== "" && !taxKey(f.taxNumber);
  // Bu numara kaydedilirse hangi faturalar bu tedarikçide toplanır, hangileri adıyla başka yerde kalır
  const previewData = taxIndex && !taxError ? taxPreview(taxIndex, f.taxNumber, { cardId: card?.id ?? null, slug: card ? null : slug }) : null;
  const preview = previewData ? taxPreviewLines(previewData) : [];
  // Numara başka bir kartta da yazılı: uyarı renginde
  const previewShared = Boolean(previewData?.sharedCards.length);
  const emailError = f.email.trim() && !EMAIL.test(f.email.trim()) ? "E-posta adresi geçersiz" : null;
  const term = f.paymentTermDays.trim() ? Number(f.paymentTermDays) : null;
  const termError = term !== null && (!Number.isInteger(term) || term < 0 || term > 365) ? "0 ile 365 arasında tam gün" : null;
  const nameMissing = tried && !f.name.trim();
  const phoneE = f.phone.trim() ? phoneE164(f.phone) : null;
  const phoneHint = f.phone.trim() ? (phoneE ? (whatsappHref(f.phone) ? "Arama ve WhatsApp bağlantısı açılır" : "Arama bağlantısı açılır") : "Numara tanınmadı; olduğu gibi saklanır") : undefined;
  const filledHint = (k: string) => (filled.has(k) ? "Faturadan dolduruldu; kontrol edin" : undefined);

  const ownKey = supplierMatchKey(f.name);
  const freeSuggestions = suggestions.filter((s) => !aliases.some((a) => supplierMatchKey(a) === supplierMatchKey(s)) && supplierMatchKey(s) !== ownKey);
  // Kaydedilecek diğer adlar: kutuda yazılı kalan ad da eklenir
  const typed = aliasInput.trim() && !aliases.some((a) => supplierMatchKey(a) === supplierMatchKey(aliasInput)) ? [...aliases, aliasInput.trim()] : aliases;
  // Kartsız tedarikçinin sayfasında açılan kart başka adla kaydedilirse faturalardaki adlar diğer adlara girer
  // (faturalar karta düşer, sayfa boş kalmaz)
  const fromPage = card
    ? []
    : names.filter((n) => n !== PLACEHOLDER_SUPPLIER_NAME && supplierMatchKey(n) !== ownKey && !typed.some((a) => supplierMatchKey(a) === supplierMatchKey(n)));
  // Bu adlarla gelip vergi nosuyla başka kartta duran faturalar kaydedince buraya geçer (ad önce gelir); vergi no
  // önizlemesi bunu göstermez. Ör. iki kartı bağlayan numarada aynı adın kartsız kalan grubundan açılan kart
  const nameLines = taxIndex ? nameMoveLines(nameMoves(taxIndex, [f.name, ...fromPage], card?.id ?? null)) : [];
  const aliasLines = taxIndex ? nameMoveLines(nameMoves(taxIndex, typed, card?.id ?? null)) : [];

  function addAlias(raw: string) {
    const a = raw.replace(/\s+/g, " ").trim();
    if (!a) return;
    const k = supplierMatchKey(a);
    if (k === ownKey) return void toast.info("Bu, tedarikçinin kendi adı");
    if (aliases.some((x) => supplierMatchKey(x) === k)) return void toast.info("Bu ad zaten listede");
    setAliases((xs) => [...xs, a]);
    setAliasInput("");
  }

  async function fill() {
    setFilling(true);
    try {
      const r = await supplierInfoFromParasut(names.length ? names : [f.name]);
      if (!r.ok) return void toast.error(r.error);
      const { patch, filled: keys } = fillFromInfo(
        { legalName: f.legalName, taxNumber: f.taxNumber, taxOffice: f.taxOffice, address: f.address, phone: f.phone, email: f.email, iban: f.iban, bankName: f.bankName },
        r.data.info,
      );
      if (!keys.length) return void toast.info("Faturadaki bilgiler zaten formda", { description: r.data.source ? `Kaynak: ${r.data.source}` : undefined });
      set(patch);
      setFilled((x) => new Set([...x, ...keys]));
      toast.success(`${keys.length} bilgi faturadan dolduruldu`, {
        description: `${keys.map((k) => INFO_LABEL[k]).join(", ")}${r.data.source ? ` · ${r.data.source}` : ""}. Kaydetmeden önce kontrol edin.`,
        duration: 8000,
      });
    } finally {
      setFilling(false);
    }
  }

  async function save() {
    setTried(true);
    if (!f.name.trim()) {
      nameRef.current?.focus();
      return toast.error("Tedarikçi adını yazın");
    }
    const problem = ibanError ?? taxError ?? emailError ?? termError;
    if (problem) return toast.error(problem);
    setBusy(true);
    keepScroll();
    try {
      const r = await saveSupplier({
        id: card?.id ?? null,
        name: f.name,
        aliases: [...typed, ...fromPage],
        legalName: f.legalName,
        taxNumber: f.taxNumber,
        taxOffice: f.taxOffice,
        iban: f.iban ? normalizeIban(f.iban) : null,
        bankName: f.bankName.trim() || bank || null,
        accountHolder: f.accountHolder,
        contactName: f.contactName,
        phone: f.phone,
        email: f.email,
        address: f.address,
        paymentTermDays: term,
        paymentMethod: f.paymentMethod || null,
        paidOnDelivery: f.paidOnDelivery,
        note: f.note,
      });
      if (!r.ok) return void toast.error(r.error);
      // Aynı vergi no başka bir kartta da yazılı: kayıt durmaz, numara eşleşmede kullanılmaz
      const shared = r.data.sharedTax.length
        ? `Bu vergi no ${r.data.sharedTax.map((n) => `“${n}”`).join(", ")} ${r.data.sharedTax.length > 1 ? "tedarikçilerinde" : "tedarikçisinde"} de kayıtlı; faturalar adlarına göre ayrılır.`
        : null;
      const lead = r.data.renamedAlias ? `“${r.data.renamedAlias}” adıyla gelen faturalar bu tedarikçide kalsın diye diğer adlara eklendi.` : f.name.trim();
      toast.success(card || names.length ? "Tedarikçi kaydedildi" : "Tedarikçi eklendi", {
        description: shared ? `${lead}${lead.endsWith(".") ? " " : " · "}${shared}` : lead,
        duration: shared ? 10000 : undefined,
      });
      onSaved?.({ id: r.data.id, slug: r.data.slug });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save();
  }

  return (
    <>
      <Dialog
        open
        onClose={() => (busy ? undefined : onClose())}
        size="lg"
        title={card || names.length ? "Tedarikçiyi düzenle" : "Yeni tedarikçi"}
        description={
          card || names.length
            ? "Ödeme ve iletişim için tedarikçinin bilgileri. Faturalar adla eşleşir; diğer adlarla gelen faturalar da bu tedarikçiye sayılır."
            : "Ad, unvan, vergi no, IBAN ve iletişim. Yalnız ad zorunlu; gerisini sonra da ekleyebilirsiniz."
        }
        footerStartOnPhone="body"
        footerStart={
          onDelete ? (
            <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad max-sm:min-h-12 max-sm:px-3" onClick={onDelete} disabled={busy}>
              <Trash2 size={16} /> Tedarikçiyi sil
            </Button>
          ) : null
        }
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy} className={SHEET_BTN}>
              Vazgeç
            </Button>
            <Button type="submit" form="supplier-form" disabled={busy || filling} className={SHEET_BTN}>
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </>
        }
      >
        <form id="supplier-form" onSubmit={onSubmit} noValidate className={cn("space-y-5 pb-2", BIG_FIELDS)}>
          {canFill ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-info-soft px-3.5 py-3">
              <p className="min-w-0 flex-1 text-[13px] leading-5 text-ink-soft">
                Unvan, vergi no, adres ve IBAN tedarikçinin en yeni Paraşüt faturasından (e-fatura belgesi ya da Paraşüt&apos;teki kişi kartı) okunabilir; yalnız boş alanlar dolar.
              </p>
              <Button variant="secondary" onClick={fill} disabled={filling || busy} className="text-ink max-sm:min-h-11">
                <FileSearch size={16} aria-hidden="true" /> {filling ? "Fatura okunuyor…" : "Faturadan doldur"}
              </Button>
            </div>
          ) : null}

          <fieldset className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
            <legend className="mb-2 text-[13px] font-semibold text-ink">Kimlik</legend>
            <Field
              label="Ad (faturalardaki)"
              htmlFor="s-name"
              tip="Faturaların tedarikçi adıyla eşleşir (büyük/küçük harf ve parantezli not sayılmaz). Faturalarda başka adla da geliyorsa aşağıda diğer adlara ekleyin."
              error={nameMissing ? "Tedarikçi adını yazın" : undefined}
            >
              <Input
                ref={nameRef}
                id="s-name"
                value={f.name}
                onChange={(e) => set({ name: e.target.value })}
                aria-invalid={nameMissing || undefined}
                autoComplete="off"
                placeholder="ör. Sütaş"
                data-autofocus={card ? undefined : true}
              />
            </Field>
            <Field label="Ticari unvan" htmlFor="s-legal" hint={filledHint("legalName") ?? "Faturadaki tam ad"}>
              <Input id="s-legal" value={f.legalName} onChange={(e) => set({ legalName: e.target.value })} autoComplete="off" placeholder="ör. SÜTAŞ SÜT ÜRÜNLERİ A.Ş." />
            </Field>
            <Field
              label="Vergi no (VKN / TCKN)"
              htmlFor="s-tax"
              error={taxError ?? undefined}
              hint={
                // Numarayla ilgili uyarı "faturadan dolduruldu"dan önce gelir
                taxWarning
                  ? `${taxWarning} · faturalar bu numarayla eşleşmez`
                  : taxDummy
                    ? "Örnek numara gibi görünüyor · faturalar bu numarayla eşleşmez"
                    : (filledHint("taxNumber") ?? "Şirketlerde 10 haneli VKN, şahıs şirketinde 11 haneli TCKN")
              }
            >
              <Input
                id="s-tax"
                value={f.taxNumber}
                onChange={(e) => {
                  set({ taxNumber: e.target.value });
                  // Elle değiştirilen numara artık faturadan gelmiş sayılmaz
                  if (filled.has("taxNumber")) setFilled((x) => new Set([...x].filter((k) => k !== "taxNumber")));
                }}
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={Boolean(taxError) || undefined}
                data-warn={Boolean(taxWarning) || undefined}
              />
            </Field>
            <Field label="Vergi dairesi" htmlFor="s-office" hint={filledHint("taxOffice")}>
              <Input id="s-office" value={f.taxOffice} onChange={(e) => set({ taxOffice: e.target.value })} autoComplete="off" />
            </Field>
            {nameLines.length || preview.length ? (
              <div className="space-y-1 text-xs leading-5 sm:col-span-2" aria-live="polite">
                {nameLines.map((line) => (
                  <p key={line} className="text-warn">
                    {line}
                  </p>
                ))}
                {preview.map((line) => (
                  <p key={line} className={previewShared ? "text-warn" : "text-ink-soft"}>
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
          </fieldset>

          <fieldset className="grid gap-x-3 gap-y-4 rounded-2xl bg-panel p-4 sm:grid-cols-2">
            <legend className="sr-only">Banka</legend>
            <Field
              label="IBAN"
              htmlFor="s-iban"
              className="sm:col-span-2"
              error={ibanError ?? undefined}
              hint={filledHint("iban") ?? (bank ? `${bank} · kontrol hanesi doğru` : f.iban.trim() ? "Kontrol hanesi doğru" : "Ödeme talebinde ve kopyalarken kullanılır")}
            >
              <Input
                id="s-iban"
                value={f.iban}
                onChange={(e) => {
                  // Banka adı eski IBAN'dan geldiyse (elle yazılmadıysa) yeni IBAN'ın bankasına geçer
                  const auto = !f.bankName.trim() || f.bankName.trim() === (bankFromIban(f.iban) ?? "");
                  set({ iban: e.target.value, ...(auto ? { bankName: bankFromIban(e.target.value) ?? "" } : {}) });
                }}
                onBlur={() => !ibanError && f.iban.trim() && set({ iban: formatIban(f.iban) })}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="TR00 0000 0000 0000 0000 0000 00"
                aria-invalid={Boolean(ibanError) || undefined}
                className="font-mono tracking-wide"
              />
            </Field>
            {ibanChanged ? (
              <p className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn sm:col-span-2" role="status">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  IBAN değişiyor. Yeni IBAN&apos;ı tedarikçiyi bildiğiniz numaradan arayarak teyit edin: e-postayla ya da mesajla gelen “IBAN&apos;ımız değişti”
                  bildirimi sık kullanılan bir dolandırıcılık yoludur. Değişiklik işlem geçmişine yazılır.
                </span>
              </p>
            ) : null}
            <Field label="Banka" htmlFor="s-bank" hint={filledHint("bankName") ?? (bank && !f.bankName.trim() ? `Boş kalırsa “${bank}” yazılır` : undefined)}>
              <Input id="s-bank" value={f.bankName} onChange={(e) => set({ bankName: e.target.value })} autoComplete="off" placeholder={bank ?? undefined} />
            </Field>
            <Field label="Hesap sahibi" htmlFor="s-holder" hint="Unvandan farklıysa (ör. şahıs şirketi)">
              <Input id="s-holder" value={f.accountHolder} onChange={(e) => set({ accountHolder: e.target.value })} autoComplete="off" />
            </Field>
          </fieldset>

          <fieldset className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
            <legend className="mb-2 text-[13px] font-semibold text-ink">İletişim</legend>
            <Field label="Yetkili / satış temsilcisi" htmlFor="s-contact">
              <Input id="s-contact" value={f.contactName} onChange={(e) => set({ contactName: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Telefon" htmlFor="s-phone" hint={filledHint("phone") ?? phoneHint}>
              <Input id="s-phone" type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="off" placeholder="0532 123 45 67" />
            </Field>
            <Field label="E-posta" htmlFor="s-email" error={emailError ?? undefined} hint={filledHint("email")}>
              <Input
                id="s-email"
                type="email"
                value={f.email}
                onChange={(e) => set({ email: e.target.value })}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={Boolean(emailError) || undefined}
              />
            </Field>
            <Field label="Adres" htmlFor="s-address" className="sm:col-span-2" hint={filledHint("address")}>
              <Textarea id="s-address" value={f.address} onChange={(e) => set({ address: e.target.value })} rows={2} className="max-h-32 [field-sizing:content]" />
            </Field>
          </fieldset>

          <fieldset className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
            <legend className="mb-2 text-[13px] font-semibold text-ink">Ödeme</legend>
            <Field
              label="Vade (gün)"
              htmlFor="s-term"
              error={termError ?? undefined}
              hint={`Vadesi yazılmamış faturada fatura tarihi + bu gün; boşsa ${defaultTermDays} gün (Ödemeler'deki ayar). 0 = fatura günü.`}
            >
              <Input
                id="s-term"
                value={f.paymentTermDays}
                onChange={(e) => set({ paymentTermDays: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                inputMode="numeric"
                autoComplete="off"
                placeholder={String(defaultTermDays)}
                aria-invalid={Boolean(termError) || undefined}
              />
            </Field>
            <Field label="Genelde nasıl ödenir" htmlFor="s-method" hint="Ödendi işaretlerken önce bu seçili gelir">
              <Select id="s-method" value={f.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as PaymentMethod | "" })}>
                <option value="">Belirtilmedi</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <ToggleRow
              className="sm:col-span-2"
              title="Faturaları ödendi gelsin"
              description="Peşin ya da kartla otomatik ödenen tedarikçi (abonelik vb.): Paraşüt'ten gelen yeni faturası ödendi (fatura günü) olarak gelir. Eski faturalara dokunulmaz. Komisyon faturaları bu ayar olmadan da ödendi gelir (hakedişten düşülür)."
              checked={f.paidOnDelivery}
              onChange={(on) => set({ paidOnDelivery: on })}
              label="Bu tedarikçinin yeni faturaları ödendi gelsin"
              onText="Açık"
              offText="Kapalı"
            />
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-[13px] font-semibold text-ink">Faturalarda geçen diğer adlar</legend>
            <p className="mb-2.5 text-xs leading-5 text-ink-mute">
              Aynı firma faturalarda farklı yazılıyorsa (“YEMEK SEPETİ ELEKTRONİK…” ile “Yemek Sepeti”) ekleyin: o adla gelen faturalar da bu tedarikçide toplanır. Aynı
              vergi noyla gelen faturalar ad farklı olsa da kendiliğinden buraya düşer.
            </p>
            {aliases.length ? (
              <ul className="mb-2.5 flex flex-wrap gap-2" aria-label="Diğer adlar">
                {aliases.map((a) => (
                  <li key={a}>
                    <span className="inline-flex h-9 max-w-full items-center gap-1 rounded-full bg-surface pr-1 pl-3 text-[13px] font-medium text-ink ring-1 ring-line-strong ring-inset">
                      <span className="min-w-0 truncate">{a}</span>
                      <button
                        type="button"
                        onClick={() => setAliases((xs) => xs.filter((x) => x !== a))}
                        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-mute hover:bg-ink/[0.06] hover:text-ink pointer-coarse:size-9"
                        aria-label={`${a} adını çıkar`}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-2">
              <Input
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  addAlias(aliasInput);
                }}
                aria-label="Diğer ad ekle"
                placeholder="Faturadaki başka ad"
                autoComplete="off"
                className="min-w-0 flex-1"
              />
              <Button variant="secondary" onClick={() => addAlias(aliasInput)} disabled={!aliasInput.trim()} className="max-sm:min-h-12">
                <Plus size={16} aria-hidden="true" /> Ekle
              </Button>
            </div>
            {aliasLines.length ? (
              <div className="mt-2 space-y-1 text-xs leading-5 text-warn" aria-live="polite">
                {aliasLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
            {freeSuggestions.length ? (
              <div className="mt-2.5">
                <p className="mb-1.5 text-xs text-ink-mute">Aynı firma olabilir:</p>
                <ul className="flex flex-wrap gap-2">
                  {freeSuggestions.map((sug) => (
                    <li key={sug}>
                      <button
                        type="button"
                        onClick={() => addAlias(sug)}
                        className="inline-flex h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-ink/25 bg-surface px-3 text-[13px] font-medium text-ink-soft hover:border-ink/45 hover:text-ink"
                      >
                        <Plus size={14} aria-hidden="true" />
                        <span className="min-w-0 truncate">{sug}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </fieldset>

          <Field label="Not" htmlFor="s-note" hint="ör. “Ayın 5'inde toplu ödeme”, “Fatura numarasını açıklamaya yazın”">
            <Textarea id="s-note" value={f.note} onChange={(e) => set({ note: e.target.value })} rows={2} className="max-h-40 [field-sizing:content]" />
          </Field>

          {filled.size ? (
            <p className="flex items-center gap-1.5 text-xs text-ink-mute">
              <Badge tone="blue">
                <Check size={11} aria-hidden="true" /> Faturadan
              </Badge>
              {filled.size} alan faturadan dolduruldu; kaydetmeden önce kontrol edin.
            </p>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}
