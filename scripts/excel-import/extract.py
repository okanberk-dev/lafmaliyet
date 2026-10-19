"""
L'Affogato – Maliyet & Kârlılık.xlsx dosyasını okuyup web uygulamasının
başlangıç verisini (seed) ve Excel'in hesapladığı "altın" değerleri üretir.

Kullanım:
    python3 scripts/excel-import/extract.py "<excel yolu>"

Çıktılar:
    src/server/db/seed/excel-data.json  -> veritabanına yüklenecek ham veri
    tests/golden.json                   -> hesaplama motorunun Excel ile birebir
                                           aynı sonucu verdiğini doğrulayan değerler
"""

import datetime as dt
import json
import os
import re
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
YELLOW = "FFFFF2CC"

# Excel'deki adlandırılmış ayar hücreleri -> uygulamadaki formül değişkenleri
PARAM_NAMES = {"ShotTek", "ShotCift", "Pompa", "DondurmaTop", "TKGr", "PotGr", "PotMl"}

GOODS_CATEGORIES = ["Hammadde & İçecek", "Tatlı & Hazır Ürün", "Ambalaj"]
COMMISSION_SUPPLIERS = ("Trendyol", "Set Kart", "Pluxee", "Yemek Sepeti", "Multinet", "Edenred", "Metropol")


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(".", "").replace(",", "."))
    except ValueError:
        return None


def note_of(cell):
    return cell.comment.text.strip() if cell.comment is not None else None


def formula_text(v):
    if hasattr(v, "text"):
        return v.text
    return v if isinstance(v, str) else None


def split_supplier(raw):
    """'Kaldi (Gider listesi, ödenmedi)' -> ('Kaldi', 'Gider listesi, ödenmedi')"""
    m = re.match(r"^(.*?)\s*\((.*)\)\s*$", raw or "")
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return (raw or "").strip(), None


def month_key(d):
    return f"{d.year:04d}-{d.month:02d}"


