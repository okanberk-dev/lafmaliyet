import { readFileSync } from "node:fs";
import { createModel } from "/home/user/lafmaliyet/src/lib/calc/engine";
import { excelToDataset, type ExcelData } from "/home/user/lafmaliyet/src/server/db/seed/excel";
import { SEPARATE_CATEGORIES } from "/home/user/lafmaliyet/src/lib/constants";

const data: ExcelData = JSON.parse(readFileSync("/home/user/lafmaliyet/src/server/db/seed/excel-data.json", "utf8"));
const ds = excelToDataset(data);
const model = createModel({ ...ds, currentMonth: "2026-10" });
const st = model.settings;
console.log("settings kdv", st.kdv, st.kdvHizmet, "acikGun", st.acikGun);
console.log("months", ds.months.map((m) => [m.month, m.openDays, m.posRevenue]));
const cats = new Map<string, { n: number; vat: number }>();
for (const m of ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) {
  const pm = model.pnlMonth(m);
  const ms = model.monthSales(m);
  const invs = ds.invoices.filter((i) => i.date.startsWith(m));
  const vatAll = invs.reduce((s, i) => s + (i.payable - (i.amount - i.discount)), 0);
  const vatCafe = invs.filter((i) => !SEPARATE_CATEGORIES.includes(i.category)).reduce((s, i) => s + (i.payable - (i.amount - i.discount)), 0);
  const sep = invs.filter((i) => SEPARATE_CATEGORIES.includes(i.category));
  console.log(m, { R: pm.revenue, S: pm.serviceRevenue, Rnet: pm.revenueNet, posVat: pm.revenue === null ? null : pm.revenue - (pm.revenueNet ?? 0), msService: ms.serviceRevenue, invoices: invs.length, vatAll: Math.round(vatAll), vatCafe: Math.round(vatCafe), sepCount: sep.length, sepVat: Math.round(sep.reduce((s, i) => s + (i.payable - (i.amount - i.discount)), 0)) });
  for (const i of invs) {
    const c = cats.get(i.category) ?? { n: 0, vat: 0 };
    c.n++; c.vat += i.payable - (i.amount - i.discount);
    cats.set(i.category, c);
  }
}
console.log(cats);
console.log("site", (ds.siteSales ?? []).length, "neg/odd invoices", ds.invoices.filter((i) => i.payable - (i.amount - i.discount) < -0.01).map((i) => [i.date, i.supplier, i.category, i.amount, i.discount, i.payable]));
console.log("big", ds.invoices.filter((i) => i.payable - (i.amount - i.discount) > 5000).map((i) => [i.date, i.supplier, i.category, Math.round(i.payable - (i.amount - i.discount))]));
