// Фильтр списка студентов (20.11, блиц): поиск по ФИО и группа. Чистая логика, без базы.

export interface FilterableStudent {
  fullName: string
  groupId: string
}

/** Одно значение параметра адреса: массив — первое значение, пустое и нет значения — пустая строка. */
export function oneParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

/**
 * Поиск по части ФИО без учёта регистра, группа — по номеру из списка набора. Номер группы не из списка (чужой, мусор) игнорируется:
 * показывается весь набор, а не пустой список. Сам набор ограничивает слой доступа, фильтр отбирает из уже разрешённого.
 */
export function filterStudents<T extends FilterableStudent>(items: readonly T[], query: string, groupId: string, knownGroupIds: readonly string[]): T[] {
  const needle = query.trim().toLocaleLowerCase('ru')
  const group = knownGroupIds.includes(groupId) ? groupId : ''
  return items.filter((s) => (!needle || s.fullName.toLocaleLowerCase('ru').includes(needle)) && (!group || s.groupId === group))
}
