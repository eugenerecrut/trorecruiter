const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('D:/CRMGEMINI/candidate-conditions.js');
const sync = require('D:/CRMGEMINI/document-ai-sync.js');

test('OCR misclassified VOS into SHPK is properly sanitized and routed to military_specialty', () => {
  const flattened = sync.flatten({
    shpk: '790037А/256',
    military_rank: 'солдат',
    military_specialty: null
  });
  assert.equal(flattened.military_specialty, '790037А');
  assert.equal(flattened.shpk, 'солдат');

  const doc = {
    id: 'd2ea91a2-eac4-4224-8326-b77f1f2739e3',
    document_type: 'Копія рекомендаційного листа',
    file_name: 'РЛ на мобілізацію  БІЛИЙ.pdf',
    ai_extracted: {
      full_name: 'БІЛИЙ Владислав Миколайович',
      shpk: '790037А/256',
      military_rank: 'солдат',
      tariff_grade: '5/2',
      military_specialty: null
    }
  };

  const cand = {
    id: '7c7e1a35-75ba-4eec-a1cd-ebd1a894f6f8',
    full_name: 'БІЛИЙ Владислав Миколайович',
    military_rank: 'солдат',
    military_specialty: '790037А',
    profile_data: {
      shpk: 'солдат',
      tariff_grade: '5/2',
      military_specialty: '790037А'
    }
  };

  const plan = sync.plan(doc, cand);
  const shpkRow = plan.rows.find(r => r.key === 'shpk');
  assert.equal(shpkRow.action, 'leave');
  assert.equal(shpkRow.incoming, 'солдат');

  const vosRow = plan.rows.find(r => r.key === 'military_specialty');
  assert.equal(vosRow.action, 'leave');
  assert.equal(vosRow.incoming, '790037А');

  const conflicts = plan.rows.filter(r => r.action === 'conflict');
  assert.equal(conflicts.length, 0, 'No conflicts should exist for candidate Білий');
});
