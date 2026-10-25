"use client";

import { AlarmClock, Banknote, CircleAlert, Link2, Wallet, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { dateTR, tl } from "@/lib/format";
import { cn } from "@/lib/utils";

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
}

const TONE = {
  good: "bg-good-soft text-good-ink",
  info: "bg-info-soft text-info",
  warn: "bg-warn-soft text-warn",
  gray: "bg-panel text-ink-soft ring-1 ring-line",
} as const;

function Strip({ icon, tone, children, actions }: { icon: ReactNode; tone: keyof typeof TONE; children: ReactNode; actions: ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-3 text-[13px] leading-5", TONE[tone])} role="status">
      <span className="shrink-0 [&>svg]:size-4" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-[14rem] flex-1">{children}</span>
      <span className="flex flex-wrap gap-2 max-sm:w-full max-sm:[&>*]:flex-1">{actions}</span>
    </div>
  );
}

/**
 * Tedarikçi sayfasının cari şeritleri (§6.1), öncelik sırasıyla: hesapta sayılmamış ödeme, faturası gelmiş olabilecek
 * alımlar, faturası 45 gündür gelmeyen alımlar, kasadan işlenmemiş ödemeler, başka tedarikçideki faturaya sayılan
 * ödeme ve dağıtım toplamı tutmayan faturalar.
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
  const strips: ReactNode[] = [];
  if (credit > 0.005 && hasOpen) {
    strips.push(
      <Strip
        key="hesap"
        icon={<Wallet />}
        tone="good"
        actions={
          <Button size="sm" variant="secondary" onClick={onApplyCredit} disabled={busy} className="text-ink">
            Borçlara say
          </Button>
        }
      >
        Hesapta {tl(credit, 2)} sayılmamış ödeme var.
      </Strip>,
    );
  }
  for (const c of candidates) {
    strips.push(
      <Strip
        key={`aday-${c.invoiceId}-${c.debtIds.join(".")}`}
        icon={<Link2 />}
        tone={c.strong ? "info" : "gray"}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => onLink(c)} disabled={busy} className="text-ink">
              Bağla
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDismissCandidate(c)} disabled={busy}>
              Ayrı alım
            </Button>
          </>
        }
      >
        {c.strong ? "Faturası gelmiş olabilir" : "Faturası gelmiş olabilir (tutar farklı)"}: {dateTR(c.date).slice(0, 5)} · {c.label} · {tl(c.payable, 2)}
        {c.strong ? "" : ` · alımlar ${tl(c.debtTotal, 2)}`}
      </Strip>,
    );
  }
  for (const d of late) {
    strips.push(
      <Strip
        key={`gec-${d.id}`}
        icon={<AlarmClock />}
        tone="warn"
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => onLateExpense(d.id)} disabled={busy} className="text-ink">
              Gider olarak yaz
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onSnooze(d.id)} disabled={busy}>
              Beklemeye devam
            </Button>
          </>
        }
      >
        Faturası 45 gündür gelmedi: {dateTR(d.date).slice(0, 5)} · {d.label} · {tl(d.amount, 2)}
      </Strip>,
    );
  }
  const teslim = kasa.filter((l) => l.kind === "teslim");
  const fissiz = kasa.filter((l) => l.kind === "harcama");
  for (const l of teslim) {
    strips.push(
      <Strip
        key={`kasa-${l.id}`}
        icon={<Banknote />}
        tone="info"
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => onProcessKasa(l)} disabled={busy} className="text-ink">
              İşle
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onKeepApart(l)} disabled={busy}>
              Ayrı tut
            </Button>
          </>
        }
      >
        Kasadan bu tedarikçiye ödeme hesaba işlenmedi: {dateTR(l.date).slice(0, 5)} {kasaLineText(l)}
      </Strip>,
    );
  }
  for (const l of fissiz) {
    strips.push(
      <Strip
        key={`kasa-${l.id}`}
        icon={<Banknote />}
        tone="gray"
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => onConvertKasa(l)} disabled={busy} className="text-ink">
              Ödemeye çevir
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onKeepApart(l)} disabled={busy}>
              Ayrı alım
            </Button>
          </>
        }
      >
        Tedarikçi ödemesi miydi? {dateTR(l.date).slice(0, 5)} · fişsiz alışveriş · {l.store} · {tl(l.amount, 2)} · {l.createdByName}
      </Strip>,
    );
  }
  for (const f of foreign) {
    strips.push(
      <Strip
        key={`baska-${f.paymentId}`}
        icon={<CircleAlert />}
        tone="warn"
        actions={
          <Button size="sm" variant="secondary" onClick={() => onRemoveForeign(f)} disabled={busy} className="text-ink">
            Ödemeden çıkar
          </Button>
        }
      >
        Bu tedarikçinin bir ödemesinin {tl(f.amount, 2)}&apos;si başka tedarikçide görünen bir faturaya sayılı.
      </Strip>,
    );
  }
  if (drift) {
    strips.push(
      <Strip
        key="sapma"
        icon={<Wrench />}
        tone="warn"
        actions={
          <Button size="sm" variant="secondary" onClick={onFixDrift} disabled={busy} className="text-ink">
            Düzelt
          </Button>
        }
      >
        Dağıtım toplamı tutmuyor ({drift} fatura).
      </Strip>,
    );
  }
  if (!strips.length) return null;
  return <div className="mb-4 space-y-2">{strips}</div>;
}
