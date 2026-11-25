"use client";

import { CreditCard } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { TILL_DEVICES, type TillDevice, type TillDeviceSetting } from "@/lib/branch-settings/groups";
import { saveTillDevice } from "@/server/actions/branch-settings";
import type { BranchSettingView } from "@/server/branch-settings-view";

/**
 * Şube ayarları › Banka POS ve yazarkasa (şube ayarı kasa.cihaz; docs/SUBE.md › Şube başına ayarlar): cihaz şubenin
 * kendisinin, "Diğer şubeyle aynı" yok. Kasa raporu e-postasının yazarkasa başlığı ("Pavo · sicil AB123"), akşam
 * hatırlatmasının "gün sonu fişi" metni ve LafPOS cihazı henüz göndermediyse fotoğraf okuması bunu kullanır. Boşken her
 * şey bugünkü gibi.
 */
export function TillDeviceCard({ view, lafpos }: { view: BranchSettingView<TillDeviceSetting>; lafpos: boolean }) {
  const [device, setDevice] = useState<TillDevice | "">(view.value.device ?? "");
  const [registerNo, setRegisterNo] = useState(view.value.registerNo ?? "");
  const [bank, setBank] = useState(view.value.bank ?? "");
  const [pending, start] = useActionTransition();
  const dirty = device !== (view.value.device ?? "") || registerNo.trim() !== (view.value.registerNo ?? "") || bank.trim() !== (view.value.bank ?? "");

  function save() {
    start(async () => {
      const res = await saveTillDevice({ branchId: view.branchId, device: device || null, registerNo: registerNo.trim() || null, bank: bank.trim() || null });
      if (!res.ok) return void toast.error(res.error);
      setRegisterNo(res.data.registerNo ?? "");
      setBank(res.data.bank ?? "");
      toast.success("Banka POS ve yazarkasa kaydedildi");
    });
  }

  return (
    <Card id="cihaz" className="scroll-mt-20">
      <CardHeader icon={<CreditCard />} title="Banka POS ve yazarkasa" description="Şubenin banka POS'u, yazarkasanın sicil numarası ve bankası. Kasa raporu e-postasında yazarkasa bölümünün başlığında görünür." />
      <div className="space-y-3 px-5 pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Cihaz"
            htmlFor="cihaz-tur"
            hint={lafpos ? "Boşsa LafPOS'un gönderdiği cihaz (gelmediyse Pavo)" : "Kasa raporu e-postasının yazarkasa başlığında görünür"}
          >
            <Select id="cihaz-tur" value={device} onChange={(e) => setDevice(e.target.value as TillDevice | "")} className="pointer-coarse:h-12">
              <option value="">Belirtilmedi</option>
              {TILL_DEVICES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Yazarkasa sicil no" htmlFor="cihaz-sicil" hint="Cihazın arkasında ya da Z fişinin başında">
            <Input id="cihaz-sicil" value={registerNo} onChange={(e) => setRegisterNo(e.target.value)} maxLength={40} autoComplete="off" spellCheck={false} className="pointer-coarse:h-12" />
          </Field>
          <Field label="Bankası" htmlFor="cihaz-banka" hint="İsteğe bağlı" className="sm:col-span-2">
            <Input id="cihaz-banka" value={bank} onChange={(e) => setBank(e.target.value)} maxLength={60} autoComplete="off" placeholder="ör. Garanti BBVA" className="pointer-coarse:h-12" />
          </Field>
        </div>
        <Button onClick={save} disabled={pending || !dirty} className="max-sm:w-full">
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>
    </Card>
  );
}
