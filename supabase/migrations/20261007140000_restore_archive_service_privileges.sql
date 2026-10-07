-- Backend archive-candidate uses service_role; user access remains governed by existing grants and RLS.
grant select, update, delete on public.candidates to service_role;
grant select, update on public.documents, public.personal_files to service_role;
grant select on public.crm_staff to service_role;
grant select, delete, insert on public.crm_activity to service_role;
grant select, delete on public.document_ai_runs to service_role;
