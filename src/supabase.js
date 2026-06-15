import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Keys synced to Supabase
export const SYNC_KEYS = [
  'nri_setupComplete', 'nri_homeCurrency', 'nri_foreignCurrency', 'nri_primaryCurrency',
  'nri_exchangeRate', 'nri_accounts', 'nri_transactions', 'nri_bills', 'nri_remittances',
  'nri_investments', 'nri_goals', 'nri_goalContribs', 'nri_allocations', 'nri_loans',
  'nri_family', 'nri_templates', 'nri_wkBudgets', 'nri_hmBudgets', 'nri_budgetMonth',
  'nri_savedScenarios', 'nri_lastImport', 'nri_smartRules',
]

// Resolve the authenticated user's id from the live session.
// Returns null when signed out — callers MUST treat that as "do nothing"
// so we never write to a shared/guessed id again (the old 'default' bug).
async function currentUserId() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.user?.id || null
}

// Load all app data for the signed-in user from Supabase.
export async function loadFromSupabase() {
  const userId = await currentUserId()
  if (!userId) return null // signed out — nothing to load

  const { data, error } = await supabase
    .from('nri_finance_data')
    .select('key, value')
    .eq('user_id', userId)

  if (error) { console.error('Supabase load error:', error); return null }

  const result = {}
  for (const row of data || []) {
    result[row.key] = row.value
  }
  return result
}

// Save a single key to Supabase (upsert), scoped to the signed-in user.
export async function saveToSupabase(key, value) {
  const userId = await currentUserId()
  if (!userId) return // signed out — never persist to a shared id

  const { error } = await supabase
    .from('nri_finance_data')
    .upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' })

  if (error) console.error('Supabase save error:', error)
}

// Subscribe to real-time changes for the signed-in user's rows only.
// Returns the channel (or null if signed out).
export async function subscribeToChanges(onUpdate) {
  const userId = await currentUserId()
  if (!userId) return null

  const channelName = `nri_finance_${userId}_${Date.now()}`
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'nri_finance_data',
      filter: `user_id=eq.${userId}`,
    }, payload => {
      if (payload.new) onUpdate(payload.new.key, payload.new.value)
    })
    .subscribe()
  return channel
}
