const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('Testing Candidate Portal Implementation...');

// 1. Check candidate.html exists and is valid
const portalHtmlPath = path.join(__dirname, '../candidate.html');
assert.ok(fs.existsSync(portalHtmlPath), 'candidate.html must exist');
const portalHtml = fs.readFileSync(portalHtmlPath, 'utf8');
assert.ok(portalHtml.includes('<!DOCTYPE html>'), 'candidate.html must be valid HTML5');
assert.ok(portalHtml.includes('<meta name="viewport"'), 'candidate.html must include viewport for mobile');
assert.ok(portalHtml.includes('Кабінет кандидата'), 'candidate.html must have Ukrainian title');
assert.ok(portalHtml.includes('candidate-portal.js'), 'candidate.html must include candidate-portal.js script');
assert.ok(portalHtml.includes('portalApp'), 'candidate.html must have portalApp container');
console.log('✓ candidate.html structure verified');

// 2. Check candidate-portal.js exists and syntax is valid
const portalJsPath = path.join(__dirname, '../candidate-portal.js');
assert.ok(fs.existsSync(portalJsPath), 'candidate-portal.js must exist');
const portalJs = fs.readFileSync(portalJsPath, 'utf8');
assert.doesNotThrow(() => new vm.Script(portalJs), 'candidate-portal.js must have valid syntax');
assert.ok(portalJs.includes('crm_portal_get_case'), 'candidate-portal.js must call crm_portal_get_case RPC');
assert.ok(portalJs.includes('crm_portal_submit_document'), 'candidate-portal.js must call crm_portal_submit_document RPC');
assert.ok(portalJs.includes('candidate-documents'), 'candidate-portal.js must upload to candidate-documents bucket');
console.log('✓ candidate-portal.js syntax and RPC calls verified');

// 3. Verify WhatsApp Portal link generation in crm-whatsapp.js
const waContext = { window: {}, URL, encodeURIComponent };
waContext.window = waContext;
waContext.globalThis = waContext;
vm.createContext(waContext);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../crm-whatsapp.js'), 'utf8'), waContext);
assert.equal(typeof waContext.CRMWhatsApp.openPortalShareModal, 'function', 'CRMWhatsApp must export openPortalShareModal');
console.log('✓ crm-whatsapp.js openPortalShareModal function verified');

// 4. Verify candidate-card-v3 header button
const cardV3Path = path.join(__dirname, '../candidate-card-v3.js');
const cardV3Content = fs.readFileSync(cardV3Path, 'utf8');
assert.ok(cardV3Content.includes('data-v3-portal'), 'candidate-card-v3.js must contain data-v3-portal button');
assert.ok(cardV3Content.includes('openPortalShareModal'), 'candidate-card-v3.js must hook openPortalShareModal');
console.log('✓ candidate-card-v3.js portal button integration verified');

// 5. Verify SQL migration file exists and contains essential definitions
const migrationPath = path.join(__dirname, '../supabase/migrations/20261030203500_candidate_portal.sql');
assert.ok(fs.existsSync(migrationPath), 'Migration 20261030203500_candidate_portal.sql must exist');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
assert.ok(migrationSql.includes('portal_token'), 'Migration must add portal_token column');
assert.ok(migrationSql.includes('crm_portal_get_case'), 'Migration must create crm_portal_get_case function');
assert.ok(migrationSql.includes('crm_portal_submit_document'), 'Migration must create crm_portal_submit_document function');
console.log('✓ Supabase migration file verified');

console.log('\nAll Candidate Portal tests passed successfully!');
