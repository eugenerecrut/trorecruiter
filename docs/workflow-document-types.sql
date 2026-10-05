update public.document_requirements set condition_field=null,condition_value=null,condition_behavior=null where document_type in ('Припис про направлення','Реєстр кандидата');
insert into public.document_requirements(document_type,is_required,ai_enabled,sort_order)
values ('Сертифікат психологічного тестування (перша сторінка)',true,false,265),
('Послужний список',false,false,980),('Перелік документів',false,false,981),('Титульний аркуш',false,false,982),('Наказ про зарахування до ВЧ',false,false,983)
on conflict(document_type) do nothing;
