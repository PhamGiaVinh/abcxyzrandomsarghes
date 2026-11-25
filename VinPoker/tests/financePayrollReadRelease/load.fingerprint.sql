-- Bounded per-row digests avoid materializing huge JSON arrays of500000lines.
SELECT jsonb_build_object('financial',md5(jsonb_build_object(
 'statements',(SELECT md5(string_agg(md5(to_jsonb(s)::text),'' ORDER BY id)) FROM public.dealer_payroll_statements s),
 'lines',(SELECT md5(string_agg(md5(to_jsonb(l)::text),'' ORDER BY id)) FROM public.dealer_payroll_statement_lines l),
 'payments',(SELECT md5(string_agg(md5(to_jsonb(p)::text),'' ORDER BY id)) FROM public.dealer_pt_wage_payments p),
 'settlements',(SELECT md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id)) FROM public.dealer_pt_wage_settlements t),
 'dealers',(SELECT md5(string_agg(md5(to_jsonb(d)::text),'' ORDER BY id)) FROM public.dealers d),
 'attendance',(SELECT md5(string_agg(md5(to_jsonb(a)::text),'' ORDER BY id)) FROM public.dealer_attendance a),
 'rates',(SELECT md5(string_agg(md5(to_jsonb(r)::text),'' ORDER BY id)) FROM public.dealer_pt_wage_rate_history r))::text),
 'catalog',md5(jsonb_build_object(
 'routines',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth')),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('id',c.oid,'definition',pg_get_indexdef(c.oid)) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='i'),
 'table_grants',(SELECT jsonb_agg(jsonb_build_object('id',c.oid,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p))::text));
