-- Add `node_type` to node_results so the asset views can tell which rows came
-- from which kind of node WITHOUT inspecting storage URLs.
--
-- Why: a `character` node re-publishes its reference-image URLs into
-- node_results during a run (so a wired generator can read them and the run
-- knows the input is ready). Those rows are workflow transport records, not
-- deliverable assets — but the Assets / Last-runs views show every image row
-- in node_results, so the character's references leak in (with duplicates per
-- run). We can't tell them apart by URL: generated refs live under
-- chat-assets/{uid}/characters/ but uploaded refs live under chat-assets/{uid}/
-- with no marker, and a custom CDN domain would change the host entirely.
-- Tagging the source node type is the domain-independent signal.
--
-- This migration only LABELS rows. It never deletes node_results rows and never
-- touches any storage bucket.

ALTER TABLE public.node_results
  ADD COLUMN IF NOT EXISTS node_type TEXT;

-- One-time backfill: label existing rows from their execution's graph snapshot.
-- executions.graph_json.nodes is an array of { id, type, ... }; match by node_id.
-- Guarded so executions with a missing/non-array `nodes` key are skipped.
UPDATE public.node_results nr
SET node_type = sub.ntype
FROM (
  SELECT e.id AS exec_id, n->>'id' AS nid, n->>'type' AS ntype
  FROM public.executions e,
       LATERAL jsonb_array_elements((e.graph_json)::jsonb -> 'nodes') AS n
  WHERE (e.graph_json)::jsonb ? 'nodes'
    AND jsonb_typeof((e.graph_json)::jsonb -> 'nodes') = 'array'
) sub
WHERE nr.execution_id = sub.exec_id
  AND nr.node_id = sub.nid
  AND nr.node_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_node_results_node_type
  ON public.node_results(node_type);
