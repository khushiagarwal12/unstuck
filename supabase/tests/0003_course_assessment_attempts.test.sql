BEGIN;
SELECT plan(6);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000211', 'authenticated', 'authenticated', 'assessment-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000212', 'authenticated', 'authenticated', 'assessment-b@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.courses (id, user_id, title, topics, plan)
VALUES (
  '00000000-0000-4000-8000-000000000221',
  '00000000-0000-4000-8000-000000000211',
  'Assessment course',
  '[]'::jsonb,
  '{"phases":[{"id":"phase-one"}]}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.course_assessment_attempts (
  attempt_id, user_id, course_id, phase_id, responses, evaluation, hints_used, retry_count
)
VALUES (
  '00000000-0000-4000-8000-000000000231',
  '00000000-0000-4000-8000-000000000211',
  '00000000-0000-4000-8000-000000000221',
  'phase-one',
  '{"objectiveAnswers":{"q1":1}}'::jsonb,
  '{"score":2,"maxScore":2,"percentage":100}'::jsonb,
  0,
  0
)
ON CONFLICT (user_id, attempt_id) DO NOTHING;

INSERT INTO public.course_assessment_attempts (
  attempt_id, user_id, course_id, phase_id, responses, evaluation, hints_used, retry_count
)
VALUES (
  '00000000-0000-4000-8000-000000000231',
  '00000000-0000-4000-8000-000000000211',
  '00000000-0000-4000-8000-000000000221',
  'phase-one',
  '{"objectiveAnswers":{"q1":0}}'::jsonb,
  '{"score":0,"maxScore":2,"percentage":0}'::jsonb,
  0,
  1
)
ON CONFLICT (user_id, attempt_id) DO NOTHING;
SELECT is((SELECT count(*)::integer FROM public.course_assessment_attempts), 1, 'a retried submission id does not create another attempt');
SELECT is((SELECT evaluation->>'percentage' FROM public.course_assessment_attempts WHERE attempt_id = '00000000-0000-4000-8000-000000000231'), '100', 'a duplicate submission preserves the original score');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000211', true);
SELECT is((SELECT count(*)::integer FROM public.course_assessment_attempts), 1, 'a learner can read their own saved attempt');
SELECT ok(NOT has_table_privilege('authenticated', 'public.course_assessment_attempts', 'INSERT'), 'learners cannot directly insert assessment results');
SELECT ok(NOT has_table_privilege('authenticated', 'public.course_assessment_attempts', 'UPDATE'), 'learners cannot change historical assessment results');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000212', true);
SELECT is((SELECT count(*)::integer FROM public.course_assessment_attempts), 0, 'another learner cannot read the attempt');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
