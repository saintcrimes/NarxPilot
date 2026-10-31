import {test,expect} from '@playwright/test';
test('Продуктовая категория, фото упаковки и точный SKU перед сравнением',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Попробовать демо',exact:true}).click();
  await expect(page).toHaveURL(/\/catalog$/);
  const response=await page.request.get('/api/products');expect(response.ok()).toBeTruthy();
  const products: {code:string;category:string;model:string;variant:string}[]=await response.json();
  const flour=products.find(product=>product.code==='GR-001');expect(flour).toBeDefined();
  expect(products.some(product=>product.code.startsWith('NP-'))).toBeFalsy();
  await page.getByRole('button',{name:new RegExp('^'+flour!.category.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
  const card=page.locator('.product-card').filter({hasText:'GR-001'});await expect(card).toBeVisible();
  await card.locator('.product-title-button').click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading',{name:flour!.model,exact:true})).toBeVisible();
  await expect(dialog).toContainText(flour!.variant);
  await expect(dialog).toContainText('В заводской упаковке');
  await expect.poll(()=>dialog.locator('img').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await dialog.getByRole('link',{name:/Сравнить предложения/}).click();
  await expect(page).toHaveURL(/\/compare\?sku=/);await expect(page.locator('.offer-card')).toHaveCount(5);
});
