BEGIN;
SELECT plan(6);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'learner-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'learner-b@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.import_guest_progress('00000000-0000-4000-8000-000000000021', '[]'::jsonb)$$,
  '42501',
  NULL,
  'anonymous callers cannot import guest progress'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true);
SELECT is(
  public.import_guest_progress(
    '00000000-0000-4000-8000-000000000021',
    '[{"id":"00000000-0000-4000-8000-000000000031","savedAt":"2026-10-16T00:00:00Z","record":{"concept":"Fractions","status":"Progressing","misconceptions":[],"styles":["example"],"hintsUsed":0,"correct":true,"clean":true,"explanation":null}}]'::jsonb
  ),
  true,
  'authenticated learner can import their guest progress'
);
SELECT is(
  public.import_guest_progress(
    '00000000-0000-4000-8000-000000000021',
    '[{"id":"00000000-0000-4000-8000-000000000031","savedAt":"2026-10-16T00:00:00Z","record":{"concept":"Fractions","status":"Progressing","misconceptions":[],"styles":["example"],"hintsUsed":0,"correct":true,"clean":true,"explanation":null}}]'::jsonb
  ),
  false,
  'repeating the same import does not duplicate progress'
);
SELECT is((SELECT count(*)::integer FROM public.concepts), 1, 'import created exactly one owned concept record');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000012', true);
SELECT is((SELECT count(*)::integer FROM public.concepts), 0, 'a different user cannot read the learner concept record');
SELECT throws_ok(
  $$INSERT INTO public.concepts (user_id, concept) VALUES ('00000000-0000-4000-8000-000000000011', 'Unauthorized write')$$,
  '42501',
  NULL,
  'a different user cannot write a concept for the learner'
);

SELECT * FROM finish();
ROLLBACK;
