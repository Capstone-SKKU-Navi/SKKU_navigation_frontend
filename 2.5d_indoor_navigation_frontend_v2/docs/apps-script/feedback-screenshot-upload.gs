/**
 * SKKU 2.5D Navigation feedback screenshot collector.
 *
 * Setup:
 * 1. Paste this file into Google Apps Script.
 * 2. Set SPAM_GUARD_TOKEN to any short random value.
 * 3. Run setup() once and authorize Drive/Sheets access.
 * 4. Deploy as Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the /exec URL into FEEDBACK_SCREENSHOT_UPLOAD_URL.
 * 6. Copy SPAM_GUARD_TOKEN into FEEDBACK_SCREENSHOT_TOKEN.
 */

const SPAM_GUARD_TOKEN = '';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const SHEET_NAME = 'feedback_screenshots';
const DRIVE_FOLDER_NAME = 'SKKU Navigation Feedback Screenshots';

// Optional but recommended: paste the spreadsheet ID from the Google Form
// response sheet URL. Then screenshot data and Form responses live in the
// same spreadsheet, and the Form response tab can show image thumbnails.
const FORM_RESPONSE_SPREADSHEET_ID = '';
// Optional. If empty or not found, the script auto-detects the response tab
// by looking for the "스크린샷 ID" header.
const FORM_RESPONSE_SHEET_NAME = '';
const FORM_SCREENSHOT_ID_HEADER = '스크린샷 ID';
const FORM_SCREENSHOT_IMAGE_HEADER = '스크린샷';
const FORM_SCREENSHOT_LINK_HEADER = '스크린샷 링크';

function setup() {
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('FOLDER_ID');
  let sheetId = props.getProperty('SPREADSHEET_ID');

  if (!folderId) {
    const folder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
    folderId = folder.getId();
    props.setProperty('FOLDER_ID', folderId);
  }

  if (FORM_RESPONSE_SPREADSHEET_ID) {
    sheetId = FORM_RESPONSE_SPREADSHEET_ID;
    props.setProperty('SPREADSHEET_ID', sheetId);
  }

  if (!sheetId) {
    const spreadsheet = SpreadsheetApp.create('SKKU Navigation Feedback Screenshots');
    sheetId = spreadsheet.getId();
    props.setProperty('SPREADSHEET_ID', sheetId);
  }

  const sheet = getSheet_();
  ensureHeader_(sheet);
  setupFormResponseScreenshotColumns();
  ensureFormSubmitTrigger_();
  syncFormResponseScreenshotColumns();

  Logger.log('Spreadsheet URL: https://docs.google.com/spreadsheets/d/' + sheetId + '/edit');
  Logger.log('Drive folder URL: https://drive.google.com/drive/folders/' + folderId);
}

