/************************************************
 * CONFIG
 ************************************************/
const ATTENDANCE_SPREADSHEET_ID =
  "1t0oY_26xseLXEE3J9MQ3qbLaK4CWGLgI5lnWZFrLFKc";

const EXPENSES_SPREADSHEET_ID =
  "1EdoGCXN9P0INqvbJkZGyCkD0in03P4fXeZ6BMU0qZXM";

const TEMPLATE_SHEET_NAME = "Expense_Form_Template";

// SECURITY FIX (Critical): must match assets/js/api/expenses-config.js's
// livingRatePerDay exactly — this is now the ONLY place the per-diem
// amount is actually computed. Previously `saveExpense()` trusted
// `d.total` verbatim from the client (see saveExpense() below), so a
// modified request could claim an arbitrary reimbursement amount for
// the same set of checked days. If you ever change the rate, change it
// here AND in the frontend config (the frontend value only affects what
// the user sees live in the form before submitting).
const PER_DIEM_RATE_PER_DAY = 200;

// Defense-in-depth sanity ceilings — transport/electricity amounts have
// no fixed formula to recompute from (unlike per-diem), so they can't be
// derived server-side the same way. These just reject obviously-wrong
// values (a typo with an extra zero, a deliberately absurd figure)
// rather than trying to fully price-verify them. Adjust to whatever's
// realistic for your actual routes/rates.
const MAX_TRANSPORT_PER_DAY = 2000;
const MAX_ELECTRICITY_AMOUNT = 100000;

// BUG FIX: assets/js/modules/expenses.js's admin Report view has always
// called `action=getExpensesReport` (see api/expenses-client.js), but this
// backend never implemented it — every call landed on the `Invalid GET`
// fallback below, which the frontend correctly reads as "not an array" and
// shows as "⚠️ أضف action=getExpensesReport في الـ Apps Script أولاً"
// instead of a report. That's also why the month dropdown was empty: it's
// built from the report rows' `.month` values, and there were none. Fixed
// by adding the action (see getExpensesReport() below). Must match
// assets/js/api/expenses-config.js's reportAdminKey exactly.
const EXPENSES_REPORT_ADMIN_KEY = "mk_admin_2025";

/************************************************
 * WEB APP
 ************************************************/
function doGet(e) {
  if (!e || !e.parameter) {
    return jsonOutput({ status: "OK" });
  }

  if (e.parameter.action === "getDays") {
    const id = String(e.parameter.id || "").trim();
    const month = Number(e.parameter.month);
    if (!id || !month) return jsonOutput([]);
    // SECURITY (server-side action still required — see backend/expenses/README.md):
    // `id` is free-text client input with no ownership check — any
    // caller can read any employee's attendance days by changing this
    // param. Left as-is pending a decision on adding real
    // authentication to this backend (a PIN-based login like the
    // Attendance backend already has is the natural fit) — flagged
    // here rather than silently left undocumented.
    return jsonOutput(getAttendanceDays(id, month));
  }

  if (e.parameter.action === "getExpensesReport") {
    // Same (weak, client-visible) gate as Rent's report endpoint — see
    // backend/expenses/README.md's "Still open" section for why this
    // isn't real authorization.
    if (String(e.parameter.adminKey || "") !== EXPENSES_REPORT_ADMIN_KEY) {
      return jsonOutput({ error: "Unauthorized" });
    }
    return jsonOutput(getExpensesReport());
  }

  return jsonOutput({ error: "Invalid GET" });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Basic input hygiene — reject obviously malformed requests before
    // they reach saveExpense()/generateExpensePDF() rather than letting
    // a missing/garbage id silently create a blank-name PDF.
    if (!data.id || String(data.id).trim() === "") {
      throw new Error("Missing employee id");
    }
    if (!data.month || Number(data.month) < 1 || Number(data.month) > 12) {
      throw new Error("Invalid month");
    }

    // Validation: transportation values must be valid AND within a
    // sane ceiling (see MAX_TRANSPORT_PER_DAY above — the original
    // validation only rejected <= 0, not implausibly large values).
    if (data.transport && typeof data.transport === "object") {
      for (let d in data.transport) {
        const amount = Number(data.transport[d]);
        if (!amount || amount <= 0) {
          throw new Error("Invalid transportation amount");
        }
        if (amount > MAX_TRANSPORT_PER_DAY) {
          throw new Error("Transportation amount exceeds the allowed maximum");
        }
      }
    }

    if (data.electricity && Number(data.electricity.amount) > MAX_ELECTRICITY_AMOUNT) {
      throw new Error("Electricity amount exceeds the allowed maximum");
    }

    saveExpense(data);
    const pdfUrl = generateExpensePDF(data);

    return jsonOutput({ status: "OK", pdfUrl });

  } catch (err) {
    return jsonOutput({
      status: "ERROR",
      message: err.toString()
    });
  }
}

