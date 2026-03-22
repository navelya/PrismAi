-- FIX: Synchronize executions table schema with Atomic V3
-- Date: 2026-03-22
-- Reason: Fix missing columns when old V1 executions table exists.

DO $$ 
BEGIN 
    -- 1. Add session_id if it doesn't exist (V1 used workflow_id)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'executions' AND column_name = 'session_id') THEN
        ALTER TABLE public.executions ADD COLUMN session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE;
        
        -- If old data exists, try to preserve it
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'executions' AND column_name = 'workflow_id') THEN
            -- Attempt to link if possible, though workflow_id and session_id might not match
            -- This is safe to fail
            RAISE NOTICE 'Found legacy workflow_id, adding session_id for V3 compatibility.';
        END IF;
    END IF;

    -- 2. Add updated_at if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'executions' AND column_name = 'updated_at') THEN
        ALTER TABLE public.executions ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    -- 3. Add graph_json if it doesn't exist (Used for immutable run snapshots)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'executions' AND column_name = 'graph_json') THEN
        ALTER TABLE public.executions ADD COLUMN graph_json JSONB;
    END IF;

    -- 4. Fix RLS Policy if it's broken
    DROP POLICY IF EXISTS "Users can view their own executions" ON public.executions;
    CREATE POLICY "Users can view their own executions" ON public.executions
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.sessions 
          WHERE sessions.id = executions.session_id 
          AND sessions.user_id = auth.uid()
        )
      );

    -- 5. Ensure node_results table has all required columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'node_results' AND column_name = 'updated_at') THEN
        ALTER TABLE public.node_results ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    RAISE NOTICE '✅ Executions and Node Results schema successfully patched for V3.';
END $$;
