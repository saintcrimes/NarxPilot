import { randomUUID } from 'node:crypto';
import { test,expect,type Page } from '@playwright/test';
import type { SessionInfo } from '../../src/components/client';

function sessionResponse(page:Page) {
  return page.waitForResponse(response=>new URL(response.url()).pathname==='/api/session'&&response.request().method()==='GET');
}
async function open(page:Page,path:string):Promise<SessionInfo> {
  const session=sessionResponse(page);
  await page.goto(path);
  const response=await session;
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function mutateThroughUi(page:Page,path:string,click:()=>Promise<void>):Promise<SessionInfo> {
  const result=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/'+path&&response.request().method()==='POST');
  const refreshed=sessionResponse(page);
  await click();
  const response=await result;
  const body=await response.json();
  expect(response.ok(),body.error?.message??'Действие должно завершиться успешно').toBeTruthy();
  return (await refreshed).json();
}
async function expectNoHorizontalOverflow(page:Page) {
  const dimensions=await page.evaluate(()=>({content:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),viewport:window.innerWidth}));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport+1);
}

test('Главная → демо в один клик; адаптивность и уменьшение движения',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  const anonymous=await open(page,'/');
  expect(anonymous.profile).toBeNull();
  await expect(page.getByRole('heading',{name:/Уверенность/})).toBeVisible();
  await expect(page.locator('main form')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  const reducedMotion=await page.locator('.landing-actions .button').first().evaluate(element=>{
    const style=getComputedStyle(element);
    return {matches:matchMedia('(prefers-reduced-motion: reduce)').matches,animation:style.animationName,transition:style.transitionDuration,scroll:getComputedStyle(document.documentElement).scrollBehavior};
  });
  expect(reducedMotion).toEqual({matches:true,animation:'none',transition:'0s',scroll:'auto'});
  const authenticated=await mutateThroughUi(page,'session/demo',()=>page.getByRole('button',{name:'Попробовать демо',exact:true}).click());
  expect(authenticated.profile?.role).toBe('buyer');
  expect(anonymous.profiles.some(profile=>profile.user_id===authenticated.profile?.user_id)).toBeTruthy();
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.getByLabel('Поиск точного товара')).toBeVisible();
  await expect(page.locator('.product-card').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('Регистрация → сохранённый профиль → выход → вход по паролю',async({page},testInfo)=>{
  const email=`onboarding-${randomUUID()}@example.invalid`;
  const password=`Fixture-only-${randomUUID()}`;
  const name='Тестовый покупатель';
  await open(page,'/register');
  await expect(page.getByRole('heading',{name:'Создайте аккаунт',exact:true})).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Ваше имя',{exact:true}).fill(name);
  await page.getByLabel('Организация',{exact:true}).fill('E2E '+testInfo.project.name);
  await page.getByLabel('Я планирую',{exact:true}).selectOption('buyer');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Пароль',{exact:true}).fill(password);
  const registered=await mutateThroughUi(page,'auth/register',()=>page.getByRole('button',{name:'Создать аккаунт',exact:true}).click());
  expect(registered.profile?.name).toBe(name);
  expect(registered.profile?.role).toBe('buyer');
  const userId=registered.profile!.user_id;
  expect(registered.profiles.some(profile=>profile.user_id===userId)).toBeFalsy();
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.getByLabel('Демонстрационный аккаунт')).toHaveValue(userId);
  await expect(page.locator('.product-card').first()).toBeVisible();
  const reloaded=sessionResponse(page);
  await page.reload();
  const persisted:SessionInfo=await (await reloaded).json();
  expect(persisted.profile?.user_id).toBe(userId);
  expect(persisted.profiles.some(profile=>profile.user_id===userId)).toBeFalsy();
  await expect(page.getByLabel('Демонстрационный аккаунт')).toHaveValue(userId);
  const loggedOut=await mutateThroughUi(page,'session/logout',()=>page.getByRole('button',{name:'Выйти',exact:true}).click());
  expect(loggedOut.profile).toBeNull();
  await open(page,'/login');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Пароль',{exact:true}).fill(password);
  const loggedIn=await mutateThroughUi(page,'auth/login',()=>page.getByRole('button',{name:'Войти',exact:true}).click());
  expect(loggedIn.profile?.user_id).toBe(userId);
  expect(loggedIn.profiles.some(profile=>profile.user_id===userId)).toBeFalsy();
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.getByLabel('Демонстрационный аккаунт')).toHaveValue(userId);
  await expect(page.locator('.product-card').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
