// Read-only field contract. Paths describe current persistence, not a second candidate store.
(function(root){
'use strict';
const entry=(id,label,printKeys,paths,sources,rule)=>Object.freeze({id,label,printKeys:Object.freeze(printKeys),paths:Object.freeze(paths),sources:Object.freeze(sources),rule});
const fields=[
 entry('identity.tax_number','РНОКПП',['personal_number'],['candidate.rnokpp'],['Картка платника податків','Паспорт / ID з РНОКПП'],'10 цифр; не плутати з номером військового документа'),
 entry('identity.name','Чинне ПІБ',['surname','given_names'],['candidate.name_nominative','candidate.full_name'],['Паспорт / ID','Підтверджена історія зміни ПІБ'],'Історичне ПІБ не замінює чинне'),
 entry('identity.birth_date','Дата народження',['birth_date'],['candidate.birth_date'],['Паспорт / ID','Свідоцтво про народження'],'Повна календарна дата; власник звірений'),
 entry('identity.birth_place','Місце народження',['birth_place'],['candidate.birth_place','personal_file.birth_place'],['Свідоцтво про народження','Паспорт / ID'],'Не підміняти адресою проживання'),
 entry('military.rank','Чинне військове звання',['rank'],['candidate.military_rank'],['Військовий квиток','Резерв+'],'Чинне звання з військового документа. ШПК не є джерелом звання'),
 entry('military.rank_order','Наказ про присвоєння звання',['rank_order'],['profile.military_rank_records'],['Військовий квиток','Витяг з наказу'],'Номер, дата й видавець; наказ має відповідати чинному званню та бути підтвердженим'),
 entry('education.civil','Цивільна освіта',['education_civil'],['profile.education_records','profile.education_institution','profile.education_specialty','profile.education_qualification','profile.education_year'],['Атестат','Диплом','Додатки до документів про освіту'],'Записи за роком; для середньої освіти не друкувати спеціальність і кваліфікацію'),
 entry('education.military','Військова освіта',['education_military'],['profile.military_education'],['Документ про військову освіту','Військовий квиток'],'Не прирівнювати БЗВП до вищої військової освіти'),
 entry('education.languages','Іноземні мови',['languages'],['profile.foreign_languages','profile.languages'],['Автобіографія','Уточнення кандидата'],'Без припущень за місцем народження або громадянством'),
 entry('education.degree','Науковий ступінь',['scientific_degree'],['profile.scientific_degree'],['Диплом про науковий ступінь','Уточнення кандидата'],'Порожнє значення не означає підтверджену відсутність'),
 entry('education.works','Наукові праці',['scientific_works'],['profile.scientific_works'],['Підтвердні документи','Уточнення кандидата'],'Не генерувати відсутні назви'),
 entry('employment.absence','Працював / не працював',['not_worked'],['candidate.worked_before','profile.worked_before'],['Трудові документи','Явна відповідь кандидата'],'false є явною відповіддю; null означає невідомо'),
 entry('employment.records','Періоди роботи',['work_*'],['profile.work_records'],['Трудова книжка','Відомості ПФУ'],'Лише kind=employment; період, підприємство, місцевість, посада; без нечітких записів'),
 entry('service.absence','Служив / не служив',['not_served'],['candidate.served_before','profile.served_before'],['Військовий документ','Явна відповідь кандидата'],'Невідомо не перетворюється на «не служив»'),
 entry('service.callup','Призов / початок служби',['callup'],['profile.service_start_date','profile.previous_service_type'],['Військовий квиток','Наказ про початок служби'],'Підстава попередньої служби відокремлена від поточного оформлення'),
 entry('service.oath','Військова присяга',['oath'],['profile.military_oath'],['Військовий квиток'],'Дата та частина, з джерелом'),
 entry('service.records','Періоди служби',['service_*'],['profile.work_records'],['Військовий квиток','Витяги з наказів'],'Лише kind=military_service; дати, посада, ВОС, частина, наказ; закреслені записи не приймати автоматично'),
 entry('service.discharge','Звільнення в запас',['discharge'],['profile.military_discharge'],['Військовий квиток','Наказ про звільнення'],'Підстава, частина, номер і дата наказу; не дата запису OCR'),
 entry('combat.periods','Участь у бойових діях',['combat_*'],['profile.combat_records'],['Документи про участь у бойових діях','Військовий квиток'],'Місце та межі періоду; УБД не підтверджує конкретні дати'),
 entry('combat.injuries','Поранення та травми',['injuries'],['profile.injuries'],['Довідка про обставини травми','Медичні документи'],'Без діагнозів, вигаданих із загального тексту'),
 entry('combat.awards','Нагороди',['award_*'],['profile.awards'],['Посвідчення до нагороди','Витяги з наказів'],'Назва, підстава, видавець, номер і дата наказу'),
 entry('additional.trips','Закордонні відрядження',['foreign_trips'],['profile.foreign_business_trips'],['Накази','Уточнення кандидата'],'Наявність відрядження підтверджується джерелом'),
 entry('additional.trip_dates','Дати закордонного відрядження',['foreign_trips_start','foreign_trips_end'],[],['Накази','Уточнення кандидата'],'Канонічного шляху в поточному генераторі немає: лише друкована правка'),
 entry('additional.elected','Виборчі органи',['elected_bodies'],['profile.elected_bodies'],['Підтвердні документи','Уточнення кандидата'],'Без припущень за посадою'),
 entry('additional.captivity','Полон та інтернування',['captivity'],['profile.captivity'],['Підтвердні документи','Уточнення кандидата'],'Відсутність запису не є твердженням про відсутність факту'),
 entry('family.parents','Батько та мати',['parents'],['profile.relatives'],['Свідоцтво про народження кандидата','Автобіографія'],'Порівнювати спорідненість без регістру; не дублювати батьків при різному OCR'),
 entry('family.members','Сімейний стан, шлюб, діти, утриманці',['family'],['candidate.marital_status','profile.marital_status','profile.relatives','profile.marriage_record','profile.dependants','candidate.has_children','profile.has_children'],['Свідоцтво про шлюб / розірвання','Свідоцтва про народження дітей','Уточнення кандидата'],'Звіряти учасників документа й історію ПІБ; не приймати дитину за власника справи'),
 entry('family.address','Адреса проживання сім’ї',['family_address'],['profile.family_residence_address','profile.family_residence_confirmed'],['Уточнення кандидата','Документи про проживання'],'Друкувати лише за family_residence_confirmed; адреса кандидата не є автоматично адресою родини'),
 entry('service.reserve_training','Збори в запасі',['training_*'],['profile.reserve_training_records'],['Військовий квиток','Витяги з наказів'],'Періоди, посада, ВОС, частина та реквізити наказу')
];
function forPrintKey(key){return fields.find(f=>f.printKeys.some(pattern=>pattern.endsWith('*')?key.startsWith(pattern.slice(0,-1)):key===pattern))||null;}
function pathsForPrintKey(key){const field=forPrintKey(key);return field?['profile.service_record_print.'+key,...field.paths]:[];}
const api=Object.freeze({version:1,fields:Object.freeze(fields),forPrintKey,pathsForPrintKey});
root.CRMFieldRegistry=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
