import type { Page } from '@playwright/test'

/** Ввод логина и пароля и касание «Войти». Ввод текста касанием не считается (S-2.1, раздел 1). */
export async function fillLogin(page: Page, login: string, password: string): Promise<void> {
  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль').fill(password)
}
