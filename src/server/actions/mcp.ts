"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { codeRedirect, connectionLabel, errorRedirect, GRANT_MAX_DAYS, isAllowedRedirect, loopbackAllowed, MAX_ACTIVE_GRANTS, mcpEnabled, redirectMatches } from "@/lib/mcp/oauth";
import { getCurrentUser, requireAdmin } from "@/server/auth/dal";
import { requirePassword } from "@/server/auth/step-up";
import { getDb } from "@/server/db";
import { openRequest } from "@/server/mcp/base";
import { sendConnectedNotice } from "@/server/mcp/notify";
import { activeGrantCount, findClient, issueCode, revokeAllGrants, revokeGrant } from "@/server/mcp/store";

import { logActivity } from "./log";
import { attempt, UserError } from "./util";

/*
 * Claude bağlantısının onay ekranı (/baglan) ve Hesabım › Bağlı uygulamalar. Bu dosyanın dışa açtığı her işlev
 * istemciden çağrılabilir: her biri kendi oturum ve rol denetimini yapar, yardımcı işlev dışa açılmaz.
 * İzin yalnız yönetici ve parolasıyla (bağlantı oturumdan uzun yaşar, çıkışta kapanmaz); kaldırmak parola istemez.
 */

const INVALID = "Bağlantı isteği geçersiz; Claude'dan yeniden deneyin.";
const SESSION_GONE = "Oturumunuz kapanmış; sayfayı yenileyip yeniden giriş yapın.";
const OFF = "Claude bağlantısı şu an kapalı.";

const approveSchema = z.object({
  istek: z.string().min(1, INVALID).max(4000, INVALID),
  password: z.string().max(200, "Parola hatalı"),
});

/** "İzin ver": parola doğruysa 2 dakikalık kod; istemci Claude'a (dönüş adresine) kodla döner */
export async function approveConnection(input: { istek: string; password: string }) {
  return attempt(async () => {
    if (!mcpEnabled(process.env)) throw new UserError(OFF);
    const data = approveSchema.parse(input);
    const me = await getCurrentUser();
    if (!me) throw new UserError(SESSION_GONE);
    if (me.role !== "admin") throw new UserError("Bu bağlantıyı yalnız yönetici kurabilir.");
    const req = openRequest(data.istek);
    if (!req) throw new UserError(INVALID);
    const db = getDb();
    // Sayfaya güvenilmez: istemci ve dönüş adresi yeniden denetlenir
    const client = await findClient(db, req.clientId);
    if (!client || client.id !== req.clientDbId || !redirectMatches(req.redirectUri, client.redirectUris) || !isAllowedRedirect(req.redirectUri, { loopback: loopbackAllowed(process.env) })) {
      throw new UserError(INVALID);
    }
    const user = await requirePassword(me, data.password, "Claude bağlantısı", `Claude bağlantısı: ${req.host}`);
    const now = new Date();
    if ((await activeGrantCount(db, me.id, now)) >= MAX_ACTIVE_GRANTS) throw new UserError("Çok fazla bağlı uygulama var; Hesabım'dan eskileri kaldırın.");
    const code = await issueCode(
      db,
      { userId: me.id, clientDbId: client.id, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge, scope: req.scope, resource: req.resource, sessionVersion: user.sessionVersion },
      now,
    );
    await logActivity(me, "Claude bağlantısına izin verildi", `${req.host} · salt okunur · ${GRANT_MAX_DAYS} gün`);
    const label = connectionLabel(client, req.host);
    after(() => sendConnectedNotice(me, { label, host: req.host }, code.id, now));
    return { redirectTo: codeRedirect(req.redirectUri, code.raw, req.state, req.issuer) };
  });
}

/** "Reddet": oturum gerekmez; istemciye access_denied ile dönülür (kayıt düşülmez) */
export async function denyConnection(input: { istek: string }) {
  return attempt(async () => {
    if (!mcpEnabled(process.env)) throw new UserError(OFF);
    const req = openRequest(z.object({ istek: z.string().max(4000) }).parse(input).istek);
    if (!req || !isAllowedRedirect(req.redirectUri, { loopback: loopbackAllowed(process.env) })) throw new UserError(INVALID);
    return { redirectTo: errorRedirect(req.redirectUri, "access_denied", "Kullanıcı reddetti", req.state, req.issuer) };
  });
}

const zGrantId = z.number({ message: "Bağlantı bulunamadı" }).int().positive("Bağlantı bulunamadı");

/** Hesabım › Kaldır: yalnız kendi bağlantısı; Claude bir daha okuyamaz */
export async function revokeConnection(grantId: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = zGrantId.parse(grantId);
    const closed = await revokeGrant(getDb(), { userId: me.id, grantId: id, reason: "kullanici" }, new Date());
    if (!closed) throw new UserError("Bağlantı bulunamadı");
    await logActivity(me, "Claude bağlantısı kaldırıldı", closed.host);
    refresh();
    return null;
  });
}

/** Hesabım › Hepsini kaldır */
export async function revokeAllConnections() {
  return attempt(async () => {
    const me = await requireAdmin();
    const n = await revokeAllGrants(getDb(), { userId: me.id, reason: "kullanici" }, new Date());
    if (n) await logActivity(me, "Claude bağlantıları kaldırıldı", `${n} bağlantı`);
    refresh();
    return { count: n };
  });
}
