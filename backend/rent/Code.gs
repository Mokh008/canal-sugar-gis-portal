/***************************************
 * CONFIG
 ***************************************/
const MASTER_SHEET    = "Master_Rent_Contracts";
const PAYMENTS_SHEET  = "Rent_Payments";
const FORM_SHEET      = "Form";
const FORM_DATA_SHEET = "Form_Data";

// ثوابت الصفحات
const PAGE1_END_ROW   = 40;
const PAGE2_START_ROW = 45;
const PAGE2_END_ROW   = 80;

// BUG FIX: assets/js/modules/rent.js's admin Report tab has always called
// `action=getRentReport` against a *second*, separate deployment
// (rent-config.js's `reportUrl`) that never implemented it — every call
// returned `{"error":"Invalid action"}`, which is exactly the frontend's
// non-array-response path ("التقرير الإداري فاضي + الشهور مش ظاهرة"; the
// month <select> is built from the report rows themselves, so zero rows
// also left it empty). Rather than keep juggling two Apps Script
// deployments for one workbook, getRentReport is added directly below —
// this single project (paymentUrl) can now serve both, and rent-config.js's
// reportUrl can point at the same URL as paymentUrl once this is
// redeployed. Must match assets/js/api/rent-config.js's reportAdminKey
// exactly.
const RENT_REPORT_ADMIN_KEY = "mk_admin_2025";

/***************************************
 * WEB APP ENTRY
 *
 * SECURITY (server-side action still required — see backend/rent/README.md):
 * every action below trusts `engineerId` verbatim from the request with
 * no ownership check at all — not just for reads (getAssets) but for
 * confirmPayment, which appends a real "this rent is paid" row to
 * Rent_Payments with zero verification the caller is who they claim,
 * and printReceipts, which generates a PDF containing the owner's
 * national ID and shares it "anyone with the link." All three are
 * documented as open in the README pending a decision on adding real
 * authentication (this file doesn't have a login/session concept at
 * all today, unlike the Attendance backend). The fixes below are the
 * ones that don't require that decision first.
 ***************************************/
function doGet(e) {
  const action = e.parameter.action || "";
  if (action === "getAssets") {
    const engineerId = validateEngineerId_(e.parameter.engineerId);
    if (!engineerId) return jsonOutput({ error: "Invalid engineerId" });
    return jsonOutput({
      assets: getEngineerAssets(engineerId),
      paidMonths: getPaidMonths(engineerId) // ✅ جديد
    });
  }
  if (action === "getRentReport") {
    if (String(e.parameter.adminKey || "") !== RENT_REPORT_ADMIN_KEY) {
      return jsonOutput({ error: "Unauthorized" });
    }
    return jsonOutput(getRentReport());
  }
  return jsonOutput({ error: "Invalid action" });
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents || "{}");

  if (data.action === "confirmPayment") {
    if (!validateEngineerId_(data.engineerId) || !String(data.assetName || "").trim()) {
      return jsonOutput({ error: "Invalid request" });
    }
    return jsonOutput(confirmPayment(data));
  }

  if (data.action === "printReceipts") {
    if (!validateEngineerId_(data.engineerId)) {
      return jsonOutput({ error: "Invalid request" });
    }
    return jsonOutput(printReceipts(data));
  }

  return jsonOutput({ error: "Invalid action" });
}

/***************************************
 * Basic input hygiene — non-empty, trimmed, and bounded length so a
 * missing/garbage engineerId fails fast with a clear error instead of
 * silently matching nothing (or, worse, matching something unexpected
 * via loose string coercion elsewhere). Not an ownership check — see
 * the doGet/doPost header comment above.
 ***************************************/
function validateEngineerId_(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 32) return null;
  return id;
}

/***************************************
 * GET ENGINEER ASSETS
 ***************************************/
function getEngineerAssets(engineerId) {

  const sheet = SpreadsheetApp.getActive().getSheetByName(MASTER_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  let results = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];

    if (
      String(r[idx.Engineer_ID]).trim() === String(engineerId).trim() &&
      String(r[idx.Status]).trim() === "Active"
    ) {

      const startDate = parseAnyDate(r[idx.Contract_Start]);
      const endDate   = parseAnyDate(r[idx.Contract_End]);

      results.push({
        assetName: r[idx.Asset_Name],
        location: r[idx.Location],
        assetType: r[idx.Asset_Type],
        monthlyRent: r[idx.Monthly_Rent],
        contractStart: startDate
          ? Utilities.formatDate(startDate, "GMT+2", "yyyy-MM-dd")
          : "",
        contractEnd: endDate
          ? Utilities.formatDate(endDate, "GMT+2", "yyyy-MM-dd")
          : "",
        remainingDays: r[idx.Remaining_Days],
        ownerName: r[idx.Owner_Name],
        ownerNationalId: r[idx.Owner_National_ID],
        amountArabic: r[19]
      });
    }
  }

  return results;
}

