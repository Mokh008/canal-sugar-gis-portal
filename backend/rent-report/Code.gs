/***************************************
 * RENT ADMIN REPORT BACKEND
 *
 * This is the entire Apps Script project behind rent-config.js's
 * `reportUrl` — a *separate* deployment from backend/rent/Code.gs
 * (paymentUrl, which handles getAssets/confirmPayment/printReceipts).
 * The only action the frontend ever calls against this URL is
 * `getRentReport` (see modules/rent.js / api/rent-client.js), so this
 * file is safe to paste in as a full replacement of whatever's in that
 * project today — same as backend/expenses/Code.gs.
 *
 * Reads the *active* spreadsheet's Master_Rent_Contracts and
 * Rent_Payments sheets (same names/columns backend/rent/Code.gs uses) —
 * confirmed live against the real sheet: Rent_Payments columns are
 * Receipt_ID(0), Engineer_ID(1), OWNER_NAME(2), AMOUNT_TEXT(3),
 * OWNER_NATIONAL_ID(4), Asset_Name(5), Month(6), PAYMENT_DATE(7),
 * PDF_URL(8), Department(9), Engineer_Name(10), Month_Key(11) — matches
 * the positional reads in getRentReport() below exactly. If this
 * deployment's script-bound spreadsheet ever turns out to be a
 * different workbook than the one paymentUrl uses, or the sheet/column
 * names differ, adjust RENT_REPORT_MASTER_SHEET/RENT_REPORT_PAYMENTS_SHEET
 * below to match.
 *
 * Why this was needed: hitting reportUrl with
 * `?action=getRentReport&adminKey=mk_admin_2025` used to return
 * `{"error":"Invalid action"}` — the action the frontend has always
 * called simply wasn't implemented on that deployment. The frontend
 * correctly read that non-array response as "backend not configured"
 * and showed a warning instead of a report; since the month <select> is
 * built from the report rows' `.month` values, zero rows also left the
 * month dropdown empty — the exact symptom reported:
 * "التقرير الإداري فاضي + الشهور مش ظاهرة".
 ***************************************/

const RENT_REPORT_MASTER_SHEET = "Master_Rent_Contracts";
const RENT_REPORT_PAYMENTS_SHEET = "Rent_Payments";

// Must match assets/js/api/rent-config.js's reportAdminKey exactly. Same
// weak, client-visible gate as the other backends — see
// backend/rent/README.md's "Still open" section for why this isn't real
// authorization.
const RENT_REPORT_ADMIN_KEY = "mk_admin_2025";

/***************************************
 * WEB APP
 ***************************************/
function doGet(e) {
  if (!e || !e.parameter) {
    return jsonOutput({ status: "OK" });
  }

  if (e.parameter.action === "getRentReport") {
    if (String(e.parameter.adminKey || "") !== RENT_REPORT_ADMIN_KEY) {
      return jsonOutput({ error: "Unauthorized" });
    }
    return jsonOutput(getRentReport());
  }

  return jsonOutput({ error: "Invalid action" });
}

/***************************************
 * One row per (active contract × month) across a rolling window —
 * 6 months back / 12 ahead of today, 19 months total — mirroring the
 * exact window modules/rent.js's MONTHS_LIST generates client-side for
 * the "pay" month picker, so the report's month dropdown and the pay
 * flow's month picker never drift apart. Each row is marked paid/unpaid
 * by cross-referencing Rent_Payments.
 ***************************************/
function getRentReport() {
  const ss = SpreadsheetApp.getActive();
  const master = ss.getSheetByName(RENT_REPORT_MASTER_SHEET);
  const payments = ss.getSheetByName(RENT_REPORT_PAYMENTS_SHEET);
  if (!master || !payments) return [];

  const mData = master.getDataRange().getValues();
  const headers = mData[0];
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });

  const contracts = [];
  for (let i = 1; i < mData.length; i++) {
    const r = mData[i];
    if (String(r[idx.Status]).trim() !== "Active") continue;
    contracts.push({
      engineerId: String(r[idx.Engineer_ID]).trim(),
      // Master_Rent_Contracts has no Engineer_Name column in the sheet
      // schema backend/rent/Code.gs reads from — only if this report's
      // spreadsheet happens to have one does this pick it up; otherwise
      // the frontend already renders '—' for a blank engineerName.
      engineerName: idx.Engineer_Name != null ? r[idx.Engineer_Name] : "",
      assetName: r[idx.Asset_Name],
      location: r[idx.Location],
      assetType: r[idx.Asset_Type],
      monthlyRent: r[idx.Monthly_Rent],
      ownerName: r[idx.Owner_Name],
    });
  }

  const paidAtByKey = {};
  const pData = payments.getDataRange().getValues();
  for (let i = 1; i < pData.length; i++) {
    const row = pData[i];
    const key = [String(row[1]).trim(), String(row[5]).trim(), rentReportNormalizeMonth_(row[6])].join("|");
    paidAtByKey[key] = rentReportFormatDate_(row[7]);
  }

  const months = rentReportMonthWindow_(6, 12);

  const out = [];
  contracts.forEach((c) => {
    months.forEach((month) => {
      const key = [c.engineerId, String(c.assetName).trim(), month].join("|");
      const paidAt = paidAtByKey[key];
      out.push({
        engineerId: c.engineerId,
        engineerName: c.engineerName,
        assetName: c.assetName,
        location: c.location,
        assetType: c.assetType,
        monthlyRent: c.monthlyRent,
        ownerName: c.ownerName,
        month: month,
        status: paidAt ? "paid" : "unpaid",
        paidAt: paidAt || "",
      });
    });
  });
  return out;
}

function rentReportMonthWindow_(monthsBack, monthsAhead) {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1 - monthsBack;
  while (m < 1) { m += 12; y -= 1; }
  const months = [];
  const total = monthsBack + monthsAhead + 1;
  for (let i = 0; i < total; i++) {
    months.push(String(m).padStart(2, "0") + "-" + y);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function rentReportNormalizeMonth_(val) {
  if (!val) return "";
  if (val instanceof Date) {
    const m = String(val.getMonth() + 1).padStart(2, "0");
    return `${m}-${val.getFullYear()}`;
  }
  const parts = String(val).replace(/[^\d]/g, "-").split("-").filter(Boolean);
  if (parts.length >= 2) return `${parts[0].padStart(2, "0")}-${parts[1]}`;
  return String(val).trim();
}

function rentReportFormatDate_(d) {
  if (!d) return "";
  return Utilities.formatDate(new Date(d), "GMT+2", "dd/MM/yyyy");
}

/***************************************
 * JSON OUTPUT
 ***************************************/
function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
