const fs=require('fs'),vm=require('vm'),a=require('assert');const ctx={window:{}};vm.runInNewContext(fs.readFileSync('education-document.js','utf8'),ctx);const E=ctx.window.CRMEducation;
a.equal(E.summary({bio_education_claims:[{institution:'Коледж',degree:'молодший спеціаліст',start_date:{value:'2017'},end_date:{value:'2021'},specialty:'Інженерія'}]}),'2017 — 2021, Коледж, молодший спеціаліст, Інженерія');
a.equal(E.summary({bio_education_claims:[{institution:'Не перевірено',requires_review:true}]}),'');
a.equal(E.summary({education_records:[{institution:'Університет',graduation_year:'2024',degree:'бакалавр'}],bio_education_claims:[{institution:'Коледж'}]}),'2024, Університет, бакалавр');
a.equal(E.summary({education:'Ручні дані',bio_education_claims:[{institution:'Коледж'}]}),'Ручні дані');
a.equal(E.summary({}, {education:'Збережений текст'}),'Збережений текст');console.log('PASS: education summary uses saved claims, dates and diplomas; preserves manual data; excludes unreviewed claims.');
