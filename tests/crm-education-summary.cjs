const fs=require('fs'),vm=require('vm'),a=require('assert');const ctx={window:{}};vm.runInNewContext(fs.readFileSync('education-document.js','utf8'),ctx);const E=ctx.window.CRMEducation;
a.equal(E.summary({bio_education_claims:[{institution:'Коледж',degree:'молодший спеціаліст',start_date:{value:'2017'},end_date:{value:'2021'},specialty:'Інженерія'}]}),'2017 — 2021, Коледж, молодший спеціаліст, Інженерія');
a.equal(E.summary({bio_education_claims:[{institution:'Не перевірено',requires_review:true}]}),'');
a.equal(E.summary({education_records:[{institution:'Університет',graduation_year:'2024',degree:'бакалавр'}],bio_education_claims:[{institution:'Коледж'}]}),'2024, Університет, бакалавр');
a.equal(E.summary({education:'Ручні дані',bio_education_claims:[{institution:'Коледж'}]}),'Ручні дані');
a.equal(E.summary({}, {education:'Збережений текст'}),'Збережений текст');console.log('PASS: education summary uses saved claims, dates and diplomas; preserves manual data; excludes unreviewed claims.');

const candidate={full_name:'Тестова Ганна Олександрівна',birth_date:'1997-09-24'};
const record={degree:'середня',institution:'Школа',graduation_year:2014,diploma_present:true,diploma_number:null,owner_full_name:candidate.full_name,owner_birth_date:candidate.birth_date,requires_review:false};
a.equal(E.review({education_records:[record]},candidate).accepted,0);
a.equal(E.review({source_verified:true,education_records:[record]},candidate).accepted,1);
a.equal(E.review({source_verified:true,education_records:[{...record,owner_full_name:'Інша особа'}]},candidate).accepted,0);
a.equal(E.review({source_verified:true,education_records:[{...record,requires_review:true}]},candidate).accepted,0);
console.log('PASS: verified certificate without number can transfer; owner and review checks preserved.');
