import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger.service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const level = searchParams.get('level')
  const moduleParam = searchParams.get('module')
  const search = searchParams.get('search')
  const since = searchParams.get('since')
  const rawLimit = Number(searchParams.get('limit') || 100)
  const limit = Math.max(1, Math.min(rawLimit, 500))
  const offset = Math.max(0, Number(searchParams.get('offset') || 0))

  try {
    let query = supabaseAdmin
      .from('logs')
      .select('id, level, module, message, metadata, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (level) query = query.eq('level', level)
    if (moduleParam) query = query.eq('module', moduleParam)
    if (search) query = query.ilike('message', `%${search}%`)
    if (since) query = query.gte('created_at', since)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ logs: data || [], source: 'supabase' })
  } catch (error) {
    logger.warn('api-logs', 'Supabase no disponible, usando buffer en memoria', { error: String(error) })
    const filtered = logger
      .getBuffer()
      .filter((l) => !level || l.level === level)
      .filter((l) => !moduleParam || l.module === moduleParam)
      .filter((l) => !search || l.message.toLowerCase().includes(search.toLowerCase()))
    return NextResponse.json({ logs: filtered.slice(0, limit), source: 'buffer' })
  }
}
