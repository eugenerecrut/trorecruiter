const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../crm-dashboard.js'),'utf8');
const c=vm.createContext({CRMWorkspace:{}});c.window=c;vm.runInContext(source,c);
const status=extra=>c.CRMDashboard.documentStatus({errors:0,processing:0,review:0,unknown:0,total:5,verified:0,received:0,...extra});
test('dashboard describes document state rather than recruitment stage',()=>{
 assert.equal(status({}),'Очікуємо документи');
 assert.equal(status({received:2}),'Додати документи');
 assert.equal(status({verified:5}),'Комплект перевірено');
 assert.equal(status({total:0}),'Очікуємо документи');
});
test('processing and exceptions take precedence over complete counters',()=>{
 assert.equal(status({verified:5,errors:1,processing:1}),'Помилка AI');
 assert.equal(status({verified:5,processing:1,review:1}),'Розпізнавання');
 assert.equal(status({verified:5,review:1}),'Потрібна перевірка');
 assert.equal(status({verified:5,unknown:1}),'Уточнити відомості');
});
test('dashboard rendering and legacy overview do not show planning prompts',()=>{
 assert(!source.includes('<th>Етап</th>'));assert(source.includes('esc(documentStatus(s))'));
 const workspace=fs.readFileSync(require('node:path').join(__dirname,'../crm-workspace.js'),'utf8');
 assert(!workspace.includes('Потрібен контакт сьогодні'));assert(!workspace.includes('const contacts=candidates.filter'));
 assert(source.includes('window.CRMCaseTasks=')); // Historical consumers retain their API.
});
