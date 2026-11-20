'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { RECOGNITION_LANG, composeText, pickRecognitionCtor, recognitionErrorText, transcriptOf, type RecognitionLike } from './speech'

// Кнопка «Сказать» (20.11, идея №17): диктовка в поле по `targetId` через Web Speech API, язык ru-RU.
// Нет поддержки в браузере — кнопки нет совсем: на сервере и при первой отрисовке на клиенте рисуется пустое место,
// после проверки на клиенте кнопка появляется. Поле остаётся обычным полем формы: текст вставляется в его значение,
// отправляет форму сам человек. Звук обрабатывает браузер; на сервер приложения уходит только текст формы.

const noopSubscribe = () => () => {}
const supportedOnClient = () => pickRecognitionCtor(window) !== null
const supportedOnServer = () => false

function MicIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-5 flex-none">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </svg>
  )
}

export function VoiceInputButton({ targetId, className }: { targetId: string; className?: string }) {
  const supported = useSyncExternalStore(noopSubscribe, supportedOnClient, supportedOnServer)
  const [listening, setListening] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const recognitionRef = useRef<RecognitionLike | null>(null)

  // Уход со страницы во время записи: распознавание останавливается.
  useEffect(
    () => () => {
      const current = recognitionRef.current
      recognitionRef.current = null
      current?.abort()
    },
    [],
  )

  const start = useCallback(() => {
    const Ctor = pickRecognitionCtor(window)
    const field = document.getElementById(targetId)
    if (!Ctor || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return
    setMessage(null)
    // Что было в поле до нажатия, остаётся; сказанное дописывается после него.
    const base = field.value
    const recognition = new Ctor()
    recognition.lang = RECOGNITION_LANG
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const next = composeText(base, transcriptOf(event), field.maxLength > 0 ? field.maxLength : undefined)
      // Значение ставится через родной установщик и сообщается событием input: так поле, которым управляет React, его заметит.
      const proto = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, next)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    recognition.onerror = (event) => {
      setMessage(recognitionErrorText(event.error))
    }
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null
      setListening(false)
    }
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      recognitionRef.current = null
      setMessage(recognitionErrorText(undefined))
    }
  }, [targetId])

  const toggle = useCallback(() => {
    const current = recognitionRef.current
    if (current) {
      current.stop()
      return
    }
    start()
  }, [start])

  if (!supported) return null

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        data-testid="voice-button"
        className="inline-flex min-h-[var(--control-h)] min-w-11 items-center justify-center gap-2 rounded-pill border-2 border-primary bg-transparent px-5 text-[length:var(--fs-md)] font-bold leading-[1.2] text-primary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus aria-pressed:bg-primary-soft"
      >
        <MicIcon />
        <span>{listening ? 'Слушаю… Нажмите, чтобы остановить' : 'Сказать'}</span>
      </button>
      <p role="status" data-testid="voice-status" className="min-h-0 text-[length:var(--fs-sm)] text-muted empty:hidden">
        {message}
      </p>
    </div>
  )
}
