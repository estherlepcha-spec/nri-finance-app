import { supabase } from '../supabase.js'
import { MEMORY_MAX_ITEMS, MEMORY_SPECIALISTS, normalizeMemoryContent } from './estelleMemoryPolicy.js'

async function authenticatedUserId() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const userId = data.session?.user?.id
  if (!userId) throw new Error('Please sign in to manage Estelle memory.')
  return userId
}

export async function loadEstelleMemory() {
  const userId = await authenticatedUserId()
  const now = new Date().toISOString()
  const [settingsResult, memoriesResult] = await Promise.all([
    supabase.from('estelle_memory_settings').select('enabled').eq('user_id', userId).maybeSingle(),
    supabase.from('estelle_memories')
      .select('id, content, specialist, created_at, expires_at')
      .eq('user_id', userId)
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(MEMORY_MAX_ITEMS),
  ])
  if (settingsResult.error) throw settingsResult.error
  if (memoriesResult.error) throw memoriesResult.error
  const { error: expiredError } = await supabase.from('estelle_memories')
    .delete()
    .eq('user_id', userId)
    .lte('expires_at', now)
  if (expiredError) throw expiredError
  return { enabled: settingsResult.data?.enabled === true, memories: memoriesResult.data || [] }
}

export async function setEstelleMemoryEnabled(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Memory preference must be enabled or disabled.')
  const userId = await authenticatedUserId()
  const { error } = await supabase.from('estelle_memory_settings').upsert(
    { user_id: userId, enabled, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  if (error) throw error
  return enabled
}

export async function saveEstelleMemory(value, specialist) {
  const content = normalizeMemoryContent(value)
  if (!MEMORY_SPECIALISTS.includes(specialist)) throw new Error('Choose a valid specialist scope.')
  const userId = await authenticatedUserId()
  const { data: settings, error: settingsError } = await supabase.from('estelle_memory_settings')
    .select('enabled')
    .eq('user_id', userId)
    .maybeSingle()
  if (settingsError) throw settingsError
  if (settings?.enabled !== true) throw new Error('Enable Estelle memory in Settings before saving a memory.')
  const { count, error: countError } = await supabase.from('estelle_memories')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
  if (countError) throw countError
  if ((count || 0) >= MEMORY_MAX_ITEMS) throw new Error(`You can save up to ${MEMORY_MAX_ITEMS} active memories. Delete one before adding another.`)

  const { data, error } = await supabase.from('estelle_memories')
    .insert({ user_id: userId, content, specialist })
    .select('id, content, specialist, created_at, expires_at')
    .single()
  if (error) throw error
  return data
}

export async function updateEstelleMemory(id, value, specialist) {
  if (typeof id !== 'string' || !id) throw new Error('Choose a memory to update.')
  const content = normalizeMemoryContent(value)
  if (!MEMORY_SPECIALISTS.includes(specialist)) throw new Error('Choose a valid specialist scope.')
  const userId = await authenticatedUserId()
  const { data, error } = await supabase.from('estelle_memories')
    .update({ content, specialist })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, content, specialist, created_at, expires_at')
    .single()
  if (error) throw error
  return data
}

export async function deleteEstelleMemory(id) {
  if (typeof id !== 'string' || !id) throw new Error('Choose a memory to delete.')
  const userId = await authenticatedUserId()
  const { error } = await supabase.from('estelle_memories').delete().eq('id', id).eq('user_id', userId)
  if (error) throw error
}

export async function clearEstelleMemory() {
  const userId = await authenticatedUserId()
  const { error: memoriesError } = await supabase.from('estelle_memories').delete().eq('user_id', userId)
  if (memoriesError) throw memoriesError
  const { error: settingsError } = await supabase.from('estelle_memory_settings').delete().eq('user_id', userId)
  if (settingsError) throw settingsError
}