function doPost(e) {
  try {
    const p = e.parameter || {};
    if (SPAM_GUARD_TOKEN && p.token !== SPAM_GUARD_TOKEN) {
      return json_({ ok: false, error: 'invalid_token' });
    }

    const reportId = safeText_(p.report_id || makeReportId_(), 80);
    const issueType = safeText_(p.issue_type || '', 120);
    const target = safeText_(p.target || '', 500);
    const debug = safeText_(p.debug || '', 5000);
    const dataUrl = p.screenshot_data_url || '';

    if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) {
      appendRow_({ reportId, issueType, target, debug, status: 'missing_or_invalid_image' });
      return json_({ ok: false, reportId, error: 'missing_or_invalid_image' });
    }

    const parts = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    const mimeType = parts[1];
    const bytes = Utilities.base64Decode(parts[2]);
    if (bytes.length > MAX_IMAGE_BYTES) {
      appendRow_({ reportId, issueType, target, debug, status: 'image_too_large' });
      return json_({ ok: false, reportId, error: 'image_too_large' });
    }

    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const blob = Utilities.newBlob(bytes, mimeType, reportId + '.' + extension);
    const file = getFolder_().createFile(blob);

    // Needed for the IMAGE() thumbnail formula to render inside Google Sheets.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId = file.getId();
    const viewUrl = 'https://drive.google.com/file/d/' + fileId + '/view';
    const imageUrl = 'https://drive.google.com/uc?export=view&id=' + fileId;
    appendRow_({
      reportId,
      issueType,
      target,
      debug,
      status: 'saved',
      fileId,
      viewUrl,
      imageUrl,
    });
    updateFormResponseScreenshot_(reportId, imageUrl, viewUrl);

    return json_({ ok: true, reportId, viewUrl });
  } catch (err) {
    appendRow_({
      reportId: 'error_' + makeReportId_(),
      issueType: '',
      target: '',
      debug: String(err && err.stack || err),
      status: 'script_error',
    });
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function appendRow_(row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const sheet = getSheet_();
    ensureHeader_(sheet);
    const imageFormula = row.imageUrl ? '=IMAGE("' + row.imageUrl + '", 4, 180, 320)' : '';
    const linkFormula = row.viewUrl ? '=HYPERLINK("' + row.viewUrl + '", "Open")' : '';
    sheet.appendRow([
      new Date(),
      row.reportId || '',
      row.issueType || '',
      row.target || '',
      row.status || '',
      imageFormula,
      linkFormula,
      row.fileId || '',
      row.debug || '',
      row.imageUrl || '',
      row.viewUrl || '',
    ]);
  } finally {
    lock.releaseLock();
  }
}

function ensureHeader_(sheet) {
  const headers = [
    'created_at',
    'report_id',
    'issue_type',
    'target',
    'status',
    'screenshot',
    'drive_link',
    'file_id',
    'debug',
    'image_url',
    'view_url',
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
    headers.forEach(function (header, index) {
      if (!existing[index]) {
        sheet.getRange(1, index + 1).setValue(header);
      }
    });
  }

  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, 5, 160);
  sheet.setColumnWidth(6, 340);
  sheet.setColumnWidth(7, 100);
  sheet.setColumnWidth(9, 520);
  sheet.hideColumns(10, 2);
}

function setupFormResponseScreenshotColumns() {
  const sheet = getFormResponseSheet_();
  if (!sheet) return;

  const headerMap = getHeaderMap_(sheet);
  const screenshotIdCol = headerMap[FORM_SCREENSHOT_ID_HEADER];
  if (!screenshotIdCol) {
    throw new Error('Missing Form response column: ' + FORM_SCREENSHOT_ID_HEADER);
  }

  const imageCol = ensureColumnAfter_(sheet, FORM_SCREENSHOT_IMAGE_HEADER, screenshotIdCol);
  const linkCol = ensureColumnAfter_(sheet, FORM_SCREENSHOT_LINK_HEADER, imageCol);
  sheet.setColumnWidth(imageCol, 340);
  sheet.setColumnWidth(linkCol, 120);
}

function syncFormResponseScreenshotColumns() {
  const sheet = getFormResponseSheet_();
  if (!sheet) return;

  setupFormResponseScreenshotColumns();
  const headerMap = getHeaderMap_(sheet);
  const screenshotIdCol = headerMap[FORM_SCREENSHOT_ID_HEADER];
  const imageCol = headerMap[FORM_SCREENSHOT_IMAGE_HEADER];
  const linkCol = headerMap[FORM_SCREENSHOT_LINK_HEADER];
  if (!screenshotIdCol || !imageCol || !linkCol) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const screenshots = getScreenshotLookup_();
  for (let row = 2; row <= lastRow; row++) {
    const reportId = String(sheet.getRange(row, screenshotIdCol).getValue() || '').trim();
    const screenshot = screenshots[reportId];
    if (screenshot) {
      setFormResponseScreenshotRow_(sheet, row, imageCol, linkCol, screenshot.imageUrl, screenshot.viewUrl);
    }
  }
}

