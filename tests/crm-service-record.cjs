const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{},URL};vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../crm-service-record.js'),'utf8'),context);
const model=context.window.CRMServiceRecord.model;
const value=(state,key)=>state.fields.find(f=>f.key===key)?.value;
const candidate={full_name:'ТЕСТ Прізвище По батькові',sex:'female',worked_before:false,served_before:false,has_children:false,profile_data:{shpk:'Солдат',relatives:[{relationship:'Дитина',full_name:'Старий запис'}]}};
let state=model(candidate,{});
assert.equal(value(state,'not_worked'),'Не працювала');assert.equal(value(state,'not_served'),'Військову службу не проходила');assert.equal(value(state,'rank'),'');assert.equal(value(state,'callup'),'');assert.ok(!value(state,'family').includes('Старий запис'));
const old=JSON.stringify(candidate);candidate.profile_data.education_records=[{institution:'Повна назва',graduation_year:2020}];candidate.profile_data.service_record_print={education_civil:'Погоджене скорочення'};
state=model(candidate,{});assert.equal(value(state,'education_civil'),'Погоджене скорочення');assert.equal(candidate.profile_data.education_records[0].institution,'Повна назва');
candidate.served_before=true;candidate.profile_data.service_type='За контрактом';candidate.profile_data.service_start_date='2022-07-11';candidate.profile_data.work_records=[{kind:'military_service',start_date:'2022-07-11',end_date:'2022-08-23',position:'Курсант',unit:'А0000',order_number:'173',order_date:'2022-07-11',requires_review:false},{kind:'military_service',position:'Помилка OCR',requires_review:true}];
state=model(candidate,{});assert.equal(value(state,'service_0_2'),'Курсант');assert.equal(value(state,'service_1_2'),undefined);assert.ok(!value(state,'callup').includes('контракт'));
assert.equal(value(state,'rank_order'),'');assert.equal(value(state,'family_address'),'');
console.log('Service record model: gender, explicit absence, no SHPK rank, historical service, reviewed records, print-only overrides: PASS');

const wrap=context.window.CRMServiceRecord.wrapText;
assert.deepEqual(Array.from(wrap('Продавець-конс.',10,s=>Array.from(s).length)),['Продавець-','конс.']);
assert.equal(wrap('Електрогазозварювальник',8,s=>s.length).join(''),'Електрогазозварювальник');
candidate.worked_before=true;candidate.profile_data.work_records=[{kind:'employment',employer:'Підприємство',position:'Продавець-конс.'}];
state=model(candidate,{});assert.ok(state.fields.filter(f=>f.key.startsWith('work_')).every(f=>f.center&&f.verticalCenter));
console.log('Long words/hyphens and centered employment rows: PASS');

const audited={full_name:'ТЕСТЕНКО Іван Петрович',military_rank:'Солдат',profile_data:{relatives:[{relationship:'мати',full_name:'ТЕСТЕНКО Олена'},{relation:'БАТЬКО',full_name:'ТЕСТЕНКО Петро'},{relationship:'дружина',full_name:'ТЕСТЕНКО Марія'}],military_rank_records:[{rank:'Сержант',confirmed_by_user:true,order_number:'WRONG'},{rank:'солдат',confirmed_by_user:true,order_number:'RIGHT',order_date:'2020-01-01'}],education_records:[{institution:'Нечіткий заклад',requires_review:true},{institution:'Перевірений заклад',requires_review:false}]}};
state=model(audited,{});assert(value(state,'parents').includes('ТЕСТЕНКО Олена'));assert(value(state,'parents').includes('ТЕСТЕНКО Петро'));assert(value(state,'family').includes('ТЕСТЕНКО Марія'));assert(value(state,'rank_order').includes('RIGHT'));assert(!value(state,'rank_order').includes('WRONG'));assert(!value(state,'education_civil').includes('Нечіткий заклад'));
audited.profile_data.military_rank_records.push({rank:'Солдат',confirmed_by_user:true,order_number:'OTHER'});assert.equal(value(model(audited,{}),'rank_order'),'','Ambiguous rank orders must not be selected silently');
console.log('Audit repairs: case-insensitive relatives, matching rank orders, ambiguous order held, reviewed education only: PASS');

assert.equal(model(audited,{}).issues.length,1,'Ambiguity is reported to the recruiter');