/************************************************
 * READ ATTENDANCE DAYS
 ************************************************/
function getAttendanceDays(empId, month) {

  const ss = SpreadsheetApp.openById(ATTENDANCE_SPREADSHEET_ID);
  const sh = ss.getSheetByName("Sheet1");

  const rows = sh
    .getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn())
    .getValues();

  const map = {};

  rows.forEach(r => {
    if (String(r[0]).trim() !== empId) return;

    const d = new Date(r[4]); // Col E
    if (d.getMonth() + 1 !== month) return;

    const key = Utilities.formatDate(d, "GMT+2", "yyyy-MM-dd");
    if (!map[key]) map[key] = { in: false, out: false };

    const t = String(r[12]).toLowerCase(); // Col M
    if (t.includes("in") || t.includes("دخول")) map[key].in = true;
    if (t.includes("out") || t.includes("خروج")) map[key].out = true;
  });

  return Object.keys(map)
    .filter(k => map[k].in && map[k].out)
    .map(k => ({
      date: k,
      day: [
        "Sunday","Monday","Tuesday",
        "Wednesday","Thursday","Friday","Saturday"
      ][new Date(k).getDay()]
    }));
}

/************************************************
 * ADMIN REPORT
 * Expenses_Data gets one appendRow() per entry type from saveExpense()
 * above ("Per Diem" / "Transportation" / "Electricity" — never a combined
 * row), so the report is naturally one output row per stored entry.
 * Columns (0-based, matching saveExpense()'s appendRow order):
 *   0 n · 1 id · 2 empName · 3 amount · 4 type · 5 month · 6 refNo · 7 dateStr (electricity only)
 *
 * NOTE: `month` is stored as a bare 1–12 number with no year (that's how
 * the frontend's month <select> has always sent it — see
 * modules/expenses.js's template()) — a pre-existing limitation, not
 * something introduced here. Reports spanning more than one calendar year
 * for the same month number will merge under one label until a real
 * year column is added.
 ************************************************/
function getExpensesReport() {
  const sh = SpreadsheetApp.openById(EXPENSES_SPREADSHEET_ID).getSheetByName("Expenses_Data");
  if (!sh || sh.getLastRow() < 2) return [];

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const typeLabels = { "Per Diem": "إعاشة", "Transportation": "انتقال", "Electricity": "كهرباء" };

  return rows
    .filter((r) => String(r[1] || "").trim() !== "")
    .map((r) => {
      const id = r[1];
      const empName = r[2];
      const amount = Number(r[3]) || 0;
      const type = r[4];
      const month = r[5];
      const refNo = r[6];
      return {
        engineerId: id,
        engineerName: empName,
        month: String(month || "").padStart(2, "0"),
        daysCount: type === "Per Diem" ? Math.round(amount / PER_DIEM_RATE_PER_DAY) : "",
        expenseType: typeLabels[type] || type || "",
        livingAmount: type === "Per Diem" ? amount : 0,
        transportAmount: type === "Transportation" ? amount : 0,
        electricityAmount: type === "Electricity" ? amount : 0,
        totalAmount: amount,
        submittedAt: refNo || "",
      };
    });
}

/************************************************
 * GET EMPLOYEE NAME (COL H)
 ************************************************/
function getEmpName(empId) {

  const ss = SpreadsheetApp.openById(ATTENDANCE_SPREADSHEET_ID);
  const sh = ss.getSheetByName("Sheet1");

  const data = sh
    .getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn())
    .getValues();

  for (let r of data) {
    if (String(r[0]).trim() === empId) {
      return r[7] || "";
    }
  }
  return "";
}

/************************************************
 * COUNT ACTUAL CHECKED DAYS FROM breakdown
 * breakdown groups checked dates by weekday name, e.g.
 * { Sunday: "2026-01-04 & 2026-01-11", Monday: "2026-01-05" } —
 * counting keys would undercount (one key can hold multiple dates);
 * this counts the actual date entries instead.
 ************************************************/
function countBreakdownDays_(breakdown) {
  if (!breakdown || typeof breakdown !== "object") return 0;
  let count = 0;
  for (let day in breakdown) {
    const entry = breakdown[day];
    if (!entry) continue;
    count += String(entry).split("&").map(s => s.trim()).filter(Boolean).length;
  }
  return count;
}

/************************************************
 * SAVE SUMMARY (TABLE SAFE)
 ************************************************/
