import { createClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────
// ⚙️  COLE SUAS CREDENCIAIS DO SUPABASE AQUI
//     Supabase → Project Settings → API
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://hnvwglylbcwraaosaflh.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhudndnbHlsYmN3cmFhb3NhZmxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzIyNzMsImV4cCI6MjA5MDA0ODI3M30.2jPRIgFUIhjeXduPpmEXGjHEZKhfNQoCX-dxUudup7I'
// ─────────────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

// ── Helpers genéricos ──────────────────────────────────────────

/** Lê uma linha da tabela `kv` pelo id (nossa tabela key-value simples) */
export async function dbGet(table, id = 'main') {
  const { data } = await supabase.from(table).select('*').eq('id', id).single()
  return data
}

/** Upsert em qualquer tabela */
export async function dbSet(table, row) {
  await supabase.from(table).upsert(row)
}

/** Deleta uma linha */
export async function dbDel(table, id) {
  await supabase.from(table).delete().eq('id', id)
}

/** Busca todos os registros de uma tabela */
export async function dbAll(table) {
  const { data } = await supabase.from(table).select('*')
  return data ?? []
}
