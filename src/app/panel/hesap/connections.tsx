"use client";

import { ChevronDown, Copy, PlugZap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CallView, ConnectionView } from "@/lib/mcp/oauth";
import { revokeAllConnections, revokeConnection } from "@/server/actions/mcp";

/**
 * Hesabım › Bağlı uygulamalar (yalnız yönetici; docs/CLAUDE-BAGLANTISI.md): Claude'un panele salt okunur bağlantıları,
 * kaldırma ve son sorular. Bağlantı kaldırılınca Claude'un anahtarları hemen geçersiz olur; yeniden bağlamak için
 * Claude'da "Bağlan" gerekir. Bu bileşen istemci kimliğini ya da anahtarı hiç almaz.
 */
export function ConnectionsCard({ rows, calls, mcpUrl }: { rows: ConnectionView[]; calls: CallView[]; mcpUrl: string }) {
  const [confirm, setConfirm] = useState<ConnectionView | "all" | null>(null);
  const [pending, start] = useActionTransition();

  function run() {
    const target = confirm;
    if (!target) return;
    start(async () => {
      const res = target === "all" ? await revokeAllConnections() : await revokeConnection(target.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setConfirm(null);
      toast.success(target === "all" ? "Bağlantılar kaldırıldı" : "Bağlantı kaldırıldı");
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      toast.success("Adres kopyalandı");
    } catch {
      toast.error("Kopyalanamadı; adresi elle seçip kopyalayın");
    }
  }

  return (
    <>
      <CardHeader
        icon={<PlugZap />}
        title="Bağlı uygulamalar"
        description="Claude gibi uygulamalar panelinizi yalnız okuyabilir, değişiklik yapamaz. Bağlantıyı buradan kaldırabilirsiniz."
      />
      <CardContent className="space-y-3">
        {rows.length ? (
          <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold break-words text-ink">{r.label}</span>
                    <Badge tone="gray">{r.host}</Badge>
                  </p>
                  {/* Telefonda satır yalnız ayraçlarda kırılır ("Son kullanım" ile tarihi ayrılmaz) */}
                  <p className="mt-1 text-[13px] leading-5 text-ink-mute">
                    <span className="whitespace-nowrap">
                      Bağlandı: <span className="tabular">{r.connected}</span>
                    </span>{" "}
                    ·{" "}
                    <span className="whitespace-nowrap">
                      {r.lastUsed ? (
                        <>
                          Son kullanım: <span className="tabular">{r.lastUsed}</span>
                        </>
                      ) : (
                        "Henüz kullanılmadı"
                      )}
                    </span>{" "}
                    ·{" "}
                    <span className="whitespace-nowrap">
                      Sona erer: <span className="tabular">{r.expires}</span>
                    </span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-bad hover:bg-bad-soft hover:text-bad max-sm:h-11"
                  disabled={pending}
                  onClick={() => setConfirm(r)}
                  aria-label={`${r.label} (${r.host}) bağlantısını kaldır`}
                >
                  Kaldır
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-sm text-ink-soft">Bağlı uygulama yok.</p>
            <Well className="space-y-3 text-sm leading-6 text-ink-soft ring-1 ring-line">
              {/* Claude'un menü adları İngilizce (Anthropic'in belgesindeki gibi); bağlantı doğrudan o sayfayı açar */}
              <p>
                Claude&apos;dan panele soru sormak için Claude&apos;da (web ya da masaüstü){" "}
                <a href="https://claude.ai/customize/connectors" target="_blank" rel="noopener noreferrer" className="font-semibold whitespace-nowrap text-ink underline underline-offset-2">
                  Customize › Connectors
                </a>{" "}
                sayfasında <strong className="font-semibold text-ink">Add custom connector</strong> düğmesine basıp bu adresi girin:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 rounded-xl bg-panel px-3 py-2 font-mono text-[13px] break-all text-ink select-all">{mcpUrl}</code>
                <Button variant="secondary" size="sm" onClick={copy}>
                  <Copy size={14} /> Kopyala
                </Button>
              </div>
              {/* Yardım'daki soru aramayla açılır (?ara=, ilk eşleşen cevap açık gelir) */}
              <Link
                href={`/panel/yardim?ara=${encodeURIComponent("Claude'dan panele")}`}
                className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-2 sm:min-h-0"
              >
                Nasıl yapılır? → Yardım
              </Link>
            </Well>
          </>
        )}

        {rows.length || calls.length ? (
          <details className="group/calls rounded-2xl bg-surface ring-1 ring-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium text-ink outline-none select-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
              Son sorular ({calls.length})
              <ChevronDown size={16} className="shrink-0 text-ink-quiet transition-transform group-open/calls:rotate-180" aria-hidden="true" />
            </summary>
            {calls.length ? (
              <ul className="divide-y divide-ink/[0.06] px-4 pb-2">
                {calls.map((c, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2 text-[13px] leading-5">
                    <span className="min-w-0 break-words text-ink-soft">
                      <span className="tabular text-ink-mute">{c.when}</span> · {c.summary}
                    </span>
                    {c.ok ? null : (
                      <Badge tone="red" className="shrink-0">
                        hata
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 pb-3 text-[13px] text-ink-mute">Henüz soru yok.</p>
            )}
          </details>
        ) : null}

        <p className="text-[13px] leading-5 text-pretty text-ink-mute">
          Parolanızı değiştirince, iki adımlı doğrulamayı açıp kapatınca ya da diğer cihazlardaki oturumları kapatınca Claude bağlantısı da kapanır.
        </p>
      </CardContent>
      {rows.length >= 2 ? (
        <CardFooter>
          <span>{rows.length} bağlı uygulama</span>
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirm("all")} className="max-sm:h-11">
            Hepsini kaldır
          </Button>
        </CardFooter>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => (pending ? undefined : setConfirm(null))}
        onConfirm={run}
        pending={pending}
        title={confirm === "all" ? "Bütün bağlantılar kaldırılsın mı?" : "Claude bağlantısı kaldırılsın mı?"}
        description={
          confirm === "all"
            ? `${rows.length} uygulama panelinizi bir daha okuyamaz.`
            : "Claude panelinizi bir daha okuyamaz. Yeniden bağlamak için Claude'da bağlayıcıya tekrar “Bağlan” demeniz gerekir."
        }
        confirmLabel={confirm === "all" ? "Hepsini kaldır" : "Bağlantıyı kaldır"}
      />
    </>
  );
}
