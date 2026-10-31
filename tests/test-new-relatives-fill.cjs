const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('D:/CRMGEMINI/crm-responsibility.js');
require('D:/CRMGEMINI/candidate-conditions.js');
require('D:/CRMGEMINI/document-ai-sync.js');
const sync = global.window.CRMDocumentSync;
require('D:/CRMGEMINI/crm-intake.js');
const intake = global.window.CRMIntake;
require('D:/CRMGEMINI/crm-case-assistant.js');
const assistant = global.window.CRMCaseAssistant;

test('New relatives are cleanly planned as whole records and can be filled individually', () => {
  const cand = {
    id: 'c1',
    full_name: 'КОВАЛЬОВА Лідія Василівна',
    profile_data: { relatives: [] }
  };
  const doc = {
    id: 'd1',
    candidate_id: 'c1',
    document_type: 'Актовий запис про народження',
    verification_status: 'Підтверджено',
    ai_extracted: {
      full_name: 'Ковальова Лідія Василівна',
      relatives: [
        { relationship: 'батько', full_name: 'Ковальов Василь Олександрович', birth_date: '1966-04-11' },
        { relationship: 'мати', full_name: 'Ковальова Євгенія Петрівна', birth_date: '1975-01-25' }
      ]
    }
  };

  const plan = sync.plan(doc, cand);
  const relRows = plan.rows.filter(r => r.key.startsWith('relatives'));
  // Should only have 2 rows (one for each new relative), NOT separate fragmented fields
  assert.equal(relRows.length, 2);
  assert.equal(relRows[0].key, 'relatives.0');
  assert.equal(relRows[1].key, 'relatives.1');

  // Labels must be clear
  assert.equal(assistant.label('relatives.0'), 'Родич №1 (новий запис)');
  assert.equal(assistant.label('relatives.1'), 'Родич №2 (новий запис)');

  // canFillField must be true for individual relative acceptance
  assert.equal(intake.canFillField(plan, relRows[0]), true);
  assert.equal(intake.canFillField(plan, relRows[1]), true);

  // reviewedFill with a single new relative row should produce a selection with that relative
  const fill0 = intake.reviewedFill({ doc, plan }, plan, cand, relRows[0]);
  assert.equal(fill0.selections.length, 1);
  assert.equal(fill0.selections[0].incoming.length, 1);
  assert.equal(fill0.selections[0].incoming[0].full_name, 'Ковальов Василь Олександрович');
});
