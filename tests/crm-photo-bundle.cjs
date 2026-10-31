const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadScript(filePath, sandbox) {
  const code = fs.readFileSync(path.join(__dirname, '..', filePath), 'utf8');
  vm.runInContext(code, sandbox);
}

const sandbox = {
  window: {},
  document: {
    addEventListener: () => {},
    querySelectorAll: () => []
  },
  console
};
sandbox.window = sandbox;
vm.createContext(sandbox);

loadScript('candidate-name.js', sandbox);
loadScript('candidate-conditions.js', sandbox);
loadScript('document-presence.js', sandbox);
loadScript('document-state.js', sandbox);

const reqs = [
  { id: 'req-passport', document_type: 'Копія паспорта/ID Картки', is_required: true, active: true },
  { id: 'req-photo-9x12', document_type: 'Фото 9×12', is_required: true, active: true, sort_order: 90 },
  { id: 'req-photo-3x4', document_type: 'Фото 3×4', is_required: true, active: true, sort_order: 100 }
];

const candidateEmpty = {
  id: 'cand-1',
  service_type: 'За мобілізацією',
  profile_data: {}
};

// 1. Verify rows combine 9x12 and 3x4 into a single photo-bundle row
const rowsEmpty = sandbox.CRMDocumentState.rows(candidateEmpty, reqs, []);
assert.strictEqual(rowsEmpty.length, 2, 'Should only have 2 rows: passport and 1 combined photo row');
const photoRowEmpty = rowsEmpty.find(r => r.group === 'photo-bundle');
assert.ok(photoRowEmpty, 'Photo bundle row exists');
assert.strictEqual(photoRowEmpty.r.document_type, 'Фотокартки (3×4 або 9×12)');
assert.strictEqual(photoRowEmpty.received, false);
assert.strictEqual(photoRowEmpty.verified, false);

const summaryEmpty = sandbox.CRMDocumentState.summary(candidateEmpty, reqs, []);
assert.strictEqual(summaryEmpty.total, 2, 'Total required items must be 2, not 3');
assert.strictEqual(summaryEmpty.received, 0);

// 2. Upload only 3x4 photo -> satisfies the requirement!
const docsWith3x4 = [
  { id: 'doc-p1', document_type: 'Фото 3×4', storage_path: 'photos/3x4.jpg', verification_status: 'Підтверджено' }
];
const rows3x4 = sandbox.CRMDocumentState.rows(candidateEmpty, reqs, docsWith3x4);
const photoRow3x4 = rows3x4.find(r => r.group === 'photo-bundle');
assert.strictEqual(photoRow3x4.received, true, 'Any photo uploaded marks requirement received');
assert.strictEqual(photoRow3x4.verified, true, 'Verified 3x4 marks photo requirement verified');
assert.strictEqual(photoRow3x4.files.length, 1);

const summary3x4 = sandbox.CRMDocumentState.summary(candidateEmpty, reqs, docsWith3x4);
assert.strictEqual(summary3x4.total, 2);
assert.strictEqual(summary3x4.received, 1);
assert.strictEqual(summary3x4.verified, 1);

// 3. Upload only 9x12 photo -> satisfies the requirement!
const docsWith9x12 = [
  { id: 'doc-p2', document_type: 'Фото 9×12', storage_path: 'photos/9x12.jpg', verification_status: 'Підтверджено' }
];
const rows9x12 = sandbox.CRMDocumentState.rows(candidateEmpty, reqs, docsWith9x12);
const photoRow9x12 = rows9x12.find(r => r.group === 'photo-bundle');
assert.strictEqual(photoRow9x12.received, true);
assert.strictEqual(photoRow9x12.verified, true);

// 4. No files uploaded, but physical confirmation checkbox is ticked (all_photos_present: true)
const candidateConfirmed = {
  id: 'cand-2',
  service_type: 'За мобілізацією',
  profile_data: { all_photos_present: true }
};
const rowsConfirmed = sandbox.CRMDocumentState.rows(candidateConfirmed, reqs, []);
const photoRowConfirmed = rowsConfirmed.find(r => r.group === 'photo-bundle');
assert.strictEqual(photoRowConfirmed.received, true, 'all_photos_present satisfies received');
assert.strictEqual(photoRowConfirmed.verified, true, 'all_photos_present satisfies verified');

const summaryConfirmed = sandbox.CRMDocumentState.summary(candidateConfirmed, reqs, []);
assert.strictEqual(summaryConfirmed.received, 1);
assert.strictEqual(summaryConfirmed.verified, 1);

// 5. Verify optional "при наявності" and stage-based VLK documents are NOT displayed when empty
const reqsWithOptional = [
  ...reqs,
  { id: 'req-name-change', document_type: 'Свідоцтво про зміну імені / прізвища', is_required: false, active: true },
  { id: 'req-driver', document_type: 'Копія посвідчення водія / інші посвідчення', is_required: false, active: true },
  { id: 'req-blood', document_type: 'Довідка з визначенням групи крові та резус-фактору', is_required: false, active: true },
  { id: 'req-vlk', document_type: 'Довідка ВЛК', is_required: true, active: true },
  { id: 'req-app13', document_type: 'Додаток 13 (Картка обстеження та медичного огляду)', is_required: true, active: true }
];

const rowsWithoutOptionalDocs = sandbox.CRMDocumentState.rows(candidateEmpty, reqsWithOptional, []);
assert.strictEqual(rowsWithoutOptionalDocs.some(r => /змін.*(?:імен|прізвищ)/i.test(r.r.document_type)), false, 'Name change hidden when empty');
assert.strictEqual(rowsWithoutOptionalDocs.some(r => /посвідчення водія/i.test(r.r.document_type)), false, 'Driver license hidden when empty');
assert.strictEqual(rowsWithoutOptionalDocs.some(r => /групи крові/i.test(r.r.document_type)), false, 'Blood group cert hidden when empty');
assert.strictEqual(rowsWithoutOptionalDocs.some(r => /довідка влк/i.test(r.r.document_type)), false, 'VLK certificate hidden when empty');
assert.strictEqual(rowsWithoutOptionalDocs.some(r => /додаток\s*13/i.test(r.r.document_type)), false, 'Dodatok 13 hidden when empty');

// When uploaded, they appear in rows
const docsWithDriverAndVLK = [
  { id: 'doc-driver-1', document_type: 'Копія посвідчення водія / інші посвідчення', storage_path: 'driver.pdf', verification_status: 'Підтверджено' },
  { id: 'doc-vlk-1', document_type: 'Довідка ВЛК', storage_path: 'vlk.pdf', verification_status: 'Підтверджено' }
];
const rowsWithUploaded = sandbox.CRMDocumentState.rows(candidateEmpty, reqsWithOptional, docsWithDriverAndVLK);
const driverRow = rowsWithUploaded.find(r => /посвідчення водія/i.test(r.r.document_type));
assert.ok(driverRow, 'Driver license row appears when uploaded');
assert.strictEqual(driverRow.r.is_required, false, 'Driver license is optional (необов’язковий)');
assert.strictEqual(driverRow.received, true);

const vlkRow = rowsWithUploaded.find(r => /довідка влк/i.test(r.r.document_type));
assert.ok(vlkRow, 'VLK row appears when uploaded');
assert.strictEqual(vlkRow.received, true);

console.log('PASS: Unified photo bundle, single digital photo sufficiency, and physical photos confirmation checkbox verified successfully.');
console.log('PASS: Name change, driver license, blood type cert, VLK and Dodatok 13 are hidden by default and only display when present.');
