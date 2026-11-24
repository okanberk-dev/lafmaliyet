"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Notice, type NoticeItem, type NoticeTone } from "@/components/ui/notice";
import { dateTR, tl } from "@/lib/format";

import { kasaLineText } from "../cari-payment-dialog";

/** Şeritteki fatura adayı (K17) */
export interface CandidateStrip {
  invoiceId: number;
  debtIds: number[];
  date: string;
  label: string;
  payable: number;
  debtTotal: number;
  strong: boolean;
}

export interface KasaStrip {
  id: number;
  date: string;
  kind: "harcama" | "teslim";
  amount: number;
  store: string | null;
  createdByName: string;
  /** Kasanın şubesi; birden çok kasa açıkken (`namedTill`), tek kasada null */
  tillName: string | null;
  /** Seçili şubenin kasasından mı ("Tümü"de hepsi); değilse şerit yalnız sayar */
  inScope: boolean;
}

// Şeridin tonu: mavi artık uyarı rengi değil (öneri ve bilgi nötr); borç ve ödeme uyarıları para riski taşır, katlanmaz
const STRIP_TONE = { good: "good", info: "neutral", warn: "warn", gray: "neutral" } as const satisfies Record<string, NoticeTone>;

/** Bir şerit: başlık + düğmeler (docs/planlar/ux-sade.md §6.2; eski yerel Strip) */
function strip(key: string, tone: keyof typeof STRIP_TONE, title: ReactNode, action: ReactNode): NoticeItem {
  const t = STRIP_TONE[tone];
  return { key, tone: t, risk: t === "warn" ? "para" : undefined, live: "polite", title, action: action ? <span className="flex flex-wrap gap-1.5">{action}</span> : undefined };
}

/**
 * Tedarikçi sayfasının cari şeritleri (§6.1), öncelik sırasıyla: hesapta sayılmamış ödeme, faturası gelmiş olabilecek
 * alımlar, faturası 45 gündür gelmeyen alımlar, kasadan işlenmemiş ödemeler, başka tedarikçideki faturaya sayılan
 * ödeme ve dağıtım toplamı tutmayan faturalar. Her şerit kendi düğmeleriyle, yazıldığı sırada görünür (Ek A 201):
 * NoticeGroup değil, çünkü her biri yapılacak bir iş; katlanır ya da tona göre yeniden sıralanırsa "Borçlara say"
 * gibi eylemler "+N not daha"nın arkasına düşer.
 */
