CREATE TABLE public.guest_imports (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversion_id uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversion_id)
);
ALTER TABLE public.guest_imports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.guest_imports TO authenticated;
CREATE POLICY "own guest imports" ON public.guest_imports
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.import_guest_progress(p_conversion_id uuid, p_records jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  owner_id uuid := auth.uid();
  item jsonb;
  inserted_rows integer;
  concept_name text;
  clean_attempt boolean;
  hint_count integer;
  saved_styles text[];
  saved_misconceptions text[];
BEGIN
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_records IS NULL OR jsonb_typeof(p_records) IS DISTINCT FROM 'array' OR jsonb_array_length(p_records) > 500 THEN
    RAISE EXCEPTION 'Invalid guest progress batch';
  END IF;

  INSERT INTO public.guest_imports (user_id, conversion_id)
  VALUES (owner_id, p_conversion_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  IF inserted_rows = 0 THEN
    RETURN false;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    concept_name := btrim(item->'record'->>'concept');
    clean_attempt := COALESCE((item->'record'->>'clean')::boolean, false);
    hint_count := COALESCE((item->'record'->>'hintsUsed')::integer, 0);
    saved_styles := ARRAY(SELECT jsonb_array_elements_text(item->'record'->'styles'));
    saved_misconceptions := ARRAY(SELECT jsonb_array_elements_text(item->'record'->'misconceptions'));
    IF concept_name IS NULL OR concept_name = '' OR length(concept_name) > 200 OR hint_count < 0 THEN
      RAISE EXCEPTION 'Invalid guest progress record';
    END IF;
    IF item->'record'->>'status' IS NULL OR item->'record'->>'status' NOT IN ('Not assessed', 'Needs more practice', 'Progressing', 'Demonstrated under current criteria') THEN
      RAISE EXCEPTION 'Invalid guest progress status';
    END IF;

    INSERT INTO public.concepts (
      user_id, concept, status, misconceptions, styles, hints_used, attempts,
      clean_successes, review_interval_days, review_at, last_explanation, updated_at
    ) VALUES (
      owner_id,
      concept_name,
      item->'record'->>'status',
      saved_misconceptions,
      saved_styles,
      hint_count,
      1,
      CASE WHEN clean_attempt THEN 1 ELSE 0 END,
      CASE WHEN clean_attempt THEN 2 ELSE 1 END,
      now() + (CASE WHEN clean_attempt THEN 2 ELSE 1 END) * interval '1 day',
      NULLIF(item->'record'->>'explanation', ''),
      COALESCE((item->>'savedAt')::timestamptz, now())
    )
    ON CONFLICT (user_id, concept) DO UPDATE SET
      status = EXCLUDED.status,
      misconceptions = CASE WHEN cardinality(EXCLUDED.misconceptions) > 0 THEN EXCLUDED.misconceptions ELSE concepts.misconceptions END,
      styles = ARRAY(SELECT DISTINCT value FROM unnest(concepts.styles || EXCLUDED.styles) AS merged(value)),
      hints_used = concepts.hints_used + EXCLUDED.hints_used,
      attempts = concepts.attempts + 1,
      clean_successes = concepts.clean_successes + EXCLUDED.clean_successes,
      review_interval_days = CASE WHEN EXCLUDED.clean_successes > 0 THEN LEAST(concepts.review_interval_days * 2, 30) ELSE 1 END,
      review_at = now() + (CASE WHEN EXCLUDED.clean_successes > 0 THEN LEAST(concepts.review_interval_days * 2, 30) ELSE 1 END) * interval '1 day',
      last_explanation = COALESCE(EXCLUDED.last_explanation, concepts.last_explanation),
      updated_at = EXCLUDED.updated_at;
  END LOOP;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.import_guest_progress(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_guest_progress(uuid, jsonb) TO authenticated;