/***************************************
 * ✅ NEW: GET PAID MONTHS
 ***************************************/
function getPaidMonths(engineerId){
  const sh = SpreadsheetApp.getActive().getSheetByName(PAYMENTS_SHEET);
  const data = sh.getDataRange().getValues();

  let result = {};

  for(let i=1;i<data.length;i++){
    if(String(data[i][1]).trim() === String(engineerId).trim()){
      const asset = data[i][5];
      const month = normalizeMonth(data[i][6]);

      if(!result[asset]){
        result[asset] = [];
      }
      result[asset].push(month);
    }
  }

  return result;
}

/***************************************
 * ✅ NEW: ADMIN REPORT
 * One row per (active contract × month) across a rolling window — 6
 * months back / 12 ahead of today, 19 months total — mirroring the exact
 * window modules/rent.js's MONTHS_LIST generates client-side for the
 * "pay" month picker, so the report's month dropdown and the pay flow's
 * month picker never drift apart. Each row is marked paid/unpaid by
 * cross-referencing Rent_Payments (same reqId/Asset_Name/month matching
 * confirmPayment's own duplicate-payment check above).
 ***************************************/
function getRentReport() {
  const ss = SpreadsheetApp.getActive();
  const master = ss.getSheetByName(MASTER_SHEET);
  const payments = ss.getSheetByName(PAYMENTS_SHEET);
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
      // No Engineer_Name column in Master_Rent_Contracts (only
      // Engineer_ID is used elsewhere in this file) — the frontend
      // already renders '—' for a blank engineerName.
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
    const key = [String(row[1]).trim(), String(row[5]).trim(), normalizeMonth(row[6])].join("|");
    paidAtByKey[key] = formatDate(row[7]);
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

/***************************************
 * CONFIRM PAYMENT
 ***************************************/
function confirmPayment(data) {

  const ss = SpreadsheetApp.getActive();
  const master = ss.getSheetByName(MASTER_SHEET);
  const paySheet = ss.getSheetByName(PAYMENTS_SHEET);

  const rows = paySheet.getDataRange().getValues();

  const reqId    = String(data.engineerId).trim();
  const reqAsset = String(data.assetName).trim();
  const reqMonth = normalizeMonth(data.month);

  for (let i = 1; i < rows.length; i++) {
    if (
      String(rows[i][1]).trim() === reqId &&
      String(rows[i][5]).trim() === reqAsset &&
      normalizeMonth(rows[i][6]) === reqMonth
    ) {
      return { error: "هذا الشهر تم دفعه بالفعل" };
    }
  }

  const mData = master.getDataRange().getValues();
  const headers = mData[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  const row = mData.find(r =>
    String(r[idx.Engineer_ID]).trim() === reqId &&
    String(r[idx.Asset_Name]).trim() === reqAsset
  );

  if (!row) return { error: "العقد غير موجود" };

  paySheet.appendRow([
    "R-" + Date.now(),
    reqId,
    row[idx.Owner_Name],
    row[idx.Monthly_Rent],
    row[idx.Owner_National_ID],
    row[idx.Asset_Name],
    reqMonth,
    new Date(),
    row[19]
  ]);

  return { success: true };
}

/***************************************
 * PRINT RECEIPTS (SMART A4 PAGES)
 ***************************************/
function printReceipts(data) {

  const ss        = SpreadsheetApp.getActive();
  const paySheet = ss.getSheetByName(PAYMENTS_SHEET);
  const formTpl  = ss.getSheetByName(FORM_SHEET);
  const dataSh   = ss.getSheetByName(FORM_DATA_SHEET);

  if (!formTpl || !dataSh) {
    return { error: "Form أو Form_Data غير موجود" };
  }

  const rows = paySheet.getDataRange().getValues();
  const reqId    = String(data.engineerId).trim();
  const reqMonth = normalizeMonth(data.month);

  let items = [];
  for (let i = 1; i < rows.length; i++) {
    if (
      String(rows[i][1]).trim() === reqId &&
      normalizeMonth(rows[i][6]) === reqMonth
    ) {
      items.push({
        amount: rows[i][3],
        ownerName: rows[i][2],
        ownerNationalId: rows[i][4],
        assetName: rows[i][5],
        paymentDate: rows[i][7],
        amountArabic: rows[i][8]
      });
    }
  }

  if (items.length === 0) {
    return { error: "لا توجد إيصالات لهذا الشهر" };
  }

  const folderName = "Rent_" + reqMonth;
  const f = DriveApp.getFoldersByName(folderName);
  const folder = f.hasNext() ? f.next() : DriveApp.createFolder(folderName);

  dataSh.getRange("A1:D80").clearContent();
  dataSh.showRows(PAGE2_START_ROW, PAGE2_END_ROW - PAGE2_START_ROW + 1);

  fillReceiptColumn(dataSh, "A", items[0], reqMonth);
  if (items[1]) fillReceiptColumn(dataSh, "B", items[1], reqMonth);

  if (items.length >= 3) {
    fillReceiptColumn(dataSh, "C", items[2], reqMonth);
    if (items[3]) fillReceiptColumn(dataSh, "D", items[3], reqMonth);
  } else {
    dataSh.hideRows(PAGE2_START_ROW, PAGE2_END_ROW - PAGE2_START_ROW + 1);
  }

  SpreadsheetApp.flush();
  Utilities.sleep(600);

  const temp = formTpl.copyTo(ss).setName("TEMP_PRINT_" + Date.now());
  temp.getDataRange().copyTo(temp.getDataRange(), { contentsOnly: true });

  const url =
    "https://docs.google.com/spreadsheets/d/" + ss.getId() +
    "/export?format=pdf" +
    "&gid=" + temp.getSheetId() +
    "&size=A4&portrait=true&fitw=true" +
    "&sheetnames=false&pagenumbers=false&gridlines=false";

  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }
  });

  const file = folder.createFile(
    response.getBlob().setName(`Rent_${reqMonth}_${reqId}.pdf`)
  );

  // ⚠️ See backend/rent/README.md — this PDF contains Owner_National_ID
  // (PII) and is shared "anyone with the link" with no auth gate in
  // front of generating it in the first place. Flagged as the most
  // sensitive item in this whole review; not changed unilaterally here
  // since narrowing sharing could break the download flow depending on
  // your Workspace setup — see the README for the trade-off.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  ss.deleteSheet(temp);

  dataSh.showRows(PAGE2_START_ROW, PAGE2_END_ROW - PAGE2_START_ROW + 1);

  return { pdfUrl: file.getUrl() };
}