export function CariStrips({
  credit,
  hasOpen,
  candidates,
  late,
  kasa,
  foreign,
  drift,
  busy,
  onApplyCredit,
  onLink,
  onDismissCandidate,
  onLateExpense,
  onSnooze,
  onProcessKasa,
  onConvertKasa,
  onKeepApart,
  onRemoveForeign,
  onFixDrift,
}: {
  credit: number;
  hasOpen: boolean;
  candidates: CandidateStrip[];
  late: { id: number; date: string; label: string; amount: number }[];
  kasa: KasaStrip[];
  foreign: { paymentId: number; allocationIds: number[]; amount: number }[];
  drift: number;
  busy: boolean;
  onApplyCredit: () => void;
  onLink: (c: CandidateStrip) => void;
  onDismissCandidate: (c: CandidateStrip) => void;
  onLateExpense: (id: number) => void;
  onSnooze: (id: number) => void;
  onProcessKasa: (l: KasaStrip) => void;
  /** Fişsiz alışveriş satırı aslında tedarikçiye ödemeydi (K14) */
  onConvertKasa: (l: KasaStrip) => void;
  onKeepApart: (l: KasaStrip) => void;
  onRemoveForeign: (f: { paymentId: number; allocationIds: number[]; amount: number }) => void;
  onFixDrift: () => void;
}) {
  const strips: NoticeItem[] = [];
  if (credit > 0.005 && hasOpen) {
    strips.push(
      strip(
        "hesap",
        "good",
        `Hesapta ${tl(credit, 2)} sayılmamış ödeme var.`,
        <Button size="xs" variant="secondary" onClick={onApplyCredit} disabled={busy}>
          Borçlara say
        </Button>,
      ),
    );
  }
  for (const c of candidates) {
    strips.push(
      strip(
        `aday-${c.invoiceId}-${c.debtIds.join(".")}`,
        c.strong ? "info" : "gray",
        `${c.strong ? "Faturası gelmiş olabilir" : "Faturası gelmiş olabilir (tutar farklı)"}: ${dateTR(c.date).slice(0, 5)} · ${c.label} · ${tl(c.payable, 2)}${
          c.strong ? "" : ` · alımlar ${tl(c.debtTotal, 2)}`
        }`,
        <>
          <Button size="xs" variant="secondary" onClick={() => onLink(c)} disabled={busy}>
            Bağla
          </Button>
          <Button size="xs" variant="ghost" onClick={() => onDismissCandidate(c)} disabled={busy}>
            Ayrı alım
          </Button>
        </>,
      ),
    );
  }
  for (const d of late) {
    strips.push(
      strip(
        `gec-${d.id}`,
        "warn",
        `Faturası 45 gündür gelmedi: ${dateTR(d.date).slice(0, 5)} · ${d.label} · ${tl(d.amount, 2)}`,
        <>
          <Button size="xs" variant="secondary" onClick={() => onLateExpense(d.id)} disabled={busy}>
            Gider olarak yaz
          </Button>
          <Button size="xs" variant="ghost" onClick={() => onSnooze(d.id)} disabled={busy}>
            Beklemeye devam
          </Button>
        </>,
      ),
    );
  }
  // Seçili şubenin kasasından çıkanlar; öbür şubelerinki tek satırda sayılır (docs/SUBE.md › Ödemeler)
  const shownKasa = kasa.filter((l) => l.inScope);
  const elsewhere = kasa.length - shownKasa.length;
  const teslim = shownKasa.filter((l) => l.kind === "teslim");
  const fissiz = shownKasa.filter((l) => l.kind === "harcama");
  const till = (l: KasaStrip) => (l.tillName ? ` · ${l.tillName}` : "");
  for (const l of teslim) {
    strips.push(
      strip(
        `kasa-${l.id}`,
        // Borç bakiyesi yanlış görünür: Tedarikçiler listesindeki aynı uyarıyla aynı önemde (Ek A 227)
        "warn",
        `Kasadan bu tedarikçiye ödeme hesaba işlenmedi: ${dateTR(l.date).slice(0, 5)}${till(l)}${l.tillName ? " ·" : ""} ${kasaLineText(l)}`,
        <>
          <Button size="xs" variant="secondary" onClick={() => onProcessKasa(l)} disabled={busy}>
            İşle
          </Button>
          <Button size="xs" variant="ghost" onClick={() => onKeepApart(l)} disabled={busy}>
            Ayrı tut
          </Button>
        </>,
      ),
    );
  }
  for (const l of fissiz) {
    strips.push(
      strip(
        `kasa-${l.id}`,
        "gray",
        `Tedarikçi ödemesi miydi? ${dateTR(l.date).slice(0, 5)}${till(l)} · fişsiz alışveriş · ${l.store} · ${tl(l.amount, 2)} · ${l.createdByName}`,
        <>
          <Button size="xs" variant="secondary" onClick={() => onConvertKasa(l)} disabled={busy}>
            Ödemeye çevir
          </Button>
          <Button size="xs" variant="ghost" onClick={() => onKeepApart(l)} disabled={busy}>
            Ayrı alım
          </Button>
        </>,
      ),
    );
  }
  if (elsewhere) {
    strips.push(
      strip(
        "kasa-baska-sube",
        "gray",
        `Öbür şubenin kasasında bu tedarikçiye ${elsewhere} işlenmemiş satır daha var; Tümü'nde görünür.`,
        null,
      ),
    );
  }
  for (const f of foreign) {
    strips.push(
      strip(
        `baska-${f.paymentId}`,
        "warn",
        `Bu tedarikçinin bir ödemesinin ${tl(f.amount, 2)}'si başka tedarikçide görünen bir faturaya sayılı.`,
        <Button size="xs" variant="secondary" onClick={() => onRemoveForeign(f)} disabled={busy}>
          Ödemeden çıkar
        </Button>,
      ),
    );
  }
  if (drift) {
    strips.push(
      strip(
        "sapma",
        "warn",
        `Dağıtım toplamı tutmuyor (${drift} fatura).`,
        <Button size="xs" variant="secondary" onClick={onFixDrift} disabled={busy}>
          Düzelt
        </Button>,
      ),
    );
  }
  if (!strips.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {strips.map(({ key, ...p }) => (
        <Notice key={key} {...p} />
      ))}
    </div>
  );
}
