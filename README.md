# Shop Payout Calculator

Static web page that turns a Supplier Sales Analysis Report (.xlsx) into a shop commission PDF.

- Commission = 100 × Issue Cases + 4.167 × Issue Bottles, summed per shop, rounded to 2 decimals.
- Grouped by warehouse (e.g. `WH-KOLLAM FL9-KLM-01/2026-27` → `WH-KOLLAM`).
- Only licensees whose name starts with a 4–5 digit code (e.g. `2001-HQ KOLLAM`) are included.
- Heading uses the Item Name and the month of the Indent Approve Date.
- Everything runs in the browser; the file is never uploaded.

## Run locally
Open `index.html` in Chrome, Edge or Firefox. No install needed.

## Deploy to Vercel
Push this folder to a GitHub repo and import it in Vercel (Framework preset: **Other**, no build command, output directory = root). Or run `npx vercel` inside the folder.

## Files
- `index.html`, `styles.css` – page
- `payout.js` – parsing and calculation rules
- `app.js` – file upload, PDF layout, download and preview
- `vendor/` – read-excel-file 9.3.17, jsPDF 4.2.1, jspdf-autotable 5.0.9 (bundled so nothing loads from the internet)
