const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('D:/CRMGEMINI/crm-responsibility.js');
require('D:/CRMGEMINI/candidate-conditions.js');
const sync = require('D:/CRMGEMINI/document-ai-sync.js');

test('3-digit VOS is valid and fallback name from ai_raw_response avoids undefined owner', () => {
  assert.equal(sync.valid('military_specialty', '712'), true);
  assert.equal(sync.valid('military_specialty', '790037А'), true);
  assert.equal(sync.valid('military_specialty', '219671'), true);

  const cand = {
    id: 'c_bych',
    full_name: 'БИЧ Валентина Анатоліївна',
    birth_date: '1990-11-20',
    military_specialty: '712',
    profile_data: { military_specialty: '712' }
  };

  const doc = {
    id: 'd_bych',
    candidate_id: 'c_bych',
    document_type: 'Копія рекомендаційного листа',
    verification_status: 'Підтверджено',
    ai_raw_response: {
      extracted: {
        personal: {
          full_name: 'БИЧ Валентина Анатоліївна',
          birth_date: '1990-11-20'
        }
      }
    },
    ai_extracted: {
      full_name: null,
      birth_date: null,
      military_specialty: '712'
    }
  };

  const plan = sync.plan(doc, cand);
  const vosRow = plan.rows.find(r => r.key === 'military_specialty');
  assert.equal(vosRow.action, 'leave');
  assert.equal(vosRow.incoming, '712');
  const conflicts = plan.rows.filter(r => r.action === 'conflict');
  assert.equal(conflicts.length, 0);
});
