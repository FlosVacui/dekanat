'use client'

import { useEffect } from 'react'
import type { Theme } from './ui-settings'

/**
 * Держит класс `dark` на `<html>` в нужном виде после смены настроек без перезагрузки и при смене темы системы.
 * Первую отрисовку делает сервер (явные «светлая» и «тёмная») и скрипт в голове страницы («Как в системе»);
 * здесь — то, что они не успевают: React перезаписывает весь `class`, когда настройки меняются, и класс, добавленный
 * скриптом, пропадает. `classKey` — строка класса от сервера: меняется — эффект идёт заново. Ничего не рисует.
 */
export function ThemeSync({ theme, classKey }: { theme: Theme; classKey: string }) {
  useEffect(() => {
    const root = document.documentElement
    if (theme !== 'system') {
      root.classList.toggle('dark', theme === 'dark')
      return
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => root.classList.toggle('dark', media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme, classKey])
  return null
}
