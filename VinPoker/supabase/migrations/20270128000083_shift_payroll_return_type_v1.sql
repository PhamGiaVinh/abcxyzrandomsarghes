-- Forward type-contract repair, after the reviewed payroll82 authority guard.
-- Preserve the existing signature, permission guard and compensation formulas.
-- Values beyond the declared integer range must fail, never clamp or wrap.
-- Recovery: a reviewed forward compensation can restore the prior definition;
-- never remove82's authorization guard or replay old payroll migrations.
DO $migration$
DECLARE
  definition text;
  old_expression text := 'COALESCE(SUM(da.overtime_minutes), 0) AS overtime_minutes';
  new_expression text := 'COALESCE(SUM(da.overtime_minutes), 0)::INT AS overtime_minutes';
BEGIN
  IF to_regprocedure('public.get_shift_payroll_summary(uuid,date)') IS NULL THEN
    RAISE EXCEPTION 'shift_payroll83_precondition_missing';
  END IF;
  definition := pg_get_functiondef('public.get_shift_payroll_summary(uuid,date)'::regprocedure);
  IF md5(definition) <> 'c2a77f3d6e04802d527342bd78cfb54c' OR
     (length(definition)-length(replace(definition,old_expression,'')))/length(old_expression) <> 1 OR
     has_function_privilege('anon','public.get_shift_payroll_summary(uuid,date)','EXECUTE') OR
     NOT has_function_privilege('authenticated','public.get_shift_payroll_summary(uuid,date)','EXECUTE') THEN
    RAISE EXCEPTION 'shift_payroll83_precondition_drift';
  END IF;
  EXECUTE replace(definition,old_expression,new_expression);
END;
$migration$;
