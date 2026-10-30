const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../document-review-editor.js'),'utf8');
test('Existing authenticated review editor exposes birth parents and diploma fields',()=>{
 for(const field of ['rnokpp','birth_place','passport_expiry_date','unzr','name_genitive','phone','military_rank','desired_position','military_specialty','shpk','tariff_grade','relatives.','education_records.','owner_full_name','owner_birth_date','study_start_date','study_end_date','diploma_series','diploma_number'])assert(source.includes(field));
 assert(source.includes("query.eq('id',id).select('id')"));assert(source.includes("query.eq('ai_processed_at',d.ai_processed_at)"));
 assert(!source.includes("update({ai_raw_response"));
});
test('Nested review edits preserve array shape and unrelated fields',()=>{
 const extracted={relatives:[{full_name:'Неповне ім’я',birth_date:'1970-01-01'}],education_records:[{owner_full_name:'Іван',degree:'бакалавр',source_pages:[1,7]}],marriage_record:{act_number:'1',registration_date:'2000-01-01'}};
 const snippet=source.match(/const parts=key.split\('\.'\);[\s\S]*?target\[parts.at\(-1\)\]=value\|\|null;/)[0];
 for(const [key,value] of [['relatives.0.full_name','Тестенко Іван Петрович'],['education_records.0.owner_full_name','Тестенко Іван'],['marriage_record.act_number','2']])vm.runInNewContext(snippet,{extracted,key,value});
 assert(Array.isArray(extracted.relatives));assert(Array.isArray(extracted.education_records));assert.equal(extracted.relatives[0].birth_date,'1970-01-01');assert.deepEqual(extracted.education_records[0].source_pages,[1,7]);assert.equal(extracted.marriage_record.registration_date,'2000-01-01');
});
