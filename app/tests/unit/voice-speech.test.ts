// Голосовой ввод (20.11, идея №17): выбор конструктора распознавания, сборка текста поля, тексты ошибок. Браузер не нужен.
import { describe, expect, it } from 'vitest'
import { RECOGNITION_LANG, composeText, pickRecognitionCtor, recognitionErrorText, transcriptOf } from '../../src/components/voice/speech'

class Standard {}
class Webkit {}

describe('pickRecognitionCtor', () => {
  it('нет ни одного конструктора — null (кнопки не будет)', () => {
    expect(pickRecognitionCtor({})).toBeNull()
    expect(pickRecognitionCtor(null)).toBeNull()
    expect(pickRecognitionCtor(undefined)).toBeNull()
    expect(pickRecognitionCtor('window')).toBeNull()
  })
  it('есть только webkitSpeechRecognition — он', () => {
    expect(pickRecognitionCtor({ webkitSpeechRecognition: Webkit })).toBe(Webkit)
  })
  it('есть только стандартный SpeechRecognition — он', () => {
    expect(pickRecognitionCtor({ SpeechRecognition: Standard })).toBe(Standard)
  })
  it('есть оба — стандартный главнее', () => {
    expect(pickRecognitionCtor({ SpeechRecognition: Standard, webkitSpeechRecognition: Webkit })).toBe(Standard)
  })
  it('не функция (заглушка-значение, undefined) не считается поддержкой', () => {
    expect(pickRecognitionCtor({ SpeechRecognition: undefined, webkitSpeechRecognition: {} })).toBeNull()
    expect(pickRecognitionCtor({ SpeechRecognition: 'yes' })).toBeNull()
  })
})

describe('transcriptOf и composeText', () => {
  const result = (text: string) => Object.assign([{ transcript: text }], { isFinal: true })
  it('склеивает куски речи через пробел и пропускает пустые', () => {
    expect(transcriptOf({ results: [result(' справка '), result(''), result('в налоговую')] })).toBe('справка в налоговую')
    expect(transcriptOf({ results: [] })).toBe('')
  })
  it('дописывает сказанное после прежнего текста поля', () => {
    expect(composeText('', 'справка в налоговую')).toBe('справка в налоговую')
    expect(composeText('Нужна ', 'справка')).toBe('Нужна справка')
    expect(composeText('текст', '')).toBe('текст')
  })
  it('не длиннее ограничения поля', () => {
    expect(composeText('', 'а'.repeat(400), 300)).toHaveLength(300)
    expect(composeText('ab', 'cd', 3)).toBe('ab ')
  })
})

describe('recognitionErrorText', () => {
  it('остановка самим человеком строки не даёт', () => {
    expect(recognitionErrorText('aborted')).toBeNull()
  })
  it('нет разрешения, нет речи, нет микрофона, нет связи и неизвестная ошибка — короткие строки', () => {
    for (const code of ['not-allowed', 'service-not-allowed', 'no-speech', 'audio-capture', 'network', 'bad-grammar', undefined]) {
      const text = recognitionErrorText(code)
      expect(text, String(code)).toBeTruthy()
      expect(text!.length, String(code)).toBeLessThan(100)
    }
    expect(recognitionErrorText('not-allowed')).toMatch(/микрофон/)
  })
  it('язык распознавания — русский', () => {
    expect(RECOGNITION_LANG).toBe('ru-RU')
  })
})