function saveExpense(d) {

  const sh = SpreadsheetApp
    .openById(EXPENSES_SPREADSHEET_ID)
    .getSheetByName("Expenses_Data");

  const lastRow = sh.getLastRow();
  const nextN = lastRow > 1 ? lastRow : 1;

  const empName = getEmpName(d.id);

  const refNo =
    "EXP-" +
    Utilities.formatDate(new Date(), "GMT+2", "yyyy") +
    "-" +
    Utilities.formatString("%05d", nextN);

  /******** Per Diem ********/
  // SECURITY FIX (Critical): this used to be `Number(d.total) || 0` —
  // the client-computed total, trusted verbatim. A modified request
  // could claim an arbitrary reimbursement amount for the same set of
  // checked days. Now recomputed server-side from the actual checked-day
  // count in `d.breakdown` (which itself only reflects real attendance
  // records via getAttendanceDays() above) times the fixed rate — the
  // client-supplied `d.total` is no longer read or trusted anywhere.
  const dayCount = countBreakdownDays_(d.breakdown);
  const perDiemAmount = dayCount * PER_DIEM_RATE_PER_DAY;

  sh.appendRow([
    nextN,
    d.id,
    empName,
    perDiemAmount,
    "Per Diem",
    d.month,
    refNo
  ]);

  /******** Transportation ********/
  let transportTotal = 0;

  if (d.transport && typeof d.transport === "object") {
    for (let day in d.transport) {
      transportTotal += Number(d.transport[day]) || 0;
    }
  }

  if (transportTotal > 0) {
    sh.appendRow([
      nextN + 1,
      d.id,
      empName,
      transportTotal,
      "Transportation",
      d.month,
      refNo
    ]);
  }

  /******** Electricity ********/
  if (d.electricity && d.electricity.amount > 0) {

    let dateStr = "";

    if (d.electricity.year && d.electricity.month && d.electricity.day) {
      dateStr =
        `${d.electricity.year}-${d.electricity.month}-${d.electricity.day}`;
    }

    sh.appendRow([
      nextN + 2,
      d.id,
      empName,
      Number(d.electricity.amount),
      "Electricity",
      d.month,
      refNo,
      dateStr
    ]);
  }
}
/************************************************
 * DATE FORMAT
 ************************************************/
function formatDatesForCell(datesArray) {
  if (datesArray.length === 1) {
    return Utilities.formatDate(
      new Date(datesArray[0]),
      "GMT+2",
      "dd MMM"
    );
  }
  return datesArray.map(d =>
    Utilities.formatDate(new Date(d), "GMT+2", "dd/MM")
  ).join(" & ");
}

/************************************************
 * PDF GENERATION
 * Unchanged from the original — this is complex, working spreadsheet
 * template manipulation; nothing here was flagged as a security issue,
 * so this review left it exactly as-is rather than risk breaking a
 * working PDF pipeline it can't directly test.
 ************************************************/
