-- TEST ONLY: deterministic attendance source for the portable concurrency runner.
-- Intentionally retained after the run. Never replay on a paid fixture.
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_l02';
 ASSERT NOT EXISTS(SELECT 1 FROM auth.users WHERE id='16920000-0000-4000-8000-000000000001'),'preserve prior concurrency fixture';
 ASSERT to_regnamespace('l02_supplement_race') IS NULL,'preserve prior concurrency evidence';
END $$;
INSERT INTO auth.users(id) VALUES
 ('16920000-0000-4000-8000-000000000001'),('16920000-0000-4000-8000-000000000002'),
 ('16920000-0000-4000-8000-000000000003'),('16920000-0000-4000-8000-000000000004');
INSERT INTO public.profiles(user_id,display_name) VALUES
 ('16920000-0000-4000-8000-000000000001','Portable FT supplement owner TEST'),
 ('16920000-0000-4000-8000-000000000002','Portable FT supplement accountantA TEST'),
 ('16920000-0000-4000-8000-000000000003','Portable FT supplement accountantB TEST'),
 ('16920000-0000-4000-8000-000000000004','Portable FT supplement employee TEST');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
 ('16920000-0000-4000-8000-000000000011','16920000-0000-4000-8000-000000000001','Portable supplement race TEST','TEST','approved');
INSERT INTO public.club_accountants(club_id,user_id,granted_by) VALUES
 ('16920000-0000-4000-8000-000000000011','16920000-0000-4000-8000-000000000002','16920000-0000-4000-8000-000000000001'),
 ('16920000-0000-4000-8000-000000000011','16920000-0000-4000-8000-000000000003','16920000-0000-4000-8000-000000000001');
INSERT INTO public.staff(id,club_id,user_id,full_name,department,employment_type,monthly_salary_vnd,manual_bhxh_vnd,manual_tax_vnd,status) VALUES
 ('16920000-0000-4000-8000-000000000021','16920000-0000-4000-8000-000000000011','16920000-0000-4000-8000-000000000004','Portable FT supplement TEST','service','full_time',5200000,0,0,'active');
INSERT INTO public.staff_attendance(staff_id,shift_date,status,check_in_time,check_out_time)
 SELECT '16920000-0000-4000-8000-000000000021',date'2026-11-01'+d,'checked_out',
 (date'2026-11-01'+d+time'09:00')AT TIME ZONE'Asia/Ho_Chi_Minh',
 (date'2026-11-01'+d+time'17:00')AT TIME ZONE'Asia/Ho_Chi_Minh' FROM generate_series(0,24)d;
INSERT INTO public.staff_attendance(staff_id,shift_date,status,check_in_time) VALUES
 ('16920000-0000-4000-8000-000000000021',date'2026-11-26','checked_in',timestamptz'2026-11-26 09:00+07');
SET LOCAL request.jwt.claim.sub='16920000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.chot_staff_salary_month('16920000-0000-4000-8000-000000000011',2026,11);
SELECT public.submit_staff_salary_month('16920000-0000-4000-8000-000000000011',2026,11,NULL);
SELECT public.approve_staff_salary_month('16920000-0000-4000-8000-000000000011',2026,11);
RESET ROLE;
DO $$ DECLARE result jsonb;run_id uuid; BEGIN
 SELECT id INTO STRICT run_id FROM public.staff_salary_runs WHERE staff_id='16920000-0000-4000-8000-000000000021';
 ASSERT(SELECT net_vnd FROM public.staff_salary_runs WHERE id=run_id)=5000000;
 result:=public.mark_staff_salary_paid(run_id,'cash',NULL);ASSERT result->>'status'='paid';
END $$;
CREATE SCHEMA l02_supplement_race;
REVOKE ALL ON SCHEMA l02_supplement_race FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE l02_supplement_race.effective_payments(run_id uuid,amount_vnd bigint,paid_by uuid);
CREATE TABLE l02_supplement_race.original_base(run_id uuid,record jsonb,source jsonb);
INSERT INTO l02_supplement_race.original_base
 SELECT r.id,to_jsonb(r),s.snapshot FROM public.staff_salary_runs r
 JOIN floor_private.staff_salary_sources_v1 s ON s.run_id=r.id WHERE r.staff_id='16920000-0000-4000-8000-000000000021';
CREATE FUNCTION l02_supplement_race.pause() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 BEGIN PERFORM pg_sleep(3);RETURN NEW;END $$;
CREATE FUNCTION l02_supplement_race.audit_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 BEGIN INSERT INTO l02_supplement_race.effective_payments VALUES(NEW.id,NEW.net_vnd,NEW.paid_by);RETURN NEW;END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA l02_supplement_race FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA l02_supplement_race FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER l02_supplement_pause_checkout BEFORE UPDATE ON public.staff_attendance FOR EACH ROW
 WHEN(NEW.staff_id='16920000-0000-4000-8000-000000000021'::uuid AND OLD.check_out_time IS NULL AND NEW.check_out_time IS NOT NULL)
 EXECUTE FUNCTION l02_supplement_race.pause();
CREATE TRIGGER l02_supplement_pause_approval BEFORE INSERT ON public.staff_salary_runs FOR EACH ROW
 WHEN(NEW.staff_id='16920000-0000-4000-8000-000000000021'::uuid AND NEW.adjusts_id IS NOT NULL)
 EXECUTE FUNCTION l02_supplement_race.pause();
CREATE TRIGGER l02_supplement_pause_payment BEFORE UPDATE ON public.staff_salary_runs FOR EACH ROW
 WHEN(NEW.staff_id='16920000-0000-4000-8000-000000000021'::uuid AND NEW.adjusts_id IS NOT NULL AND OLD.status='locked' AND NEW.status='paid')
 EXECUTE FUNCTION l02_supplement_race.pause();
CREATE TRIGGER l02_supplement_audit_payment AFTER UPDATE ON public.staff_salary_runs FOR EACH ROW
 WHEN(NEW.staff_id='16920000-0000-4000-8000-000000000021'::uuid AND NEW.adjusts_id IS NOT NULL AND OLD.status='locked' AND NEW.status='paid')
 EXECUTE FUNCTION l02_supplement_race.audit_payment();
COMMIT;
