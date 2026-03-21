/**
 * Workflow Engine v2 - STEP 4: Event-Driven Execution Listener
 * 
 * This Edge Function listens for Postgres NOTIFY events on the 'execution_state_change' 
 * channel and triggers check-and-dispatch automatically.
 * 
 * Deployment:
 * supabase functions deploy execution-listener
 * 
 * This function runs continuously in the background, eliminating the need for
 * manual check-and-dispatch calls after webhooks.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// PostgreSQL connection for LISTEN/NOTIFY
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DATABASE_URL = Deno.env.get('DATABASE_URL')!
const APP_URL = Deno.env.get('APP_URL') || 'http://localhost:3000'

console.log('[Execution Listener] Starting event-driven listener...')

// Create Postgres client for LISTEN/NOTIFY
const pgClient = new Client(DATABASE_URL)
await pgClient.connect()

// Listen on the execution_state_change channel
await pgClient.queryArray`LISTEN execution_state_change`

console.log('[Execution Listener] ✅ Listening on channel: execution_state_change')

// Handle notifications
pgClient.channel.onmessage = async (message) => {
  try {
    const payload = JSON.parse(message)
    const executionId = payload.execution_id
    
    console.log(`[Execution Listener] 🔔 Notification received for execution ${executionId}`)
    
    // Call check-and-dispatch via internal API
    const response = await fetch(`${APP_URL}/api/executions/check-and-dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ execution_id: executionId }),
    })
    
    if (response.ok) {
      console.log(`[Execution Listener] ✅ Dispatched check-and-dispatch for ${executionId}`)
    } else {
      const error = await response.text()
      console.error(`[Execution Listener] ❌ Failed to dispatch: ${error}`)
    }
    
  } catch (error) {
    console.error('[Execution Listener] Error handling notification:', error)
  }
}

// Health check endpoint
serve(async (req) => {
  const url = new URL(req.url)
  
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ 
      status: 'healthy',
      listener: 'active',
      channel: 'execution_state_change',
      timestamp: new Date().toISOString(),
    }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  
  return new Response('Execution Listener is running', { status: 200 })
})
