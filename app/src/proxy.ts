import { NextResponse, type NextRequest } from 'next/server'

// Посредник перед каждым запросом страницы и действия (Next.js 16, файл proxy.ts).
// 1. R-3.10-1: POST без заголовка Origin отклоняется. Браузер шлёт Origin с каждым POST,
//    поэтому обычной работы это не меняет; закрывается подделка запроса не из браузера с чужой кукой.
//    R-3.10-9: Origin, который не разбирается как адрес с протоколом http или https («null», мусор), — тоже 403;
//    раньше такой запрос доходил до Next.js, и тот отвечал 500 и писал ошибку в журнал.
//    Хост здесь не сверяется: совпадение Origin с адресом сайта проверяет сам Next.js. Поэтому правильный,
//    но чужой Origin (https://evil.example) по-прежнему получает от Next.js 500; действие не выполняется (RV-3.10-9-1).
// 2. R-3.3-3: адрес с битой процентной кодировкой — экран «не найдено», а не ошибка сервера 500.

const NOT_FOUND_PATH = '/__nf'

function isHttpOrigin(origin: string | null): boolean {
  if (!origin) return false
  try {
    const { protocol } = new URL(origin)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function hasBrokenEncoding(pathname: string): boolean {
  try {
    decodeURIComponent(pathname)
    return false
  } catch {
    return true
  }
}

export function proxy(request: NextRequest) {
  if (request.method === 'POST' && !isHttpOrigin(request.headers.get('origin'))) {
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