def main(path):
    wf = openpyxl.load_workbook(path)
    wv = openpyxl.load_workbook(path, data_only=True)

    # ------------------------------------------------------------------ Ayarlar
    ay = wv["Ayarlar"]
    settings = {
        "kdv": ay["B4"].value,
        "komisyon": ay["B5"].value,
        "kartOrani": ay["B6"].value,
        "hedefMaliyet": ay["B7"].value,
        "fire": ay["B8"].value,
        "shotTek": ay["B9"].value,
        "shotCift": ay["B10"].value,
        "pompa": ay["B11"].value,
        "potGr": ay["B12"].value,
        "potMl": ay["B13"].value,
        "dondurmaTop": ay["B14"].value,
        "tkGr": ay["B15"].value,
        "acikGun": ay["B16"].value,
    }
    pv = wv["Personel"]
    settings.update(
        {
            "isciSgk": pv["B4"].value,
            "isciIssizlik": pv["B5"].value,
            "isverenSgk": pv["B6"].value,
            "isverenIssizlik": pv["B7"].value,
        }
    )
    settings = {k: float(v) for k, v in settings.items()}

    # ------------------------------------------------------- Sayım (grup/birim)
    sf = wf["Sayım"]
    count_info = {}
    group = None
    order = 0
    for r in range(9, 106):
        a = sf.cell(r, 1).value
        if a:
            group = a.strip()
            continue
        jf = formula_text(sf.cell(r, 10).value)
        if not jf:
            continue
        m = re.search(r'MATCH\("([^"]+)"', jf)
        if not m:
            continue
        order += 1
        count_info[m.group(1)] = {
            "countUnit": sf.cell(r, 3).value,
            "countGroup": group,
            "countOrder": order,
        }

    # ------------------------------------------------------------ Hammaddeler
    hf, hv = wf["Hammaddeler"], wv["Hammaddeler"]
    ingredients = []
    for r in range(5, 300):
        name = hf.cell(r, 1).value
        if not name:
            continue
        price_cell = hf.cell(r, 5).value
        is_water = isinstance(price_cell, str) and "SuBirimLT" in price_cell
        fill = hf.cell(r, 1).fill
        yellow = bool(fill and fill.fill_type and fill.fgColor.rgb == YELLOW)
        ci = count_info.get(name)
        ingredients.append(
            {
                "name": name,
                "category": hf.cell(r, 2).value,
                "supplier": hf.cell(r, 3).value,
                "packageDesc": hf.cell(r, 4).value,
                "packagePrice": 0.0 if is_water else float(hv.cell(r, 5).value or 0),
                "packageSize": float(hv.cell(r, 6).value or 1),
                "unit": hf.cell(r, 7).value,
                "vatRate": float(hv.cell(r, 10).value or 0),
                "note": hf.cell(r, 9).value,
                # Sarı zemin = faturada bulunamayan tahmini değer (Su/Buz ve Callei ayrı ele alınır)
                "isEstimate": yellow and not is_water and name != "Callei waffle sos sütlü",
                "priceSource": "water" if is_water else "manual",
                "countUnit": ci["countUnit"] if ci else None,
                "countGroup": ci["countGroup"] if ci else None,
                "countOrder": ci["countOrder"] if ci else None,
                "sortOrder": r - 4,
            }
        )

    # ------------------------------------------------------- Ürün Kârlılık
    uf, uv = wf["Ürün Kârlılık"], wv["Ürün Kârlılık"]
    products_meta = []
    categories = []
    for r in range(5, 134):
        cat = uf.cell(r, 1).value
        if not cat:
            continue
        if cat not in categories:
            categories.append(cat)
        products_meta.append(
            {
                "category": cat,
                "name": uf.cell(r, 2).value,
                "size": uf.cell(r, 3).value,
                "key": uv.cell(r, 4).value,
                "note": note_of(uf.cell(r, 2)),
                "sortOrder": r - 4,
            }
        )

    # --------------------------------------------------------- Reçete Kartları
    rf, rv = wf["Reçete Kartları"], wv["Reçete Kartları"]
    cards = {}
    for r in range(1, rf.max_row + 1):
        a = rf.cell(r, 1).value
        if not a or not isinstance(a, str):
            continue
        if "#" in a:
            key, tag = a.split("#", 1)
            c = cards.setdefault(key, {"items": [], "computed": {}})
            if tag == "FIRE":
                c["fireOverride"] = num(rf.cell(r, 7).value)
            elif tag == "FIYAT":
                c["price"] = float(rv.cell(r, 8).value)
            elif tag in ("TOPLAM", "MALIYET", "NET", "KOM", "KAR", "MARJ", "ORAN", "ADET", "EYLULKAR"):
                c["computed"][tag] = rv.cell(r, 8).value
            continue
        c = cards.setdefault(a, {"items": [], "computed": {}})
        ing = rf.cell(r, 3).value
        if not ing:
            continue
        raw = formula_text(rf.cell(r, 5).value)
        expr = None
        if isinstance(raw, str) and raw.startswith("="):
            expr = raw[1:]
            used = set(re.findall(r"[A-Za-z]+", expr))
            if not used <= PARAM_NAMES:
                raise ValueError(f"Beklenmeyen formül {a}: {raw}")
        qty = rv.cell(r, 5).value
        notes = [note_of(rf.cell(r, col)) for col in range(2, 11)]
        notes = [n for n in notes if n]
        c["items"].append(
            {
                "ingredient": ing,
                "qty": float(qty) if qty is not None else 0.0,
                "qtyExpr": expr,
                "note": " ".join(notes) if notes else None,
                "septUsage": rv.cell(r, 10).value,
            }
        )

    products = []
    for pm in products_meta:
        card = cards[pm["key"]]
        products.append(
            {
                **pm,
                "price": card["price"],
                "fireOverride": card.get("fireOverride"),
                "items": [
                    {k: it[k] for k in ("ingredient", "qty", "qtyExpr", "note")} for it in card["items"]
                ],
            }
        )

    # ---------------------------------------------------------- Satış Raporu
    sf2, sv2 = wf["Satış Raporu"], wv["Satış Raporu"]
    sales_lines = []
    for r in range(10, 135):
        name = sf2.cell(r, 1).value
        if not name:
            continue
        key = sv2.cell(r, 4).value
        sales_lines.append(
            {
                "month": "2026-09",
                "posName": str(name).strip(),
                "qty": float(sv2.cell(r, 2).value),
                "revenue": float(sv2.cell(r, 3).value),
                "productKey": key if key and key != "HİZMET" else None,
                "isService": key == "HİZMET",
                # Eşleşmeyen satırlardaki "D sütununa anahtarı yazın" notu web arayüzünde anlamsız
                "note": None if str(sv2.cell(r, 11).value or "").startswith("Reçetesi yok") else sv2.cell(r, 11).value,
            }
        )

    # -------------------------------------------------------------- Aylar
    gv = wv["Genel Maliyet"]
    month_cols = {10: "2026-07", 11: "2026-08", 12: "2026-09", 13: "2026-10"}
    months = []
    for col, mk in month_cols.items():
        months.append(
            {
                "month": mk,
                "openDays": int(gv.cell(2, col).value),
                "posRevenue": float(gv.cell(68, col).value),
                "discounts": 0.0,
                "offRevenue": 0.0,
                "note": None,
            }
        )
    sep = next(m for m in months if m["month"] == "2026-09")
    sep["discounts"] = float(sv2["C8"].value)
    sep["offRevenue"] = float(sv2["C5"].value)
    sep["note"] = (
        "Patron > Raporlar > Ciro > Geçen Ay: 429.698 TL. Ödenmez: 68 işlem 18.815 TL. "
        "Yönetici indirimi: 236 siparişte 11.997 TL."
    )
    octo = next(m for m in months if m["month"] == "2026-10")
    octo["note"] = (
        "1-16 Ekim (16 gün). Satış Raporu'nda 292.957 TL, Genel Maliyet'te 293.909 TL yazıyordu; "
        "son değer alındı. Ay bitince güncelleyin."
    )

    # ------------------------------------------------------------- Faturalar
    ff, fv = wf["Faturalar"], wv["Faturalar"]
    invoices = []
    for r in range(5, 86):
        d = fv.cell(r, 1).value
        if not isinstance(d, dt.datetime):
            continue
        raw_sup = ff.cell(r, 2).value
        supplier, desc = split_supplier(raw_sup)
        category = ff.cell(r, 4).value
        if supplier.startswith(COMMISSION_SUPPLIERS):
            category = "Komisyon"
        invoices.append(
            {
                "date": d.strftime("%Y-%m-%d"),
                "supplier": supplier,
                "description": desc,
                "invoiceNo": ff.cell(r, 3).value,
                "category": category,
                "amount": float(fv.cell(r, 5).value or 0),
                "discount": float(fv.cell(r, 6).value or 0),
                "payable": float(fv.cell(r, 9).value or 0),
                "unpaid": "ödenmedi" in (raw_sup or "").lower(),
                "note": note_of(ff.cell(r, 2)),
            }
        )

    # -------------------------------------------------------------- Personel
    staff = []
    for r in (10, 11):
        staff.append(
            {
                "name": pv.cell(r, 1).value,
                "netSalary": float(pv.cell(r, 2).value),
                "extras": float(pv.cell(r, 7).value or 0),
            }
        )

    # -------------------------------------------------------- Sabit Giderler
    sg = wv["Sabit Giderler"]
    sgf = wf["Sabit Giderler"]
    fixed_map = {
        "Kira": ("kira", "aylik", None, "KİRA + STOPAJ"),
        "Personel yemeği": ("personel", "gunluk", 330.0, "PERSONEL YEMEK GİDERİ"),
        "Part-time çalışan": ("personel", "haftalik", 3000.0, "PART-TIME"),
        "Instagram reklamı": ("genel", "aylik", None, "INSTAGRAM REKLAM"),
        "Influencer": ("genel", "aylik", None, "INFLUENCER"),
        "Elektrik (ana fatura)": ("faturalar", "aylik", None, "ELEKTRİK (ana fatura)"),
        "Elektrik (Opera yansıtma)": ("faturalar", "aylik", None, "ELEKTRİK (Opera yansıtma)"),
        "Ortak gider avansı (Opera)": ("kira", "aylik", None, "ORTAK GİDER (Opera)"),
        "Güvenlik / alarm (Pronet)": ("faturalar", "aylik", None, "PRONET (güvenlik)"),
        "Muhasebeci": ("personel", "aylik", None, "MALİ MÜŞAVİRLİK GİDERİ"),
        "İlaçlama (Kılavuz IPM)": ("genel", "aylik", None, "İLAÇLAMA"),
        "Paraşüt aboneliği": ("genel", "aylik", None, None),
        "ÖKC / yazarkasa entegrasyonu (Token)": ("genel", "aylik", None, None),
        "ModPOS / Patron aboneliği": ("genel", "yillik", 50.0, None),
        "Spotify (müzik)": ("genel", "aylik", None, None),
        "İnternet / telefon / diğer": ("faturalar", "aylik", None, "İNTERNET / TELEFON"),
    }
    fixed = []
    sort = 0
    for r in range(5, 22):
        name = sgf.cell(r, 1).value
        if name not in fixed_map:
            continue  # Personel satırı: Personel sayfasından hesaplanır
        section, period, amount, pnl_label = fixed_map[name]
        sort += 1
        fixed.append(
            {
                "name": name,
                "section": section,
                "period": period,
                "amount": amount if amount is not None else float(sg.cell(r, 2).value or 0),
                "note": sgf.cell(r, 3).value,
                "sortOrder": sort,
            }
        )

    investments = [
        {"name": "Dekorasyon & ekipman (XND Teknoloji)", "amount": 948680.0,
         "note": "3 fatura, Temmuz 2026, KDV hariç – ÖDENDİ. Kuruluş yatırımı, aylık giderlere dahil değil."},
        {"name": "POS / yazarkasa / ModPOS (Aria)", "amount": 39780.0, "note": "KDV hariç"},
        {"name": "Tabela, baskı (Murat Şeimen, Tuzla Baskı)", "amount": 15300.0, "note": "~15.300 ₺ + KDV"},
        {"name": "Reklam (Beyza Karaman)", "amount": 30000.0, "note": "30.000 ₺ + KDV"},
        {"name": "Bardak baskı klişe bedelleri (Serendi)", "amount": 2847.0, "note": "2.847 ₺ + KDV"},
    ]

    # --------------------------------------------------- Tutarlılık Kontrolü
    tf, tv = wf["Tutarlılık Kontrolü"], wv["Tutarlılık Kontrolü"]
    purchases = []
    for r in range(15, 45):
        ing = tf.cell(r, 1).value
        if not ing:
            continue
        purchases.append(
            {"month": "2026-09", "ingredient": ing, "qty": float(tv.cell(r, 3).value), "note": tf.cell(r, 7).value}
        )
    findings = []
    section_titles = {
        47: "Reçetede olmayan / satışta görünmeyen alımlar",
        57: "Fiyat kontrolü",
        65: "Fatura kontrolü",
    }
    current = None
    for r in range(47, 70):
        if r in section_titles:
            current = section_titles[r]
            continue
        a, b, c = tf.cell(r, 1).value, tf.cell(r, 2).value, tf.cell(r, 3).value
        if not a or a in ("Kalem", "Ürün", "Paraşüt gelen e-fatura") and b in ("Miktar", "Durum"):
            continue
        if a in ("Kalem", "Ürün"):
            continue
        if isinstance(b, float) and b.is_integer():
            b = int(b)
        findings.append(
            {
                "section": current,
                "title": str(a),
                "detail": " – ".join(str(x) for x in (b, c) if x not in (None, "")),
                "resolved": str(b).startswith("Düzeltildi") or str(b).startswith("✓") or "Trendyol" in str(a),
            }
        )

    data = {
        "meta": {
            "source": os.path.basename(path),
            "extractedAt": dt.datetime.now().isoformat(timespec="seconds"),
            "preparedNote": wv["Nasıl Kullanılır"]["A2"].value,
        },
        "settings": settings,
        "productCategories": categories,
        "ingredients": ingredients,
        "products": products,
        "months": months,
        "salesLines": sales_lines,
        "invoices": invoices,
        "staff": staff,
        "fixedExpenses": fixed,
        "investments": investments,
        "purchaseQuantities": purchases,
        "findings": findings,
    }

    out = os.path.join(ROOT, "src", "server", "db", "seed", "excel-data.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)

    # ================================================================ GOLDEN
    golden = {"products": {}, "salesLines": [], "salesTotals": {}, "panel": {}, "categories": {},
              "pnl": {}, "personnel": {}, "fixedTotal": None, "consistency": {}, "invoiceSummary": {}}
    for r in range(5, 134):
        key = uv.cell(r, 4).value
        if not key:
            continue
        golden["products"][key] = {
            "price": uv.cell(r, 5).value,
            "net": uv.cell(r, 6).value,
            "commission": uv.cell(r, 7).value,
            "cost": uv.cell(r, 8).value,
            "unitProfit": uv.cell(r, 10).value,
            "margin": uv.cell(r, 11).value,
            "costRatio": uv.cell(r, 12).value,
            "suggestedPrice": uv.cell(r, 13).value,
            "status": uv.cell(r, 14).value,
            "soldQty": uv.cell(r, 15).value,
            "profitTotal": uv.cell(r, 16).value,
        }
    for r in range(10, 135):
        if not sf2.cell(r, 1).value:
            continue
        golden["salesLines"].append(
            {
                "posName": str(sf2.cell(r, 1).value).strip(),
                "unitCost": sv2.cell(r, 5).value if isinstance(sv2.cell(r, 5).value, (int, float)) else None,
                "net": sv2.cell(r, 6).value,
                "cost": sv2.cell(r, 7).value,
                "commission": sv2.cell(r, 8).value,
                "grossProfit": sv2.cell(r, 9).value,
            }
        )
    golden["salesTotals"] = {
        "qty": sv2["B135"].value, "revenue": sv2["C135"].value, "net": sv2["F135"].value,
        "cost": sv2["G135"].value, "commission": sv2["H135"].value, "grossProfit": sv2["I135"].value,
        "avgCostRatio": sv2["C7"].value,
    }
    pnv = wv["Panel"]
    golden["panel"] = {
        "netSales": pnv["B5"].value, "discounts": pnv["B6"].value, "material": pnv["B7"].value,
        "commission": pnv["B8"].value, "rent": pnv["B9"].value, "personnel": pnv["B10"].value,
        "advertising": pnv["B11"].value, "otherFixed": pnv["B12"].value, "netProfit": pnv["B13"].value,
        "breakEvenDaily": pnv["B16"].value, "dailyAvg": pnv["B17"].value,
        "recipeCostRatio": pnv["B22"].value, "invoiceCostRatio": pnv["B23"].value,
        "bestProduct": pnv["B24"].value, "lowProfitCount": pnv["B25"].value,
    }
    for r in range(5, 18):
        golden["categories"][pnv.cell(r, 4).value] = {
            "count": pnv.cell(r, 5).value, "avgMargin": pnv.cell(r, 6).value,
            "avgUnitProfit": pnv.cell(r, 7).value, "avgCostRatio": pnv.cell(r, 8).value,
        }
    rows = {"purchases": 17, "cogs": 22, "personnel": 30, "bills": 38, "rent": 43, "general": 52,
            "commission": 58, "expenses": 66, "revenueNet": 69, "profit": 71, "posCommission": 54}
    for col, mk in month_cols.items():
        golden["pnl"][mk] = {k: gv.cell(r, col).value for k, r in rows.items()}
    golden["personnel"] = {
        "net": wv["Personel"]["B12"].value, "gross": wv["Personel"]["C12"].value,
        "total": wv["Personel"]["H12"].value,
    }
    golden["fixedTotal"] = sg["B22"].value
    golden["consistency"] = {
        "usage": {tf.cell(r, 1).value: tv.cell(r, 2).value for r in range(15, 45) if tf.cell(r, 1).value},
        "totalDiff": tv["F45"].value,
        "salesDiff": tv["B9"].value,
        "offRevenueCost": tv["B11"].value,
    }
    fvs = wv["Faturalar"]
    for r in range(5, 16):
        label = fvs.cell(r, 12).value
        if label:
            golden["invoiceSummary"][label] = {
                "2026-07": fvs.cell(r, 13).value, "2026-08": fvs.cell(r, 14).value,
                "2026-09": fvs.cell(r, 15).value, "2026-10": fvs.cell(r, 16).value,
            }

    gout = os.path.join(ROOT, "tests", "golden.json")
    os.makedirs(os.path.dirname(gout), exist_ok=True)
    with open(gout, "w", encoding="utf-8") as fh:
        json.dump(golden, fh, ensure_ascii=False, indent=1, default=str)

    print(f"{len(ingredients)} hammadde, {len(products)} ürün, {len(sales_lines)} satış satırı, "
          f"{len(invoices)} fatura, {len(fixed)} sabit gider, {len(purchases)} alım, {len(findings)} bulgu")
    print("->", out)
    print("->", gout)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Kullanım: python3 scripts/excel-import/extract.py <excel-dosyası>")
    main(sys.argv[1])
