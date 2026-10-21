"use client";

import { LogOut, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CardContent, CardHeader } from "@/components/ui/card";
import { signOutOtherSessions } from "@/server/actions/auth";

import { ConfirmPasswordDialog } from "./confirm-password";

/**
 * Oturumlar: başka cihazda (kasa bilgisayarı, tablet, kaybolan telefon) açık kalmış oturumları parolayı değiştirmeden
 * kapatır. Bu cihaz açık kalır; o cihazların "bilinen cihaz" kaydı da geçersiz olur.
 */
export function SessionsCard() {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <CardHeader
        icon={<MonitorSmartphone />}
        title="Oturumlar"
        description="Başka bir cihazda (kasa bilgisayarı, tablet, kaybolan telefon) açık kalmış oturumlarınızı kapatır. Bu cihazda açık kalırsınız."
      />
      <CardContent>
        <Button variant="secondary" onClick={() => setAsking(true)} className="w-full sm:w-auto">
          <LogOut size={16} /> Diğer cihazlardaki oturumları kapat
        </Button>
      </CardContent>
      {asking ? (
        <ConfirmPasswordDialog
          title="Diğer cihazlardaki oturumlar kapatılsın mı?"
          description="Bu cihaz dışındaki bütün tarayıcılarda panelden çıkış yapılır; oralarda yeniden giriş gerekir."
          confirmLabel="Oturumları kapat"
          onClose={() => setAsking(false)}
          onConfirm={async (password) => {
            const res = await signOutOtherSessions(password);
            if (!res.ok) return res.error;
            toast.success("Diğer cihazlardaki oturumlar kapatıldı");
            setAsking(false);
            return null;
          }}
        />
      ) : null}
    </>
  );
}
