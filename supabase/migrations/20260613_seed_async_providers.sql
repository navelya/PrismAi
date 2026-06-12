-- Migration: seed the async generation providers (FAL, WaveSpeed, KIE, Kinovi)
-- Date: 2026-06-13
-- Description:
--   Registers the "Replicate-like" async providers as rows in the `providers`
--   table. Each carries an `adapter_key` that matches its code adapter in
--   lib/ai/providers/async-registry.ts (fal.ts/wavespeed.ts/kie.ts/kinovi.ts),
--   so the admin model form's "Add provider" dropdown lists them and a binding's
--   provider_id (adapter key) routes to the right adapter. FAL is included here
--   because the FAL phase created bindings but never a providers row, so it
--   wouldn't otherwise appear in the dropdown.
--
--   Idempotent. No model bindings are created here — admins bind models to these
--   providers via the Providers section of the model form (or scripts).

INSERT INTO public.providers (id, name, adapter_key) VALUES
  ('fal',       'FAL',       'fal'),
  ('wavespeed', 'WaveSpeed', 'wavespeed'),
  ('kie',       'KIE',       'kie'),
  ('kinovi',    'Kinovi',    'kinovi')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      adapter_key = EXCLUDED.adapter_key;
