"""Generate fictional sample receipts plus the extraction each one should produce.

Run from app/:  python3 scripts/make_samples.py

Writes:
  samples/receipts/*.png|jpg|pdf  - what the manager uploads
  samples/expected/<file>.json    - the structured result Claude should return for that
                                    file; the server falls back to it in demo mode when
                                    no API key is configured.

All businesses, addresses and reference numbers are made up.
"""

import json
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_RECEIPTS = os.path.join(HERE, "..", "samples", "receipts")
OUT_EXPECTED = os.path.join(HERE, "..", "samples", "expected")

FONT_PATHS = ["/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]


def font(size):
    for p in FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size=size)


# (rawName, printedQty, printedUnit, printedUnitPrice, ingredient, category, qty, unit, expiry)
SAMPLES = [
    {
        "file": "brackenfield-dairy-receipt.png",
        "style": "thermal",
        "supplier": "Brackenfield Dairy",
        "address": ["Unit 4, Riverside Trading Est.", "Hexham NE46 9ZZ"],
        "orderRef": "BFD-48211",
        "date": "2026-11-02",
        "lines": [
            ("WHOLE MILK 1L", 40, "l", 0.95, "Whole milk", "dairy", 40, "l", ""),
            ("DBL CREAM 1L", 8, "l", 3.20, "Double cream", "dairy", 8, "l", ""),
            ("UNSALTED BUTTER", 5, "kg", 6.80, "Unsalted butter", "dairy", 5, "kg", ""),
            ("FR RANGE EGGS LGE (TRAY 30)", 12, "tray", 8.40, "Free-range eggs", "dairy", 360, "each", ""),
            ("MATURE CHEDDAR BLOCK", 4, "kg", 9.50, "Mature cheddar", "dairy", 4, "kg", ""),
        ],
    },
    {
        "file": "holystone-meats-receipt.png",
        "style": "thermal",
        "supplier": "Holystone Meats Ltd",
        "address": ["12 Moor Lane", "Morpeth NE61 9ZZ"],
        "orderRef": "HSM-7730",
        "date": "2026-11-03",
        "lines": [
            ("CHKN BRST FILLET", 10, "kg", 7.40, "Chicken breast", "meat", 10, "kg", ""),
            ("BEEF MINCE 15% FAT", 5, "kg", 6.20, "Beef mince", "meat", 5, "kg", ""),
            ("SMKD BACK BACON", 3, "kg", 8.90, "Smoked back bacon", "meat", 3, "kg", ""),
        ],
    },
    {
        "file": "wansbeck-greens-photo.jpg",
        "style": "photo",
        "supplier": "Wansbeck Greens",
        "address": ["Market Yard", "Ashington NE63 9ZZ"],
        "orderRef": "WG-1194",
        "date": "2026-11-04",
        "lines": [
            ("VINE TOMS", 10, "kg", 2.60, "Vine tomatoes", "produce", 10, "kg", ""),
            ("LTL GEM LETTUCE", 40, "each", 0.55, "Little gem lettuce", "produce", 40, "each", ""),
            ("BROWN ONIONS", 25, "kg", 0.90, "Brown onions", "produce", 25, "kg", ""),
            ("MARIS PIPER POTS", 50, "kg", 0.70, "Maris Piper potatoes", "produce", 50, "kg", ""),
            ("CHESTNUT MUSH", 4, "kg", 4.20, "Chestnut mushrooms", "produce", 4, "kg", ""),
            ("BASIL PUNNET", 8, "pack", 1.10, "Fresh basil", "produce", 8, "pack", ""),
        ],
    },
    {
        "file": "coldharbour-fish-receipt.png",
        "style": "thermal",
        "supplier": "Coldharbour Fish Co",
        "address": ["The Fish Quay", "North Shields NE30 9ZZ"],
        "orderRef": "CHF-3021",
        "date": "2026-11-03",
        "lines": [
            ("COD LOIN SKINLESS", 3, "kg", 14.50, "Cod loin", "fish", 3, "kg", "2026-11-05"),
            ("HADDOCK FILLET", 2, "kg", 12.80, "Haddock fillet", "fish", 2, "kg", "2026-11-05"),
            ("KING PRAWNS RAW FRZ", 2, "kg", 16.00, "King prawns (frozen)", "frozen", 2, "kg", "2027-04-30"),
        ],
    },
    {
        "file": "pennine-larder-invoice.pdf",
        "style": "invoice",
        "supplier": "Pennine Larder Dry Goods",
        "address": ["Bay 7, Hilltop Business Park", "Consett DH8 9ZZ"],
        "orderRef": "PL-0558",
        "date": "2026-11-01",
        "lines": [
            ("Plain flour 16kg sack", 2, "sack", 12.00, "Plain flour", "dry", 32, "kg", ""),
            ("Arborio rice 5kg", 2, "bag", 12.00, "Arborio rice", "dry", 10, "kg", ""),
            ("Extra virgin olive oil 5L", 2, "tin", 39.50, "Extra virgin olive oil", "dry", 10, "l", ""),
            ("Chopped tomatoes 400g", 48, "each", 0.65, "Tinned chopped tomatoes", "dry", 48, "each", ""),
        ],
    },
]


