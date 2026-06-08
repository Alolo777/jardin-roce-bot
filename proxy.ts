import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

function jsonNoAutorizado() {
  return NextResponse.json(
    { error: 'No autorizado. Inicia sesión en /admin/login.' },
    { status: 401 }
  )
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const esAdmin = pathname.startsWith('/admin')
  const esApi = pathname.startsWith('/api')

  if (!esAdmin && !esApi) return NextResponse.next()
  if (pathname.startsWith('/admin/login')) return NextResponse.next()

  const response = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    if (esApi) return jsonNoAutorizado()

    const loginUrl = new URL('/admin/login', request.url)
    loginUrl.searchParams.set('redirected', '1')
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: ['/admin/:path*', '/api/:path*'],
}
