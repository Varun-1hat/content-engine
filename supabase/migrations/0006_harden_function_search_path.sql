-- 0006_harden_function_search_path
--
-- Supabase security lint 0011 (function_search_path_mutable): the trigger
-- function public.set_updated_at() had a role-mutable search_path. Its body only
-- calls now() (pg_catalog, always implicitly resolvable), so pinning the path to
-- empty is safe and closes the warning. Idempotent.

alter function public.set_updated_at() set search_path = '';