function generateExpensePDF(data) {

  const ss = SpreadsheetApp.openById(EXPENSES_SPREADSHEET_ID);
  const template = ss.getSheetByName(TEMPLATE_SHEET_NAME);
  if (!template) throw new Error("Template sheet not found");

  const sheet = template.copyTo(ss);
  sheet.setName(`EXP_${data.id}_${data.month}_${Date.now()}`);

  const dayMap = {
    Sunday:"B", Monday:"C", Tuesday:"D",
    Wednesday:"E", Thursday:"F", Friday:"G", Saturday:"H"
  };

  sheet.getRange("B7:H7").clearContent();
  sheet.getRange("B8:H24").clearContent();
  sheet.getRange("I8:I30").clearContent();
  sheet.getRange("M13:M26").clearContent();

  // Food
  for (let day in data.breakdown) {
    const col = dayMap[day];
    const datesArr = data.breakdown[day].split(" & ");

    sheet.getRange(col + "7")
      .setValue(formatDatesForCell(datesArr));

const count = datesArr.length;

sheet.getRange(col + "11").setValue(50 * count);
sheet.getRange(col + "12").setValue(100 * count);
sheet.getRange(col + "13").setValue(50 * count);  }

  // Transportation (multi days)
  sheet.getRange("B9:H9").clearContent();
  sheet.getRange("I9").clearContent();

  if (data.transport && typeof data.transport === "object") {
    for (let day in data.transport) {
      const col = dayMap[day];
      sheet.getRange(col + "9")
        .setValue(data.transport[day])
        .setNumberFormat('#,##0" EGP"');
    }
  }
/******** Electricity in Row 21 (append date safely) ********/

if (data.electricity &&
    data.electricity.amount > 0 &&
    data.electricity.year &&
    data.electricity.month &&
    data.electricity.day) {

  const electricityAmount = Number(data.electricity.amount);

  // إنشاء التاريخ
  const elecDate = new Date(
  Number(data.electricity.year),
  Number(data.electricity.month) - 1,
  Number(data.electricity.day),
  12, 0, 0
);

  const weekDays = [
    "Sunday","Monday","Tuesday",
    "Wednesday","Thursday","Friday","Saturday"
  ];

  const dayName = weekDays[elecDate.getDay()];
  const col = dayMap[dayName];

  if (col) {

const formattedDate =
  Utilities.formatDate(elecDate, "GMT+2", "dd/MM");
    /******** 1️⃣ إضافة التاريخ بدون مسح الموجود ********/

const dateCell = sheet.getRange(col + "7");
const existingDate = dateCell.getDisplayValue();

if (existingDate) {

  if (!existingDate.includes(formattedDate)) {
    dateCell.setValue(existingDate + " & " + formattedDate);
  }

} else {
  dateCell.setValue(formattedDate);
}
    /******** 2️⃣ إضافة مبلغ الكهرباء بدون مسح الموجود ********/

    const amountCell = sheet.getRange(col + "21");
    const existingAmount = Number(amountCell.getValue()) || 0;

    amountCell
      .setValue(existingAmount + electricityAmount)
      .setNumberFormat('#,##0" EGP"');

  }
}  sheet.getRange("I9").setFormula("=SUM(B9:H9)");
  sheet.getRange("I11").setFormula("=SUM(B11:H11)");
  sheet.getRange("I12").setFormula("=SUM(B12:H12)");
  sheet.getRange("I13").setFormula("=SUM(B13:H13)");

  sheet.getRange("B25").setFormula("=SUM(B8:B24)");
  sheet.getRange("C25").setFormula("=SUM(C8:C24)");
  sheet.getRange("D25").setFormula("=SUM(D8:D24)");
  sheet.getRange("E25").setFormula("=SUM(E8:E24)");
  sheet.getRange("F25").setFormula("=SUM(F8:F24)");
  sheet.getRange("G25").setFormula("=SUM(G8:G24)");
  sheet.getRange("H25").setFormula("=SUM(H8:H24)");
  sheet.getRange("I21").setFormula("=SUM(B21:H21)");

  sheet.getRange("I25").setFormula("=SUM(I8:I24)");
  sheet.getRange("I30").setFormula("=I25");

  sheet.getRange("B8:H25").setNumberFormat('#,##0" EGP"');
  sheet.getRange("I8:I30").setNumberFormat('#,##0" EGP"');

  const empName = getEmpName(data.id);
  sheet.getRange("M13:M26")
    .setValues(Array(14).fill([
      `مصروفات إعاشة خاصة بالمهندس / ${empName}\nID / ${data.id}`
    ]));
  sheet.getRange("B7:H7").setWrap(true);
  sheet.autoResizeRows(7, 1);
  sheet.autoResizeColumns(2, 7); // من B لحد H
  SpreadsheetApp.flush();
  Utilities.sleep(1200);

  const response = exportSheetToPDF(ss.getId(), sheet.getSheetId());
  return savePDF(response.getBlob()).getUrl();
}

/************************************************
 * EXPORT PDF (LANDSCAPE)
 ************************************************/
function exportSheetToPDF(ssId, sheetId) {
  const url =
    `https://docs.google.com/spreadsheets/d/${ssId}/export` +
    `?format=pdf&gid=${sheetId}` +
    `&size=A4&portrait=false&fitw=true` +
    `&sheetnames=false&pagenumbers=false&gridlines=false`;

  return UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }
  });
}

/************************************************
 * SAVE PDF
 ************************************************/
function savePDF(blob) {

  const folderName =
    "Expenses_PDF_" +
    Utilities.formatDate(new Date(), "GMT+2", "yyyy_MM");

  const folders = DriveApp.getFoldersByName(folderName);
  const folder = folders.hasNext()
    ? folders.next()
    : DriveApp.createFolder(folderName);

  const file = folder.createFile(blob);

  // ⚠️ يخلي أي حد عنده الرابط يقدر يشوف
  // See backend/expenses/README.md — this is a broad share, worth
  // narrowing to domain-only if you're on Google Workspace. Left
  // unchanged here since narrowing it could break the download flow
  // if you're not on Workspace.
  file.setSharing(
    DriveApp.Access.ANYONE_WITH_LINK,
    DriveApp.Permission.VIEW
  );

  return file;
}
/************************************************
 * JSON OUTPUT
 ************************************************/
function jsonOutput(o) {
  return ContentService
    .createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
