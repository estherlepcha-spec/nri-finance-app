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

const USER_ID = 'default'

// Load all app data from Supabase
export async function loadFromSupabase() {
  const { data, error } = await supabase
    .from('nri_finance_data')
    .select('key, value')
    .eq('user_id', USER_ID)

  if (error) { console.error('Supabase load error:', error); return null }

  const result = {}
  for (const row of data || []) {
    result[row.key] = row.value
  }
  return result
}

// Save a single key to Supabase (upsert)
export async function saveToSupabase(key, value) {
  const { error } = await supabase
    .from('nri_finance_data')
    .upsert({ user_id: USER_ID, key, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' })

  if (error) console.error('Supabase save error:', error)
}

// Subscribe to real-time changes from other devices
export function subscribeToChanges(onUpdate) {
  const channelName = `nri_finance_${Date.now()}`
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'nri_finance_data',
      filter: `user_id=eq.${USER_ID}`,
    }, payload => {
      if (payload.new) onUpdate(payload.new.key, payload.new.value)
    })
    .subscribe()
  return channel
}
