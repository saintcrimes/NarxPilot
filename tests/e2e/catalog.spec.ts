import {test,expect} from '@playwright/test';
test('Категория принтеров, настоящая фотография и сведения перед сравнением',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Попробовать демо',exact:true}).click();
  await expect(page).toHaveURL(/\/catalog$/);
  await page.getByRole('button',{name:/^Принтеры/}).click();
  const card=page.locator('.product-card').filter({hasText:'LaserJet M110w'});await expect(card).toBeVisible();
  await card.locator('.product-title-button').click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading',{name:'LaserJet M110w'})).toBeVisible();
  await expect.poll(()=>dialog.locator('img').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await dialog.getByRole('link',{name:/Сравнить предложения/}).click();
  await expect(page).toHaveURL(/\/compare\?sku=/);await expect(page.locator('.offer-card')).toHaveCount(5);
});
