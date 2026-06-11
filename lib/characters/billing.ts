import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Credit accounting for character-sheet generation.
 *
 * Character generation runs against Gemini directly (not the workflow engine),
 * so it has no `executions` row — which means the execution-scoped `refund_tokens`
 * RPC can't be used. To avoid charging for nothing and to avoid balance drift,
 * we PRE-CHECK the balance up front and DEBIT only after at least one sheet has
 * actually been produced. The debit is best-effort at that point (the sheets are
 * already streamed), and the pre-check makes the common "can't afford" case a
 * clean 402 before any work happens.
 */

/** Read a user's current spendable credit balance via the service client. */
export async function getTokenBalance(service: SupabaseClient, userId: string): Promise<number> {
  const { data } = await service.from('profiles').select('token_balance').eq('id', userId).single();
  const b = Number((data as any)?.token_balance);
  return Number.isFinite(b) ? b : 0;
}

/**
 * Debit credits for a completed character-generation run. Best-effort: a failure
 * here is logged, not surfaced, because the sheets have already been delivered.
 * Uses reason 'execution_debit' (the token_ledger CHECK allow-list) with a null
 * execution_id and a `kind` marker in metadata so billing history can tell these
 * apart from workflow runs.
 */
export async function debitCharacterGeneration(
  service: SupabaseClient,
  userId: string,
  cost: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (cost <= 0) return;
  const key = `char-gen:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await service.rpc('debit_tokens', {
    p_user_id: userId,
    p_amount: cost,
    p_reason: 'execution_debit',
    p_idempotency_key: key,
    p_execution_id: null,
    p_metadata: { kind: 'character_generation', ...metadata },
  });
  if (error) console.error('[characters/billing] debit failed:', error.message);
}
