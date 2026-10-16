CREATE TABLE public.course_assessment_attempts (
  attempt_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  phase_id text NOT NULL,
  responses jsonb NOT NULL,
  evaluation jsonb NOT NULL,
  hints_used integer NOT NULL CHECK (hints_used BETWEEN 0 AND 10),
  retry_count integer NOT NULL CHECK (retry_count BETWEEN 0 AND 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, attempt_id)
);

REVOKE ALL ON public.course_assessment_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.course_assessment_attempts TO authenticated, service_role;
GRANT INSERT ON public.course_assessment_attempts TO service_role;
ALTER TABLE public.course_assessment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own course assessment attempts" ON public.course_assessment_attempts
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_id AND c.user_id = auth.uid())
  );
