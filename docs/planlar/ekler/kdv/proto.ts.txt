import { readFileSync } from "node:fs";
import { createModel } from "/home/user/lafmaliyet/src/lib/calc/engine";
import { excelToDataset, type ExcelData } from "/home/user/lafmaliyet/src/server/db/seed/excel";
import { SEPARATE_CATEGORIES } from "/home/user/lafmaliyet/src/lib/constants";

const round100 = (x: number) => { const r = Math.sign(x) * Math.floor(Math.abs(x) / 100 + 0.5) * 100; return r === 0 ? 0 : r; };
const posVat = (R: number, S: number, k: number, h: number) => { const s = Math.min(Math.max(R, 0), S); return (R - s) * k / (1 + k) + s * h / (1 + h); };
const dimOf = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const shift = (m: string, d: number) => { const [y, mo] = m.split("-").map(Number); const t = y * 12 + mo - 1 + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };

const data: ExcelData = JSON.parse(readFileSync("/home/user/lafmaliyet/src/server/db/seed/excel-data.json", "utf8"));
const ds = excelToDataset(data);
const model = createModel({ ...ds, currentMonth: "2026-10" });
const st = model.settings;
const today = "2026-10-22";
const cur = today.slice(0, 7);
const salesMonths = ds.months.filter((m) => (m.posRevenue ?? 0) > 0).map((m) => m.month).sort();
const M0 = salesMonths[0];
let carry = 0;
for (let m = M0; m <= cur; m = shift(m, 1)) {
  const info = model.monthInfo.get(m)!;
  const R = info.posRevenue!;
  const S = model.monthSales(m).serviceRevenue;
  let pv = posVat(R, S, st.kdv, st.kdvHizmet);
  const pnl = model.pnlMonth(m);
  const check = R - (pnl.revenueNet ?? 0);
  let factor = 1;
  if (m === cur && info.openDays && info.openDays < dimOf(m)) factor = dimOf(m) / info.openDays;
  pv *= factor;
  const invs = (model.invoicesByMonth.get(m) ?? []).filter((i) => !SEPARATE_CATEGORIES.includes(i.category));
  const purch = invs.reduce((s, i) => s + (i.payable - (i.amount - i.discount)), 0);
  const pos = round100(pv), pur = round100(purch);
  const net = pos - pur - carry;
  const payable = Math.max(0, net);
  console.log(m, { R, S, posVatRaw: pv.toFixed(2), check: (check * factor).toFixed(2), factor, projectedR: (R * factor).toFixed(2), purchRaw: purch.toFixed(2), count: invs.length, pos, pur, carryIn: carry, net, payable, noCarryNet: pos - pur });
  carry = Math.max(0, -net);
}
