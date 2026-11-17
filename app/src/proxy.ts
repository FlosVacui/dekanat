import { NextResponse, type NextRequest } from 'next/server'

// Посредник перед каждым запросом страницы и действия (Next.js 16, файл proxy.ts).
// 1. R-3.10-1: POST без заголовка Origin отклоняется. Браузер шлёт Origin с каждым POST,
//    поэтому обычной работы это не меняет; закрывается подделка запроса не из браузера с чужой кукой.
//    Совпадение Origin с адресом сайта проверяет сам Next.js — здесь только «заголовок есть».
// 2. R-3.3-3: адрес с битой процентной кодировкой — экран «не найдено», а не ошибка сервера 500.

const NOT_FOUND_PATH = '/__nf'

function hasBrokenEncoding(pathname: string): boolean {
  try {
    decodeURIComponent(pathname)
    return false
  } catch {
    return true
  }
}

export function proxy(request: NextRequest) {
  if (request.method === 'POST' && !request.headers.get('origin')) {
    return new NextResponse('Запрос отклонён', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  const rawPath = new URL(request.url).pathname
  if (hasBrokenEncoding(rawPath)) {
    return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url))
  }
  return NextResponse.next()
}

export const config = {
  // Исключены только сборочные файлы: исключение по началу пути вроде «/icon» задело бы и будущую страницу «/icons» (SEC-В5-1, R-В5-1-2).
  matcher: ['/((?!_next/static|_next/image).*)'],
}
