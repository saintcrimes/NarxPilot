import { test,expect } from '@playwright/test';
test('Поиск → сравнение → котировка → резерв → отгрузка → приёмка → аналитика',async({page})=>{
  await page.goto('/catalog');
  const meta=await (await page.request.get('/api/session')).json();
  const buyer=meta.profiles.find((p:{name:string})=>p.name.includes('Орион'));
  await page.getByLabel('Демонстрационный аккаунт').selectOption(buyer.user_id);
  await page.getByLabel('Поиск точного товара').fill('iPhone 15 128');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await page.getByRole('link',{name:'Сравнить',exact:true}).click();
  await expect(page.locator('.offer-card')).toHaveCount(5);
  await page.getByRole('button',{name:'Отправить заявку'}).first().click();
  await page.waitForURL(/\/orders\/[a-f0-9-]+$/);
  const id=new URL(page.url()).pathname.split('/')[2];
  const o=await (await page.request.get('/api/orders/'+id)).json();
  const seller=meta.profiles.find((p:{organization_id:string})=>p.organization_id===o.supplier_id);
  await page.getByLabel('Демонстрационный аккаунт').selectOption(seller.user_id);
  await page.getByRole('button',{name:'Подтвердить условия',exact:true}).click();
  await expect(page.locator('.status')).toHaveText('Условия подтверждены');
  await page.getByLabel('Демонстрационный аккаунт').selectOption(buyer.user_id);
  await page.getByRole('button',{name:'Согласен с условиями · зарезервировать'}).click();
  await expect(page.locator('.status')).toHaveText('Товар в резерве');
  await page.getByLabel('Демонстрационный аккаунт').selectOption(seller.user_id);
  await page.getByRole('button',{name:'Подтвердить отгрузку',exact:true}).click();
  await page.getByLabel('Демонстрационный аккаунт').selectOption(buyer.user_id);
  await page.getByRole('button',{name:'Подтвердить приёмку',exact:true}).click();
  await expect(page.locator('.status')).toHaveText('Приёмка подтверждена');
  await page.reload();await expect(page.locator('.status')).toHaveText('Приёмка подтверждена');
  await expect.poll(async()=>{const result=await (await page.request.get('/api/analytics/'+o.sku_id)).json();return result.pending_events;},{timeout:45000}).toBe(0);
  await page.getByRole('link',{name:'Посмотреть аналитику'}).click();await expect(page.locator('.series-chart')).toBeVisible();
});
test('Флаг справки, локальные кнопки и очистка переписки после обновления',async({page})=>{
  await page.goto('/catalog');const meta=await (await page.request.get('/api/session')).json();
  if(!meta.chatbot_enabled){await expect(page.getByRole('button',{name:'Помощь',exact:true})).toHaveCount(0);return;}
  await page.getByRole('button',{name:'Помощь',exact:true}).click();
  const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
  await page.getByRole('button',{name:'Как найти точный товар?',exact:true}).click();
  await expect(page.locator('.help-answer')).toContainText('В каталоге');
  if(meta.chatbot_provider!=='bro24'||!meta.chatbot_available){
    await page.getByLabel('Вопрос о продукте').fill('сколько стоит сейчас iPhone');await page.getByRole('button',{name:'Отправить вопрос'}).click();
    await expect(page.locator('.help-answer').last()).toContainText('нет текущих цен');
  }
  const origin=new URL(page.url()).origin;
  expect(requests.filter(url=>new URL(url).origin!==origin||url.includes('/api/help/chat'))).toHaveLength(0);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();await page.getByRole('button',{name:'Помощь',exact:true}).click();await expect(page.locator('.help-question')).toHaveCount(0);
});
test('Внешняя помощь: только свой API, текстовый ответ, локальный fallback и очистка',async({page})=>{
  // This UI contract fixture does not contact Bro24 or assert its undocumented response format.
  await page.route('**/api/session',async route=>{
    const response=await route.fetch();const meta=await response.json();
    await route.fulfill({response,json:{...meta,chatbot_enabled:true,chatbot_provider:'bro24',chatbot_available:true}});
  });
  let count=0;let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/help/chat',async route=>{
    const incoming=route.request();expect(incoming.method()).toBe('POST');
    expect(Object.keys(incoming.postDataJSON())).toEqual(['message']);
    expect(incoming.headers()['x-csrf-token']).toBeTruthy();expect(incoming.headers()['x-api-key']).toBeUndefined();
    count++;
    if(count===1){await gate;await route.fulfill({json:{provider:'bro24',answer:'Ответ продукта <img src=x onerror=alert(1)>',links:[],fallback:false}});}
    else if(count===2)await route.fulfill({status:503,json:{error:{message:'Сервис временно недоступен'}}});
    else await route.fulfill({json:{provider:'local',answer:'Текущий заказ доступен в закупках.',links:[{label:'Мои закупки',href:'/orders'}],fallback:false}});
  });
  await page.goto('/catalog');await page.getByRole('button',{name:'Помощь',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('передаются внешнему сервису Bro24');
  const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
  await page.getByLabel('Вопрос о продукте').fill('Расскажи о продукте');await page.getByRole('button',{name:'Отправить вопрос'}).click();
  await expect(page.getByRole('button',{name:'Отправить вопрос'})).toBeDisabled();release();
  await expect(page.locator('.help-answer').last()).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.help-answer img')).toHaveCount(0);
  await page.getByLabel('Вопрос о продукте').fill('Неизвестная тема');await page.getByRole('button',{name:'Отправить вопрос'}).click();
  await expect(page.locator('.help-answer').last()).toContainText('Внешняя помощь недоступна');
  await expect(page.locator('.help-answer').last()).toContainText('В справке пока нет точного ответа');
  await page.getByLabel('Вопрос о продукте').fill('Где мой заказ?');await page.getByRole('button',{name:'Отправить вопрос'}).click();
  await expect(page.locator('.help-answer').last()).toContainText('Текущий заказ доступен');
  await expect(page.locator('.help-answer').last()).not.toContainText('Внешняя помощь недоступна');
  const origin=new URL(page.url()).origin;expect(requests.filter(url=>new URL(url).origin!==origin)).toHaveLength(0);
  expect(requests.filter(url=>url.endsWith('/api/help/chat'))).toHaveLength(3);
  await page.reload();await page.getByRole('button',{name:'Помощь',exact:true}).click();await expect(page.locator('.help-question')).toHaveCount(0);
});
