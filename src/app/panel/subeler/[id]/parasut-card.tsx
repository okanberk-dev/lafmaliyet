"use client";

import { Link2, PlugZap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { ToggleRow } from "@/components/ui/toggle-row";
import { setBranchSettingLink } from "@/server/actions/branch-settings";
import { chooseBranchScope } from "@/server/actions/branches";
import type { ParasutLinkCardData } from "@/server/parasut/link-card";

/**
 * Şube ayarları › Paraşüt hesabı (docs/PARASUT.md › Şube başına Paraşüt hesabı). "Diğer şubeyle aynı" açıkken şube
 * bağlandığı şubenin Paraşüt hesabını kullanır: tek bağlantı, tek eşitleme, faturanın şubesi tedarikçinin varsayılanından. Kapatılınca
 * hiçbir şey kopyalanmaz (aynı firma iki kez eşitlenmesin): şube boş bir hesapla başlar, bağlantısı Paraşüt ekranında
 * kurulur; o hesaptan gelen faturalar şubenindir. Hesabın ayarları ve sırrı bu ekrana hiç gelmez, yalnız durum.
 */
export function ParasutLinkCard({ data }: { data: ParasutLinkCardData }) {
  const router = useRouter();
  const [pending, start] = useActionTransition();
  const [confirm, setConfirm] = useState<null | "link" | "own">(null);
  const [target, setTarget] = useState(data.targets[0]?.id ?? "");
  const linked = data.mode.kind === "linked";
  const here = data.branchName;
  const targetName = data.targets.find((t) => t.id === target)?.name ?? data.targets[0]?.name ?? "";
  const acc = data.account;

  function changeLink(to: "link" | "own") {
    start(async () => {
      const res = await setBranchSettingLink({ branchId: data.branchId, group: "parasut", sameAs: to === "link" ? target : null });
      if (!res.ok) return void toast.error(res.error);
      setConfirm(null);
      toast.success(to === "link" ? `${here} artık ${targetName} ile aynı Paraşüt hesabını kullanıyor` : `${here} için ayrı Paraşüt hesabı açıldı`, {
        description: to === "link" ? undefined : "Paraşüt ekranında bu şubeyi seçip hesabın bilgilerini girin ve bağlayın.",
      });
    });
  }

  /** Paraşüt ekranı seçili şubenin hesabını gösterir: önce seçim bu şubeye geçer */
  function openParasut() {
    start(async () => {
      const res = await chooseBranchScope({ scope: data.branchId });
      if (!res.ok) return void toast.error(res.error);
      router.push("/panel/parasut");
    });
  }

  const status = acc.connected ? { tone: "green" as const, text: "Bağlı" } : acc.configured ? { tone: "amber" as const, text: "Bağlı değil" } : { tone: "gray" as const, text: "Kurulmadı" };

  return (
    <Card id="parasut" className="scroll-mt-20">
      <CardHeader icon={<PlugZap />} title="Paraşüt hesabı" description="Faturaların geldiği Paraşüt firması. Şubeler aynı firmadaysa tek bağlantı, tek eşitleme." />
      <div className="space-y-3 px-5 pb-5">
        {data.many && (linked || data.targets.length) ? (
          <ToggleRow
            title={linked ? `${data.toName} ile aynı` : data.targets.length === 1 ? `${targetName} ile aynı` : "Diğer şubeyle aynı"}
            description={
              linked
                ? `${here}, ${data.toName} şubesinin Paraşüt hesabını kullanır; faturanın şubesi tedarikçiden`
                : data.hasInvoices
                  ? "Bu şubenin kendi hesabından fatura geldi; başka şubenin hesabına bağlanamaz"
                  : "Açarsanız bu şubenin Paraşüt bağlantısı silinir, seçtiğiniz şubeninki kullanılır"
            }
            label="Diğer şubeyle aynı Paraşüt hesabı"
            checked={linked}
            disabled={pending || (!linked && data.hasInvoices)}
            onChange={(v) => setConfirm(v ? "link" : "own")}
          />
        ) : null}
        {data.sharedWith.length ? (
          <p className="flex items-start gap-2 text-[13px] text-ink-mute">
            <Link2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {data.sharedWith.join(", ")} {data.sharedWith.length > 1 ? "şubeleri" : "şubesi"} de bu hesabı kullanıyor: tek bağlantı, tek eşitleme.
            </span>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
          <Badge tone={status.tone} dot>
            {status.text}
          </Badge>
          <span className="min-w-0 flex-1 basis-48 text-[13px] text-ink-mute">
            {linked ? `${acc.name} şubesinin hesabı` : `${here} şubesinin hesabı`}
            {acc.companyId ? ` · firma ${acc.companyId}` : ""}
          </span>
          <Button variant="secondary" size="sm" onClick={openParasut} disabled={pending} className="max-sm:w-full">
            {linked ? `${acc.name} hesabını aç` : "Paraşüt ekranında aç"}
          </Button>
        </div>
        {!linked && !acc.configured && data.many ? (
          <Notice
            tone="neutral"
            size="sm"
            title="Ayrı hesap henüz bağlanmadı"
            text={`Paraşüt ekranında ${here} seçiliyken DevHub bilgilerini girip “Paraşüt hesabını bağla”ya basın. Bu hesaptan gelen faturalar ${here} şubesinin olur.`}
          />
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm === "own"}
        onClose={() => setConfirm(null)}
        onConfirm={() => changeLink("own")}
        pending={pending}
        tone="primary"
        confirmLabel="Ayır"
        title={`${here} ayrı bir Paraşüt hesabı kullansın mı?`}
        description={`Hiçbir şey kopyalanmaz: aynı firma iki kez eşitlenirse faturalar çiftlenir. ${here} boş bir hesapla başlar; Paraşüt ekranında bilgilerini girip bağlayın. ${data.toName ?? "Öbür şube"} kendi hesabıyla sürer.`}
      />
      <ConfirmDialog
        open={confirm === "link"}
        onClose={() => setConfirm(null)}
        onConfirm={() => changeLink("link")}
        pending={pending}
        tone="primary"
        confirmLabel="Aynı yap"
        title={`${here} ve ${data.targets.length > 1 ? "seçilen şube" : targetName} aynı Paraşüt hesabını kullansın mı?`}
        description={
          <div className="space-y-3">
            <p>
              {here} şubesinin Paraşüt bağlantısı ve eşitleme durumu silinir; faturalar {targetName} şubesinin hesabından gelir; şubesi tedarikçinin varsayılanından (yoksa “Şubesi seçilmemiş”).
            </p>
            {data.targets.length > 1 ? (
              <Field label="Hangi şubeyle aynı" htmlFor="parasut-hedef">
                <Select id="parasut-hedef" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {data.targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        }
      />
    </Card>
  );
}