/***************************************
 * HELPERS
 ***************************************/
function fillReceiptColumn(sh, col, item, month) {
  sh.getRange(col + "1").setValue(item.amount);
  sh.getRange(col + "2").setValue(item.ownerName);
  sh.getRange(col + "3").setValue(item.amountArabic);
  sh.getRange(col + "4").setValue(item.ownerNationalId);
  sh.getRange(col + "5").setValue(item.assetName);
  sh.getRange(col + "6").setValue(formatArabicMonth(month));
  sh.getRange(col + "7")
    .setValue(getFirstDayOfMonth(month))
    .setNumberFormat("@");
}

function parseAnyDate(val) {
  if (val instanceof Date && !isNaN(val)) return val;
  if (typeof val === "string" && val.trim() !== "") {
    let d = new Date(val);
    if (!isNaN(d)) return d;
    d = new Date(val.replace(/-/g, " "));
    if (!isNaN(d)) return d;
  }
  return null;
}

function normalizeMonth(val) {
  if (!val) return "";
  if (val instanceof Date) {
    const m = String(val.getMonth() + 1).padStart(2, "0");
    return `${m}-${val.getFullYear()}`;
  }
  const parts = String(val).replace(/[^\d]/g, "-").split("-").filter(Boolean);
  if (parts.length >= 2) return `${parts[0].padStart(2, "0")}-${parts[1]}`;
  return String(val).trim();
}

function formatArabicMonth(val) {
  if (!val) return "";
  const parts = String(val).split("-");
  if (parts.length !== 2) return val;

  const monthIndex = parseInt(parts[0], 10) - 1;
  const year = parts[1];

  const m = [
    "يناير","فبراير","مارس","أبريل","مايو","يونيو",
    "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"
  ];

  if (monthIndex < 0 || monthIndex > 11) return val;
  return m[monthIndex] + " " + year;
}

function formatDate(d) {
  return Utilities.formatDate(new Date(d), "GMT+2", "dd/MM/yyyy");
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/***************************************
 * TEST
 ***************************************/
function TEST_printReceipts() {
  const result = printReceipts({
    action: "printReceipts",
    engineerId: "1001584",
    month: "01-2026"
  });
  Logger.log(result);
}
function getFirstDayOfMonth(month) {
  // month format: "MM-YYYY"  e.g. "04-2026"
  const parts = String(month).split("-");
  const m = parts[0]; // "04"
  const y = parts[1]; // "2026"
  return `01/${m}/${y}`;  // "01/04/2026"
}
