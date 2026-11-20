#!/usr/bin/env bash
# Проверка ИИ-функций на сервере (19.11, ИИ-функции): видит ли приложение переменные AI_* и отвечает ли модель.
# Запускает участник А под deploy. Входа на сайт не нужно.
#
# Что делает: внутри контейнера app смотрит переменные AI_* (только длину и вид, не значения) и шлёт модели один
# короткий запрос тем же способом, что src/server/ai.ts: POST <AI_BASE_URL>/chat/completions, Bearer-ключ,
# заголовок OpenAI-Project. Печатает код ответа и длину текста. Текст ошибки провайдера — латиницей, до 300 знаков,
# ключ и каталог в нём заменены словами KEY и FOLDER. Один запрос стоит доли копейки.
# Отметки в конце: AI-OK — модель ответила; AI-STOP <причина> — что поправить; AI-FAIL — ошибка в строке.
set -euo pipefail

main() {
  trap 'echo "AI-FAIL line $LINENO"' ERR
  cd "$HOME/dekanat"
  local dk="docker"
  docker info >/dev/null 2>&1 || dk="sudo docker"

  echo "== app container"
  $dk compose ps app --format '{{.Service}} {{.State}}' </dev/null

  echo "== model call"
  $dk compose exec -T app node --input-type=module - <<'EOF'
const env = (k) => (process.env[k] ?? '').trim()
const base = env('AI_BASE_URL').replace(/\/+$/, '')
const key = env('AI_API_KEY')
const model = env('AI_MODEL')
const folder = env('AI_FOLDER_ID')
const mask = (s) => {
  let out = String(s)
  if (key) out = out.split(key).join('KEY')
  if (folder) out = out.split(folder).join('FOLDER')
  return out.replace(/[^\t\n\x20-\x7e]/g, '?').slice(0, 300)
}
console.log(`AI_BASE_URL: ${base ? (/^https:\/\//.test(base) ? 'https, ok' : 'NOT https') : 'EMPTY'}`)
console.log(`AI_API_KEY: ${key ? `length ${key.length}` : 'EMPTY'}${/[<>"' ]/.test(key) ? ', has <>, quotes or spaces' : ''}`)
console.log(`AI_FOLDER_ID: ${folder ? `length ${folder.length}` : 'EMPTY'}${folder === 'default' ? ', is the word default, need the ID' : ''}`)
console.log(`AI_MODEL: ${model ? (model.startsWith('gpt://') ? 'gpt://...' : 'other form') : 'EMPTY'}` +
  `${folder && model.startsWith('gpt://') ? (model.startsWith(`gpt://${folder}/`) ? ', folder matches' : ', folder DIFFERS from AI_FOLDER_ID') : ''}`)
if (!base || !key || !model || !/^https:\/\//.test(base)) {
  console.log('AI-STOP env: the app sees AI off; fill .env and run: docker compose up -d app')
  process.exit(0)
}
const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` }
if (folder) headers['openai-project'] = folder
const started = Date.now()
try {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, temperature: 0, max_tokens: 30, messages: [{ role: 'user', content: 'Ответь одним словом: да' }] }),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  })
  const ms = Date.now() - started
  const text = await res.text()
  console.log(`http: ${res.status}, ${ms} ms`)
  if (!res.ok) {
    console.log(`provider says: ${mask(text)}`)
    console.log(`AI-STOP http ${res.status}`)
    process.exit(0)
  }
  const content = JSON.parse(text)?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    console.log('AI-STOP bad_response: no text in choices[0].message.content')
    process.exit(0)
  }
  console.log(`answer length: ${content.trim().length} chars`)
  if (ms > 8000) console.log('note: slower than the app timeout 8000 ms')
  console.log('AI-OK')
} catch (e) {
  console.log(`error: ${mask(e?.name)} ${mask(e?.cause?.code ?? e?.message ?? '')}`)
  console.log('AI-STOP network or timeout')
}
EOF
}

main "$@"
