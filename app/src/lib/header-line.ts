// Строка под названием в шапке студента: «ИТ-23-04 · 11 неделя, верхняя · 3 семестр» (макет М5).
// Чистая функция: части собираются по порядку, нет недели или семестра — их части не пишутся, разделитель « · » стоит только между частями.

export interface HeaderLineInput {
  groupName: string
  /** Номер и вид недели, как у `weekInfo`; `null` — семестр ещё не начался. */
  week: { number: number; kind: string } | null
  /** Номер текущего семестра группы; `null` — у группы нет дисциплин. */
  semester: number | null
}

export function headerLine({ groupName, week, semester }: HeaderLineInput): string {
  const parts: string[] = []
  if (groupName) parts.push(groupName)
  if (week) parts.push(`${week.number} неделя, ${week.kind}`)
  if (semester !== null) parts.push(`${semester} семестр`)
  return parts.join(' · ')
}
