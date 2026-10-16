BEGIN;
SELECT plan(6);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000111', 'authenticated', 'authenticated', 'course-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000000112', 'authenticated', 'authenticated', 'course-b@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000111', true);
INSERT INTO public.courses (id, user_id, title, goal, outcomes, topics, plan)
VALUES (
  '00000000-0000-4000-8000-000000000121',
  '00000000-0000-4000-8000-000000000111',
  'Structured course',
  'Learn a topic',
  ARRAY['Apply the topic'],
  '[{"id":"topic-a","name":"Foundations"}]'::jsonb,
  '{"phases":[{"id":"phase-a","topics":[{"id":"topic-a","name":"Foundations"}]}]}'::jsonb
);
SELECT is(
  (SELECT plan->'phases'->0->'topics'->0->>'name' FROM public.courses WHERE id = '00000000-0000-4000-8000-000000000121'),
  'Foundations',
  'the structured plan is persisted with the course'
);
INSERT INTO public.course_progress (user_id, course_id, current_phase_id, current_topic_id, completed_topic_ids, assessment_responses)
VALUES (
  '00000000-0000-4000-8000-000000000111',
  '00000000-0000-4000-8000-000000000121',
  'phase-a',
  'topic-a',
  ARRAY['topic-intro'],
  '{"phase-a:0":"My response"}'::jsonb
);
SELECT is(
  (SELECT current_topic_id FROM public.course_progress WHERE course_id = '00000000-0000-4000-8000-000000000121'),
  'topic-a',
  'the learner current position is persisted'
);
SELECT is(
  (SELECT assessment_responses->>'phase-a:0' FROM public.course_progress WHERE course_id = '00000000-0000-4000-8000-000000000121'),
  'My response',
  'phase assessment responses are persisted'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000112', true);
SELECT is((SELECT count(*)::integer FROM public.courses), 0, 'another learner cannot read the course');
SELECT is((SELECT count(*)::integer FROM public.course_progress), 0, 'another learner cannot read course progress');
SELECT throws_ok(
  $$INSERT INTO public.course_progress (user_id, course_id, current_topic_id) VALUES ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000121', 'topic-b')$$,
  '42501',
  NULL,
  'another learner cannot write course progress'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
