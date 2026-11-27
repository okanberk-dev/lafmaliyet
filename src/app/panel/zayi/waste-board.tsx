"use client";

import { Gift, Plus, Search, Send, Trash2, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { BRANCH_REQUIRED } from "@/lib/branches";
import { parseNumberTR } from "@/lib/calc/expr";
import { tl } from "@/lib/format";
import { ASILPOS_IKRAM_TEXT } from "@/lib/asilpos/ikram";
import { longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { matchesChoice, qtyText, WASTE_KIND_LABEL, WASTE_REASONS, type WasteChoice, type WasteKind } from "@/lib/waste";
import { WASTE_REQUEST_TEXT as T, type WasteDeleteMode } from "@/lib/waste-requests";
import { withdrawStaffRequest } from "@/server/actions/staff-requests";
import { addWasteEntry, deleteWasteEntry } from "@/server/actions/waste";
import { requestLateWaste, requestWasteDelete } from "@/server/actions/waste-requests";
import type { WasteEntryDTO } from "@/server/data/waste";

const MAX_RESULTS = 8;

/** Kişinin bu güne bekleyen geç kayıt isteği (listenin başında soluk satır) */
export interface PendingLate {
  id: number;
  item: string;
  reason: string | null;
}

/**
 * AsilPOS gününün ikram ve zayi satırları (geçiş gününden itibaren; src/lib/asilpos/ikram.ts), salt okunur. Personele ad
 * ve adet; yöneticiye nedeni, menü değeri ve ürüne bağlı olmayan satır da (sunucu personelinkini boş gönderir)
 */
export interface AsilposDayView {
  /** "Ürün ikramı 10 Kasım'dan beri AsilPOS'ta işaretlenir. Burada hammadde ikramı ve zayi girilir." */
  note: string;
  /** O günün gün sonu geldi */
  received: boolean;
  /** Ürün ikramı bu güne panelden kapalı (gün sonu geldi ya da gün bugün; productIkramClosed) */
  closed: boolean;
  /** Gün bugünden önce (gün sonu gelmediyse ürün ikramı panelden girilebilir) */
  past: boolean;
  lines: { kind: WasteKind; name: string; qty: number; reason: string | null; menuValue: number | null; unmatched: boolean; service?: boolean }[];
  /** Panele girilmiş, sayılmayan ürün ikramı kayıtları (gün sonu geldiyse) */
  notCounted: number[];
  /** Paneldeki ürün zayisi, aynı gün aynı ürün AsilPOS'ta da zayi yazıldı (ikisi de sayılır) */
  maybeTwice: number[];
  /** "Tümü"de birden çok kasa açıkken AsilPOS'un şubesi (listenin başlığında; şube kapsamı C P2-7); yoksa null */
  branchName?: string | null;
  /**
   * Ürüne bağlı olmayan satırın "Ayarlar › AsilPOS'ta bağlayın" bağlantısı; Ayarlar'ı açamayan rolde null (müdür satırın
   * notunu görür, bağlantıyı görmez; src/lib/roles.ts › openableHref)
   */
  settingsHref: string | null;
}

/**
 * Zayi / ikram girişi ve günün listesi. Ürün ya da hammadde aranıp seçilir (ürün adetle, hammadde sayım biriminde),
 * neden tek dokunuşla; kayıt anında listeye düşer. İstek kipinde (personel, kilitli dün ve önceki 14 gün; dalga 10
 * §2.8) kart "Geç kayıt isteği" olur: yöneticiye açıklama zorunlu, kayıt onaya kadar listeye girmez. Satırın silme
 * kipi sunucuda hesaplanır (deleteModes): doğrudan (çöp kutusu), istek ("Silinmesini iste") ya da yok. Tutar yok.
 * AsilPOS gününde (`asilpos`) ürün ikramı AsilPOS'ta işaretlenir: İkram'da yalnız hammadde aranır (gün sonu gelmeyen
 * geçmiş günde ürün de), AsilPOS'un ikram ve zayi satırları salt okunur listelenir, panele girilmiş ürün ikramı
 * "sayılmıyor", AsilPOS'ta da zayi yazılan ürünün panel zayisi "AsilPOS'ta da zayi" der.
 */
export function WasteBoard({
  date,
  choices,
  entries,
  mode,
  deleteModes,
  deleteAsks,
  lateBadges,
  pendingLate,
  asilpos = null,
  branches,
}: {
  date: string;
  choices: WasteChoice[];
  entries: WasteEntryDTO[];
  /** Bu güne yazım: doğrudan ya da istek (personel) */
  mode: "direct" | "request";
  deleteModes: Record<number, WasteDeleteMode>;
  /** Silinmesi istenen kayıtlar: isteyenin adı; `mine` ise "Geri çek" */
  deleteAsks: Record<number, { requestId: number; by: string; mine: boolean }[]>;
  /** Onayla giren geç kayıtların rozeti: "Geç kayıt · Mehmet onayladı 24 Eki" */
  lateBadges: Record<number, string>;
  pendingLate: PendingLate[];
  /** AsilPOS günü (geçiş gününden itibaren); değilse null: bugünkü gibi */
  asilpos?: AsilposDayView | null;
  /**
   * Kaydın ineceği şube (docs/SUBE.md › Yazarken hangi şube): tekse o; "Tümü"de birden çoksa form sorar, varsayılan yok.
   * Sunucu doğrular (formBranch "waste"); gönderim anındaki seçim değil bu yazılır
   */
  branches: { id: string; name: string }[];
}) {
  const [kind, setKind] = useState<WasteKind>("zayi");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<WasteChoice | null>(null);
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useActionTransition();
  const [branchPick, setBranchPick] = useState<string | null>(null);
  // Şube seçimi açılışta nötr; yalnız şubesiz kayıt denenince hatalı görünür (Satışlar'ın "Satır ekle"si gibi)
  const [branchTried, setBranchTried] = useState(false);
  const branchId = branches.length === 1 ? branches[0].id : branchPick;
  const [removing, setRemoving] = useState<WasteEntryDTO | null>(null);
  const [asking, setAsking] = useState<WasteEntryDTO | null>(null);
  const [askReason, setAskReason] = useState("");
  // Çift dokunuşa karşı istemci anahtarı (doğrudan kayıtta da, UI-01): başarılı gönderimden sonra yenilenir; aynı
  // anahtarla gelen ikinci istek sunucuda yeni kayıt açmaz
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID());
  // Gönderim sürerken Enter'a ikinci basış: `pending` bir sonraki çizimde gelir, aynı karedeki olayı bu bayrak tutar
  const sending = useRef(false);
  const late = mode === "request";
  // AsilPOS gününde ürün ikramı AsilPOS'ta işaretlenir: İkram'da yalnız hammadde seçilir (sunucu da reddeder); gün sonu
  // gelmeyen geçmiş günde ürün de seçilir
  const noProducts = asilpos !== null && asilpos.closed && kind === "ikram";
  const pickable = noProducts ? choices.filter((c) => c.type !== "product") : choices;
  const notCounted = new Set(asilpos?.notCounted ?? []);
  const maybeTwice = new Set(asilpos?.maybeTwice ?? []);
  const itemLabel = noProducts ? "Hammadde" : "Ürün ya da hammadde";

  const results = query.trim() ? pickable.filter((c) => matchesChoice(c, query)).slice(0, MAX_RESULTS) : [];
  // Son girilen kalemler: aynı şey çoğu gün tekrar eder (bir dokunuşla seçilsin)
  const recent = [...new Map(entries.map((e) => [`${e.type}:${e.name}`, e])).values()]
    .map((e) => pickable.find((c) => c.name === e.name && (c.type === e.type)))
    .filter((c): c is WasteChoice => Boolean(c))
    .slice(0, 6);

  function choose(c: WasteChoice) {
    setPicked(c);
    setQuery("");
    setQty(c.type === "product" ? "1" : "");
    window.setTimeout(() => document.getElementById("zi-miktar")?.focus(), 0);
  }

  function submit() {
    // Miktar alanındaki Enter düğmenin kilidini atlar (denetim UI-01): kayıt sürerken ikinci gönderim yok
    if (sending.current || pending) return;
    if (!picked) return void toast.error(`Önce ${itemLabel.toLocaleLowerCase("tr")} seçin`);
    const n = parseNumberTR(qty);
    if (n === null || n <= 0) return void (toast.error("Miktarı yazın (ör. 1 ya da 0,5)"), document.getElementById("zi-miktar")?.focus());
    if (late && message.trim().length < 3) return void (toast.error(T.messageShort), document.getElementById("zi-aciklama")?.focus());
    if (!branchId) return void (setBranchTried(true), toast.error(BRANCH_REQUIRED), document.getElementById("zi-sube")?.focus());
    const input = {
      branchId,
      date,
      kind,
      productId: picked.type === "product" ? picked.id : null,
      ingredientId: picked.type === "ingredient" ? picked.id : null,
      qty: n,
      reason,
      note: note.trim() || null,
    };
    sending.current = true;
    start(async () => {
      try {
        if (late) {
          const res = await requestLateWaste({ ...input, message: message.trim(), clientKey });
          if (!res.ok) return void toast.error(res.error);
          toast.success(`Onaya gönderildi: ${picked.name} ${qtyText(n, picked.type === "product" ? "adet" : picked.unit)}`);
          setMessage("");
        } else {
          const res = await addWasteEntry({ ...input, clientKey });
          // Sunucu miktarı reddettiyse ("Ürün adetle girilir") düzeltilecek alan miktar
          if (!res.ok) return void (toast.error(res.error), document.getElementById("zi-miktar")?.focus());
          // Aynı anahtarla yazılmış kayıt vardı (yanıtı yolda kalan gönderimin tekrarı): yenisi açılmadı
          toast.success(`${res.data.repeated ? "Zaten kaydedilmişti" : WASTE_KIND_LABEL[kind]}: ${res.data.name} ${qtyText(res.data.qty, res.data.unit)}`);
        }
        setClientKey(crypto.randomUUID());
        setPicked(null);
        setQty("1");
        setNote("");
        setReason(null);
      } finally {
        sending.current = false;
      }
      // Doğrudan kayıtta yanıt yolda kaybolursa zayi yazılmış olabilir: bildirim bunu söyler; yeniden göndermek aynı
      // anahtarla gider, ikinci kayıt açılmaz (geç kaydın isteği de öyle)
    }, { maybeSaved: !late });
  }

  function askDelete() {
    if (!asking) return;
    if (askReason.trim().length < 3) return void (toast.error(T.messageShort), document.getElementById("zi-sil-neden")?.focus());
    const target = asking;
    start(async () => {
      const res = await requestWasteDelete({ id: target.id, message: askReason.trim(), clientKey: crypto.randomUUID() });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Silme isteği gönderildi: ${target.name} ${qtyText(target.qty, target.unit)}`);
      setAsking(null);
      setAskReason("");
    });
  }

  function withdraw(id: number) {
    start(async () => {
      const res = await withdrawStaffRequest(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("İstek geri çekildi");
    });
  }

  function remove() {
    if (!removing) return;
    start(async () => {
      const res = await deleteWasteEntry(removing.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Kayıt silindi");
      setRemoving(null);
    });
  }

  const counts = { zayi: entries.filter((e) => e.kind === "zayi").length, ikram: entries.filter((e) => e.kind === "ikram").length };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader
          icon={late ? <Send /> : <Gift />}
          title={late ? T.lateTitle : "Yeni kayıt"}
          description={late ? `${longDateTR(date)} · ${T.lateHint}` : `${longDateTR(date)} · ödenmeyen ve atılan her şey`}
        />
        <div className="space-y-4 px-5 pb-5">
          {branches.length > 1 ? (
            // "Tümü" seçili ve birden çok kasa açık: kayıt hangi şubenin, varsayılan yok (sessizce Tuzla'ya inmez)
            <Field label="Şube" htmlFor="zi-sube">
              <Select id="zi-sube" value={branchId ?? ""} onChange={(e) => setBranchPick(e.target.value || null)} aria-invalid={(branchTried && !branchId) || undefined}>
                {branchId ? null : <option value="">Şube seçin</option>}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Segmented<WasteKind>
            label="Kayıt türü"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setReason(null);
              if (asilpos?.closed && k === "ikram" && picked?.type === "product") setPicked(null);
            }}
            options={[
              { value: "zayi", label: "Zayi (atıldı, bozuldu)" },
              { value: "ikram", label: "İkram (ödenmedi)" },
            ]}
          />
          {noProducts ? (
            <Notice tone="neutral" size="sm" title={asilpos.note} />
          ) : asilpos && kind === "zayi" ? (
            <Notice tone="neutral" size="sm" title={ASILPOS_IKRAM_TEXT.zayiNote} />
          ) : kind === "ikram" ? (
            <p className="text-xs leading-5 text-ink-mute">
              Uygulamadaki ödülle (damga kartı, davet kuponu) verilen içecek ikram değildir: bar ekranına uygulama siparişi olarak düşer ve online satışta sayılır. Buraya
              da girilirse malzemesi iki kez düşülür.
            </p>
          ) : null}
          {picked ? (
            <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{picked.name}</p>
                <p className="text-xs text-ink-mute">
                  {picked.type === "product" ? "Menü ürünü · malzemesi reçeteden düşer" : `Hammadde · ${picked.group}`}
                </p>
              </div>
              <IconButton label="Başka kalem seç" onClick={() => setPicked(null)}>
                <X size={16} />
              </IconButton>
            </div>
          ) : (
            <div className="space-y-2">
              <Field label={itemLabel} htmlFor="zi-ara">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
                  <Input
                    id="zi-ara"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && results[0]) {
                        e.preventDefault();
                        choose(results[0]);
                      }
                    }}
                    placeholder={noProducts ? "ör. süt, şurup" : "ör. latte, süt, kruvasan"}
                    className="pl-9"
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                </div>
              </Field>
              {results.length ? (
                <ul className="divide-y divide-line overflow-hidden rounded-2xl ring-1 ring-line" aria-label="Arama sonuçları">
                  {results.map((c) => (
                    <li key={`${c.type}:${c.id}`}>
                      <button type="button" onClick={() => choose(c)} className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left hover:bg-panel pointer-coarse:py-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{c.name}</span>
                        <span className="shrink-0 text-xs text-ink-mute">{c.type === "product" ? c.group : `${c.group} · ${c.unit}`}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim() ? (
                <p className="text-sm text-ink-mute">Eşleşen {itemLabel.toLocaleLowerCase("tr")} yok.</p>
              ) : recent.length ? (
                <div className="flex flex-wrap gap-2" aria-label="Son girilenler">
                  {recent.map((c) => (
                    <button
                      key={`${c.type}:${c.id}`}
                      type="button"
                      onClick={() => choose(c)}
                      className="cursor-pointer rounded-full bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-soft ring-1 ring-line hover:text-ink pointer-coarse:py-2.5"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label={`Miktar${picked ? ` (${picked.unit})` : ""}`} htmlFor="zi-miktar">
              <NumberInput
                id="zi-miktar"
                inputMode={picked?.type === "product" ? "numeric" : "decimal"}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                enterKeyHint="done"
              />
            </Field>
            <Field label="Not" htmlFor="zi-not" hint="isteğe bağlı">
              <Input id="zi-not" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={kind === "ikram" ? "ör. masa 4, doğum günü" : "ör. son kullanma tarihi"} autoComplete="off" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Neden">
            {WASTE_REASONS[kind].map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(reason === r ? null : r)}
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 transition-colors pointer-coarse:py-2.5",
                  reason === r ? "bg-ink text-on-solid ring-ink" : "bg-surface text-ink-soft ring-line hover:text-ink",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          {late ? (
            <Field label={T.messageLabel} htmlFor="zi-aciklama" hint="zorunlu">
              <Textarea
                id="zi-aciklama"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="ör. akşam girmeyi unuttum, kapanışta döküldü"
              />
            </Field>
          ) : null}
          <Button size="lg" className="w-full" onClick={submit} disabled={pending || !picked}>
            {late ? <Send size={16} /> : <Plus size={16} />}{" "}
            {pending ? (late ? "Gönderiliyor…" : "Kaydediliyor…") : late ? T.send : `${WASTE_KIND_LABEL[kind]} olarak kaydet`}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={longDateTR(date)}
          description={entries.length ? `${counts.zayi} zayi · ${counts.ikram} ikram` : "Bu gün kayıt yok"}
        />
        {entries.length || pendingLate.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {pendingLate.map((r) => (
              <li key={`istek-${r.id}`} className="flex items-start gap-3 px-5 py-3 opacity-70">
                <Badge tone="amber">{T.pending}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words text-ink">{r.item}</p>
                  <p className="text-xs break-words text-ink-mute">{["Geç kayıt isteği", r.reason].filter(Boolean).join(" · ")}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => withdraw(r.id)} disabled={pending} className="min-h-11 sm:min-h-8">
                  <Undo2 size={14} /> {T.withdraw}
                </Button>
              </li>
            ))}
            {entries.map((e) => {
              const del = deleteModes[e.id] ?? "none";
              const asks = deleteAsks[e.id] ?? [];
              const mineAsk = asks.find((a) => a.mine);
              return (
                <li key={e.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                  <Badge tone={e.kind === "zayi" ? "red" : "blue"}>{WASTE_KIND_LABEL[e.kind]}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words text-ink">
                      {e.name} <span className="font-normal text-ink-mute tabular">· {qtyText(e.qty, e.unit)}</span>
                      {/* "Tümü"de birden çok kasa açıkken kaydın şubesi (şube kapsamı C P2-7) */}
                      {branches.length > 1 ? (
                        <Badge tone="gray" className="ml-1.5 align-middle">
                          {branches.find((b) => b.id === e.branchId)?.name ?? e.branchId}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs break-words text-ink-mute">
                      {[e.reason, e.note, e.createdByName, new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(e.createdAt))]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {lateBadges[e.id] || asks.length || notCounted.has(e.id) || maybeTwice.has(e.id) ? (
                      <p className="mt-1 flex flex-wrap gap-1.5">
                        {notCounted.has(e.id) ? <Badge tone="gray">{ASILPOS_IKRAM_TEXT.notCounted}</Badge> : null}
                        {maybeTwice.has(e.id) ? (
                          // Uzun uyarı: telefonda satıra sığsın diye kırılır
                          <Badge tone="amber" className="rounded-lg whitespace-normal">
                            {ASILPOS_IKRAM_TEXT.maybeTwice}
                          </Badge>
                        ) : null}
                        {lateBadges[e.id] ? <Badge tone="gray">{lateBadges[e.id]}</Badge> : null}
                        {asks.map((a) => (
                          <Badge key={a.requestId} tone="amber">
                            {a.by} silinmesini istedi
                          </Badge>
                        ))}
                      </p>
                    ) : null}
                  </div>
                  {mineAsk ? (
                    <Button size="sm" variant="ghost" onClick={() => withdraw(mineAsk.requestId)} disabled={pending} className="min-h-11 sm:min-h-8">
                      <Undo2 size={14} /> {T.withdraw}
                    </Button>
                  ) : del === "direct" ? (
                    <IconButton label={`${e.name} kaydını sil`} tone="danger" onClick={() => setRemoving(e)} disabled={pending}>
                      <Trash2 size={15} />
                    </IconButton>
                  ) : del === "request" ? (
                    <Button size="sm" variant="secondary" onClick={() => setAsking(e)} disabled={pending} className="min-h-11">
                      {T.deleteAsk}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border-t border-line px-5 py-6 text-sm text-ink-mute">
            {asilpos?.closed
              ? "Atılan bir şey ya da hammadde ikramı olduysa buraya girin; ürün ikramı AsilPOS'ta işaretlenir. Ay sonu stok farkı böyle açıklanır."
              : "Atılan ya da ikram edilen her şeyi buraya girin; ay sonu stok farkı böyle açıklanır."}
          </p>
        )}
        {asilpos ? (
          // AsilPOS'un ikram ve zayi satırları salt okunur: kasada işaretlendi, tüketime oradan girer
          <section aria-label={ASILPOS_IKRAM_TEXT.listTitle} className="border-t border-line px-5 py-4">
            <h3 className="text-sm font-semibold text-ink">
              {ASILPOS_IKRAM_TEXT.listTitle}
              {asilpos.branchName ? ` · ${asilpos.branchName}` : ""}
            </h3>
            {!asilpos.received ? (
              <p className="mt-1 text-sm text-ink-mute">{asilpos.past ? ASILPOS_IKRAM_TEXT.waitingPast : ASILPOS_IKRAM_TEXT.waiting}</p>
            ) : asilpos.lines.length ? (
              <ul className="mt-2 space-y-2">
                {asilpos.lines.map((l, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 text-sm">
                    <Badge tone={l.kind === "zayi" ? "red" : "blue"}>{WASTE_KIND_LABEL[l.kind]}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words text-ink">
                        {l.name} <span className="font-normal text-ink-mute tabular">· {qtyText(l.qty, "adet")}</span>
                      </p>
                      {l.reason || l.unmatched || l.service ? (
                        <p className="text-xs break-words text-ink-mute">
                          {[l.reason, l.unmatched ? ASILPOS_IKRAM_TEXT.unmatched : null, l.service ? ASILPOS_IKRAM_TEXT.service : null].filter(Boolean).join(" · ")}
                          {l.unmatched && asilpos.settingsHref ? (
                            <>
                              {" · "}
                              <Link href={asilpos.settingsHref} className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
                                Ayarlar › AsilPOS&apos;ta bağlayın
                              </Link>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                    {l.menuValue !== null ? <span className="text-xs text-ink-mute tabular">{tl(l.menuValue)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-ink-mute">{ASILPOS_IKRAM_TEXT.none}</p>
            )}
          </section>
        ) : null}
      </Card>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        pending={pending}
        title={removing ? `${removing.name} kaydı silinsin mi?` : "Kayıt silinsin mi?"}
        description="Yanlış girildiyse silin; stok tutarlılığından da çıkar."
        confirmLabel="Sil"
      />
      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={asking ? `${asking.name} kaydının silinmesini isteyin` : T.deleteAsk}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsking(null)} disabled={pending} className="max-sm:bg-panel">
              Vazgeç
            </Button>
            <Button variant="danger" onClick={askDelete} disabled={pending}>
              {pending ? "Gönderiliyor…" : T.deleteAsk}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-mute">Yönetici onaylarsa kayıt silinir; o zamana kadar listede kalır.</p>
          <Field label={T.reasonLabel} htmlFor="zi-sil-neden" hint="zorunlu">
            <Textarea id="zi-sil-neden" value={askReason} onChange={(e) => setAskReason(e.target.value)} rows={2} maxLength={300} placeholder="ör. iki kez girilmiş" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