function updateFormResponseScreenshot_(reportId, imageUrl, viewUrl) {
  const sheet = getFormResponseSheet_();
  if (!sheet) return;

  setupFormResponseScreenshotColumns();
  const headerMap = getHeaderMap_(sheet);
  const screenshotIdCol = headerMap[FORM_SCREENSHOT_ID_HEADER];
  const imageCol = headerMap[FORM_SCREENSHOT_IMAGE_HEADER];
  const linkCol = headerMap[FORM_SCREENSHOT_LINK_HEADER];
  if (!screenshotIdCol || !imageCol || !linkCol) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const ids = sheet.getRange(2, screenshotIdCol, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === reportId) {
      setFormResponseScreenshotRow_(sheet, i + 2, imageCol, linkCol, imageUrl, viewUrl);
    }
  }
}

function setFormResponseScreenshotRow_(sheet, row, imageCol, linkCol, imageUrl, viewUrl) {
  if (imageUrl) {
    sheet.getRange(row, imageCol).setFormula('=IMAGE("' + imageUrl + '", 4, 180, 320)');
  }
  if (viewUrl) {
    sheet.getRange(row, linkCol).setFormula('=HYPERLINK("' + viewUrl + '", "Open")');
  }
  sheet.setRowHeight(row, 190);
}

function getScreenshotLookup_() {
  const sheet = getSheet_();
  ensureHeader_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const headerMap = getHeaderMap_(sheet);
  const reportIdCol = headerMap.report_id;
  const imageUrlCol = headerMap.image_url;
  const viewUrlCol = headerMap.view_url;
  if (!reportIdCol || !imageUrlCol || !viewUrlCol) return {};

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const lookup = {};
  values.forEach(function (row) {
    const reportId = String(row[reportIdCol - 1] || '').trim();
    const imageUrl = String(row[imageUrlCol - 1] || '').trim();
    const viewUrl = String(row[viewUrlCol - 1] || '').trim();
    if (reportId && imageUrl) lookup[reportId] = { imageUrl: imageUrl, viewUrl: viewUrl };
  });
  return lookup;
}

function getFormResponseSheet_() {
  if (!FORM_RESPONSE_SPREADSHEET_ID && !PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')) {
    return null;
  }
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || FORM_RESPONSE_SPREADSHEET_ID);
  if (FORM_RESPONSE_SHEET_NAME) {
    const namedSheet = ss.getSheetByName(FORM_RESPONSE_SHEET_NAME);
    if (namedSheet) return namedSheet;
  }

  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const headerMap = getHeaderMap_(sheets[i]);
    if (headerMap[FORM_SCREENSHOT_ID_HEADER]) return sheets[i];
  }

  return null;
}

function ensureColumnAfter_(sheet, header, afterCol) {
  let headerMap = getHeaderMap_(sheet);
  if (headerMap[header]) return headerMap[header];

  sheet.insertColumnAfter(afterCol);
  const col = afterCol + 1;
  sheet.getRange(1, col).setValue(header);
  return col;
}

function getHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  values.forEach(function (value, index) {
    const text = String(value || '').trim();
    if (text) map[text] = index + 1;
  });
  return map;
}

function ensureFormSubmitTrigger_() {
  const sheet = getFormResponseSheet_();
  if (!sheet) return;
  const ss = sheet.getParent();
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'syncFormResponseScreenshotColumns';
  });
  if (!exists) {
    ScriptApp.newTrigger('syncFormResponseScreenshotColumns')
      .forSpreadsheet(ss)
      .onFormSubmit()
      .create();
  }
}

function toA1_(col) {
  let s = '';
  while (col > 0) {
    const m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - m) / 26);
  }
  return s;
}

function getSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setup() first: missing SPREADSHEET_ID');
  const ss = SpreadsheetApp.openById(id);
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function getFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  if (!id) throw new Error('Run setup() first: missing FOLDER_ID');
  return DriveApp.getFolderById(id);
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeText_(value, maxLength) {
  return String(value).slice(0, maxLength);
}

function makeReportId_() {
  return Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss") + '_' + Utilities.getUuid().slice(0, 8);
}
