-- Workflow Engine v2 - Database Webhooks
-- Replaces Edge Function listener with native Postgres HTTP calls
-- This is more reliable for serverless environments (Vercel/Supabase)

-- 1. Ensure pgnet extension is available
CREATE EXTENSION IF NOT EXISTS "net" WITH SCHEMA "extensions";

-- 2. Create the webhook function
-- This function sends an HTTP POST to your Next.js API
CREATE OR REPLACE FUNCTION public.invoke_check_and_dispatch()
RETURNS TRIGGER AS $$
DECLARE
  v_api_url TEXT := 'https://prismai.vercel.app/api/executions/check-and-dispatch'; -- UPDATE THIS IF NEEDED
  v_service_key TEXT := 'REPLACE_WITH_YOUR_SERVICE_ROLE_KEY'; -- RECOMMEND: Use Vault or replace manually
BEGIN
  -- Only trigger if node_states actually changed (meaning a node finished)
  IF (OLD.node_states IS DISTINCT FROM NEW.node_states) THEN
    
    -- Use the 'net' extension to make an async HTTP call
    -- This doesn't block the database transaction
    PERFORM extensions.net_http_post(
      url := v_api_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'execution_id', NEW.id,
        'trigger_source', 'db_webhook'
      )
    );

    -- Log that we triggered the webhook
    INSERT INTO execution_events (
      execution_id,
      event_type,
      payload,
      created_at
    ) VALUES (
      NEW.id,
      'webhook_triggered',
      jsonb_build_object(
        'target', v_api_url,
        'timestamp', NOW()
      ),
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create the trigger
DROP TRIGGER IF EXISTS trigger_execution_webhook ON public.executions_v2;

CREATE TRIGGER trigger_execution_webhook
  AFTER UPDATE ON public.executions_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.invoke_check_and_dispatch();

COMMENT ON FUNCTION public.invoke_check_and_dispatch IS 'Native Database Webhook: Calls Check-and-Dispatch API whenever execution state changes';
