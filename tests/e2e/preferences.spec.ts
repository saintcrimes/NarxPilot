import {test,expect} from '@playwright/test';
test('Язык и светлая тема сохраняются после перезагрузки',async({page})=>{
  await page.goto('/');const language=page.getByRole('combobox',{name:'Язык / Language'});
  await language.selectOption('en');await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.getByRole('button',{name:'Try demo',exact:true})).toBeVisible();
  await page.locator('.preference-theme').click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.reload();await expect(language).toHaveValue('en');await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await language.selectOption('uz');await expect(page.locator('html')).toHaveAttribute('lang','uz');
  await expect(page.getByRole('button',{name:'Demoni sinash',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Demoni sinash',exact:true}).click();await expect(page).toHaveURL(/\/catalog$/);
  const catalogLanguage=page.getByRole('combobox',{name:'Язык / Language'});
  await catalogLanguage.selectOption('en');await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.getByLabel('Search exact products')).toBeVisible();
  await catalogLanguage.selectOption('uz');await expect(page.locator('html')).toHaveAttribute('lang','uz');
  await expect(page.getByLabel('Aniq mahsulotni qidirish')).toBeVisible();
  await catalogLanguage.selectOption('ru');await expect(page.getByLabel('Поиск точного товара')).toBeVisible();
});
