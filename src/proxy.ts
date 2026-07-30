import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/cron (Vercel scheduled background cron jobs)
     * - _next/static (static compiled chunks)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - any image or static media extensions (*.svg, *.png, *.jpg, etc.)
     */
    '/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
