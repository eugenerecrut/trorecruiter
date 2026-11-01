const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../candidate-conditions.js');
const sync = require('../document-ai-sync.js');

test('Mixed printed codes (e.g. 790037А/256 in shpk, 5/2 in tariff_grade) are flagged as requiring review and never auto-filled', () => {
  const extracted = {
    shpk: '790037А/256',
    military_rank: 'солдат',
    tariff_grade: '5/2',
    military_specialty: null
  };

  const flattened = sync.flatten(extracted);
  // Raw values are preserved without unexpected corruption
  assert.equal(flattened.shpk, '790037А/256');
  assert.equal(flattened.tariff_grade, '5/2');

  // Validations: neither mixed shpk nor slash tariff grade is a valid clean field
  assert.equal(sync.valid('shpk', flattened.shpk), false, 'shpk must be a valid military rank, not mixed numbers');
  assert.equal(sync.valid('tariff_grade', flattened.tariff_grade), false, 'tariff_grade must be a single integer 1..99');

  const doc = {
    id: 'd2ea91a2-eac4-4224-8326-b77f1f2739e3',
    document_type: 'Копія рекомендаційного листа',
    file_name: 'РЛ на мобілізацію БІЛИЙ.pdf',
    ai_extracted: {
      full_name: 'БІЛИЙ Владислав Миколайович',
      birth_date: '1995-05-15',
      rnokpp: '1234567890',
      shpk: '790037А/256',
      military_rank: 'солдат',
      tariff_grade: '5/2'
    }
  };

  const emptyCandidate = {
    id: 'c1',
    full_name: 'БІЛИЙ Владислав Миколайович',
    birth_date: '1995-05-15',
    rnokpp: '1234567890',
    profile_data: {}
  };

  const plan = sync.plan(doc, emptyCandidate);
  
  // Mixed fields must be conflicts, not automatic fills
  const shpkRow = plan.rows.find(r => r.key === 'shpk');
  assert.equal(shpkRow.action, 'conflict');

  const tariffRow = plan.rows.find(r => r.key === 'tariff_grade');
  assert.equal(tariffRow.action, 'conflict');

  // Selections to auto-apply must NOT contain invalid mixed codes
  assert.equal(plan.selections.some(s => s.key === 'shpk'), false);
  assert.equal(plan.selections.some(s => s.key === 'tariff_grade'), false);
});