def money(x):
    return f"{x:,.2f}"


def receipt_text(s):
    rows = []
    for raw, pq, pu, pp, *_rest in s["lines"]:
        expiry = _rest[-1]
        rows.append((raw, pq, pu, pp, round(pq * pp, 2), expiry))
    total = round(sum(r[4] for r in rows), 2)
    return rows, total


def draw_thermal(s, path, photo=False):
    rows, total = receipt_text(s)
    f, fb, fs = font(20), font(26), font(17)
    W, lh = 620, 30
    H = 330 + lh * (len(rows) * 2) + 200
    img = Image.new("RGB", (W, H), (252, 251, 246))
    d = ImageDraw.Draw(img)
    y = 30
    d.text((W // 2, y), s["supplier"].upper(), font=fb, fill="black", anchor="mt"); y += 40
    for a in s["address"]:
        d.text((W // 2, y), a, font=fs, fill="black", anchor="mt"); y += 24
    y += 10
    d.text((30, y), "DELIVERY RECEIPT", font=f, fill="black"); y += lh
    d.text((30, y), f"Order ref: {s['orderRef']}", font=f, fill="black"); y += lh
    dd = s["date"].split("-")
    d.text((30, y), f"Date: {dd[2]}/{dd[1]}/{dd[0]}", font=f, fill="black"); y += lh
    d.text((30, y), "Cust: THE LANTERN KITCHEN", font=f, fill="black"); y += lh
    d.text((30, y), "-" * 46, font=f, fill="black"); y += lh
    for raw, pq, pu, pp, lt, expiry in rows:
        d.text((30, y), raw, font=f, fill="black")
        d.text((W - 30, y), money(lt), font=f, fill="black", anchor="ra"); y += lh - 4
        extra = f"  {pq:g} {pu} @ {money(pp)}"
        if expiry:
            e = expiry.split("-")
            label = "BB" if expiry > "2026-12-31" else "USE BY"
            extra += f"   {label} {e[2]}/{e[1]}/{e[0][2:]}"
        d.text((30, y), extra, font=fs, fill=(40, 40, 40)); y += lh + 4
    d.text((30, y), "-" * 46, font=f, fill="black"); y += lh
    d.text((30, y), "VAT (zero-rated food)", font=f, fill="black")
    d.text((W - 30, y), "0.00", font=f, fill="black", anchor="ra"); y += lh
    d.text((30, y), "TOTAL GBP", font=fb, fill="black")
    d.text((W - 30, y), money(total), font=fb, fill="black", anchor="ra"); y += lh + 20
    d.text((W // 2, y), "Goods received in good condition", font=fs, fill="black", anchor="mt"); y += 26
    d.text((W // 2, y), "Signed: ________", font=fs, fill="black", anchor="mt")
    img = img.crop((0, 0, W, y + 50))

    if not photo:
        img.save(path)
        return
    # Phone-photo look: receipt on a worktop, slightly rotated, soft focus, uneven light.
    bg = Image.new("RGB", (img.width + 240, img.height + 240), (92, 84, 74))
    shade = Image.linear_gradient("L").resize(bg.size).rotate(35)
    bg = Image.composite(bg, Image.new("RGB", bg.size, (60, 54, 48)), shade)
    rot = img.rotate(-3.5, expand=True, fillcolor=(92, 84, 74), resample=Image.BICUBIC)
    bg.paste(rot, (110, 90))
    bg = bg.filter(ImageFilter.GaussianBlur(0.9))
    bg.save(path, quality=78)


def draw_invoice(s, path):
    rows, total = receipt_text(s)
    W, H = 1240, 1754  # A4 at 150 dpi
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    f, fb, fh = font(24), font(30), font(44)
    d.text((80, 80), s["supplier"], font=fh, fill=(30, 60, 50))
    y = 140
    for a in s["address"]:
        d.text((80, y), a, font=f, fill="black"); y += 34
    d.text((W - 80, 80), "INVOICE", font=fh, fill="black", anchor="ra")
    dd = s["date"].split("-")
    d.text((W - 80, 150), f"Invoice no: {s['orderRef']}", font=f, fill="black", anchor="ra")
    d.text((W - 80, 184), f"Invoice date: {dd[2]}/{dd[1]}/{dd[0]}", font=f, fill="black", anchor="ra")
    d.text((80, 300), "Bill to: The Lantern Kitchen", font=f, fill="black")
    y = 400
    cols = [80, 640, 820, 1000]
    for x, h in zip(cols, ["Description", "Qty", "Unit price", "Amount"]):
        d.text((x, y), h, font=fb, fill="black")
    y += 50
    d.line((80, y, W - 80, y), fill="black", width=2); y += 20
    for raw, pq, pu, pp, lt, _ in rows:
        d.text((cols[0], y), raw, font=f, fill="black")
        d.text((cols[1], y), f"{pq:g} {pu}", font=f, fill="black")
        d.text((cols[2], y), f"£{money(pp)}", font=f, fill="black")
        d.text((cols[3], y), f"£{money(lt)}", font=f, fill="black"); y += 48
    d.line((80, y, W - 80, y), fill="black", width=2); y += 30
    d.text((cols[2], y), "Total", font=fb, fill="black")
    d.text((cols[3], y), f"£{money(total)}", font=fb, fill="black"); y += 80
    d.text((80, y), "Delivered 01/11/2026. Payment due within 30 days.", font=f, fill="black")
    img.save(path, "PDF", resolution=150)


def expected(s):
    rows, total = receipt_text(s)
    items = []
    for (raw, pq, pu, pp, ing, cat, q, u, exp), row in zip(s["lines"], rows):
        note = ""
        if pu != u:
            note = f"Converted {pq:g} {pu} to {q:g} {u}"
        items.append({
            "rawName": raw,
            "ingredient": ing,
            "category": cat,
            "quantity": q,
            "unit": u,
            "unitPrice": round(row[4] / q, 4),
            "lineTotal": row[4],
            "expiryDate": exp,
            "confidence": "high",
            "note": note,
        })
    return {
        "isReceipt": True,
        "supplier": s["supplier"],
        "orderRef": s["orderRef"],
        "receiptDate": s["date"],
        "currency": "GBP",
        "total": total,
        "items": items,
        "warnings": [],
    }


def main():
    os.makedirs(OUT_RECEIPTS, exist_ok=True)
    os.makedirs(OUT_EXPECTED, exist_ok=True)
    for s in SAMPLES:
        path = os.path.join(OUT_RECEIPTS, s["file"])
        if s["style"] == "invoice":
            draw_invoice(s, path)
        else:
            draw_thermal(s, path, photo=s["style"] == "photo")
        with open(os.path.join(OUT_EXPECTED, s["file"] + ".json"), "w") as fh:
            json.dump(expected(s), fh, indent=2)
        print("wrote", s["file"])


if __name__ == "__main__":
    main()
