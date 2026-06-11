const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'src', 'services', 'feedbackForm.ts');

function loadFeedbackModule() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    encodeURIComponent,
    require,
    console,
  };
  vm.runInNewContext(transpiled, sandbox, { filename: sourcePath });
  return module.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nexpected: ${expected}\nactual:   ${actual}`);
  }
}

const feedback = loadFeedbackModule();

const defaultConfig = feedback.getFeedbackFormConfig();
assertEqual(
  defaultConfig.entries.screenshotReportId,
  'entry.2038317800',
  'defaults screenshot report id entry',
);

const configured = {
  formUrl: 'https://docs.google.com/forms/d/e/demo/viewform?usp=sf_link',
  entries: {
    type: 'entry.111',
    target: 'entry.222',
    debug: 'entry.333',
    screenshotReportId: 'entry.444',
  },
};

const url = feedback.buildFeedbackFormUrl(configured, {
  type: '방/지도 오류',
  target: '제1공학관 / 2F / 21517',
  debug: 'level=2\nref=21517',
  screenshotReportId: 'fb_20260607T123456_4fzzzx',
});
const parsed = new URL(url);
assertEqual(parsed.origin, 'https://docs.google.com', 'keeps Google Form origin');
assertEqual(parsed.searchParams.get('entry.111'), '방/지도 오류', 'prefills issue type');
assertEqual(parsed.searchParams.get('entry.222'), '제1공학관 / 2F / 21517', 'prefills target');
assertEqual(parsed.searchParams.get('entry.333'), 'level=2\nref=21517', 'prefills debug payload');
assertEqual(parsed.searchParams.get('entry.444'), 'fb_20260607T123456_4fzzzx', 'prefills screenshot report id');
assert(!parsed.searchParams.has('entry.undefined'), 'does not write missing entry ids');

const unconfigured = feedback.buildFeedbackFormUrl({ formUrl: '', entries: configured.entries }, {
  type: '기타',
});
assertEqual(unconfigured, null, 'returns null until the Google Form URL is configured');

const roomTarget = feedback.formatRoomFeedbackTarget({
  building: 'eng1',
  level: 2,
  ref: '21517',
  name: 'CAD실',
});
assertEqual(roomTarget, 'eng1 / 2F / 21517 (CAD실)', 'formats room target compactly');

const pointTarget = feedback.formatPointFeedbackTarget({
  building: 'unknown',
  level: -1,
  lng: 126.97612345,
  lat: 37.29398765,
});
assertEqual(pointTarget, 'unknown / B1 / 126.976123, 37.293988', 'formats fallback map point');

const routeRoom = feedback.formatRouteEndpointFeedbackLabel({
  kind: 'room',
  building: 'eng1',
  ref: '21517',
  name: 'CAD실',
});
assertEqual(routeRoom, 'eng1 / 21517 (CAD실)', 'formats room route endpoint');

const routeCoord = feedback.formatRouteEndpointFeedbackLabel({
  kind: 'coord',
  building: 'eng1',
  level: 2,
  lng: 126.97612345,
  lat: 37.29398765,
});
assertEqual(routeCoord, 'eng1 / 2F / 126.976123, 37.293988', 'formats coordinate route endpoint with location details');

assertEqual(feedback.formatRouteEndpointFeedbackLabel(null), '미선택', 'formats missing route endpoint');

const reportId = feedback.createFeedbackReportId(new Date('2026-06-07T12:34:56Z'), () => 0.123456789);
assert(/^fb_20260607T123456_[a-z0-9]{6}$/.test(reportId), 'creates compact stable-ish report id');

const screenshotDebug = feedback.appendScreenshotDebug('base debug', {
  reportId: 'fb_20260607T123456_4fzzzx',
  status: 'queued',
});
assert(
  screenshotDebug.includes('screenshot_report_id: fb_20260607T123456_4fzzzx')
    && screenshotDebug.includes('screenshot_status: queued'),
  'appends screenshot status to debug payload',
);

console.log('feedback form tests passed');
