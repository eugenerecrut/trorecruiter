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

audited.worked_before=true;audited.profile_data.work_records=[{kind:'employment',employer:'ТОВ "ВАЙН-ТАЙМ"',position:'Продавець-консультант, Продавець-консультант',start_date:'2024-11-21',end_date:'2025-05-31'},{kind:'employment',employer:'ПрАТ "Київстар"',position:'Молодший фахівець, Фахівець',start_date:'2023-09-11',end_date:'2024-01-05'}];
state=model(audited,{});
assert.equal(value(state,'work_0_3'),'Продавець-консультант');
assert.equal(value(state,'work_1_3'),'Молодший фахівець, Фахівець');
audited.profile_data.relatives.push({relationship:'Мати',full_name:'ІНША Олена'});
state=model(audited,{});
assert.equal(value(state,'parents'),'Батько: ТЕСТЕНКО Петро','Ambiguous mother is held while unambiguous father prints');
assert.equal(state.issues.length,2,'Ambiguous parent role is reported alongside ambiguous rank order');


// Chronological education ordering: ongoing/unfinished higher education without graduation_year sorts after completed education
{
 const eduCandidate={full_name:'ТЕСТЕНКО Микита Сергійович',profile_data:{education_records:[
  {institution:'Дніпровський аграрно-економічний університет',specialty:'Агрономія',graduation_year:null,study_start_date:'2023-09',requires_review:false},
  {institution:'ЗОШ №2 в м. Вільнянськ',degree:'середня',graduation_year:'2019',requires_review:false},
  {institution:'Федорівський центр професійної освіти',specialty:'Слюсар',graduation_year:'2023',requires_review:false}
 ]}};
 assert.equal(value(model(eduCandidate,{}),'education_civil'),'ЗОШ №2 в м. Вільнянськ, 2019 р.\nФедорівський центр професійної освіти, Слюсар, 2023 р.\nДніпровський аграрно-економічний університет, Агрономія');
}
