import { FileArchive } from "lucide-react";

import { CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { businessDate } from "@/lib/cash-report";
import { monthTitle, prevMonth } from "@/lib/closed-period";
import { dateTimeTR } from "@/lib/format";
import { BLOCK_ROW_TEXT } from "@/lib/notify-recipients";
import { selectedBranchRow } from "@/server/branch-scope";
import { getDb } from "@/server/db";
import { loadPackageSettings } from "@/server/muhasebe/paket";
import { sendableRecipients } from "@/server/notify/recipients";
import { isEmailConfigured } from "@/server/notify/resend";

import { PackageOptions } from "./package-client";
import { SectionCard } from "./section-card";

/** Seçilebilen aylar: geçen aydan geriye 12 ay */
const MONTHS = 12;

/**
 * Ayarlar › Muhasebeci paketi (docs/MUHASEBE-PAKETI.md): ayın faturaları, harcamaları, kasa raporları, yazarkasa Z KDV
 * dökümü ve sabit giderleri tek .xlsx'te; muhasebeci alıcıları, ay kapanınca kendiliğinden e-posta, "Şimdi gönder" ve son
 * gönderim. Kayıtlı alıcılardan personel, müdür ya da pasif hesabın adresi gönderimde düşer (kayıttan sonra müdüre
 * indirilen hesap; docs/BILDIRIMLER.md › Alıcılar ve hesaplar): kartta adıyla söylenir (zilde de)
 */
export async function PackageCard() {
  const [settings, branch] = await Promise.all([loadPackageSettings(), selectedBranchRow()]);
  const { dropped } = await sendableRecipients(getDb(), settings.recipients);
  const months: { month: string; title: string }[] = [];
  let m = prevMonth(businessDate().slice(0, 7));
  for (let i = 0; i < MONTHS; i++, m = prevMonth(m)) months.push({ month: m, title: monthTitle(m) });
  const emailReady = isEmailConfigured();
  const last = settings.last;
  const summary = !settings.recipients.length ? "Alıcı yok: e-posta gitmez" : last ? `Son: ${monthTitle(last.month)} · ${dateTimeTR(last.at)}` : `${settings.recipients.length} alıcı · ${settings.auto ? "ay kapanınca gider" : "elle gönderilir"}`;
  return (
    <SectionCard
      id="muhasebe"
      icon={<FileArchive />}
      title="Muhasebeci paketi"
      summary={summary}
      description="Ayın faturaları, harcamaları, kasa raporları, yazarkasa Z'lerinin KDV dökümü ve sabit giderleri tek çalışma kitabında (.xlsx). Ay kapanınca muhasebeciye ekli e-postayla gider; istediğiniz ayı indirip ya da şimdi gönderebilirsiniz."
    >
      <CardContent className="space-y-3">
        {!emailReady ? <Notice tone="neutral" size="sm" title="E-posta kurulmadı (RESEND_API_KEY)" text="Paket indirilebilir; e-posta gitmez." /> : null}
        {dropped.length ? (
          <Notice
            tone="bad"
            size="sm"
            title="Bu adreslere paket gitmez"
            text={
              <>
                {dropped.map((d) => (
                  <span key={d.email} className="block break-words">
                    <span className="font-medium text-ink">{d.email}</span>: {BLOCK_ROW_TEXT[d.reason].toLocaleLowerCase("tr-TR")}
                  </span>
                ))}
                <span className="block">
                  {dropped.some((d) => d.reason !== "inactive") ? "Pakette bütün şubelerin faturaları, maaş ve kira harcamaları var; personel ve müdür hesabına gitmez." : "Pasif hesaba e-posta gitmez."}{" "}
                  {dropped.length > 1 ? "Bu adresleri" : "Bu adresi"} listeden çıkarın ya da doğru adresi yazın.
                </span>
              </>
            }
          />
        ) : null}
        <PackageOptions recipients={settings.recipients} auto={settings.auto} months={months} emailReady={emailReady} branch={branch ? { id: branch.id, name: branch.name } : null} />
        {last ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink ring-1 ring-line">
            <span className="text-ink-mute">Son gönderim:</span> {monthTitle(last.month)} paketi · {dateTimeTR(last.at)} · {last.by} → {last.to.join(", ")}
          </p>
        ) : null}
      </CardContent>
    </SectionCard>
  );
}
