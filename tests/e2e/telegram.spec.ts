import { test,expect } from '@playwright/test';

type BridgeState={calls:string[];backVisible:boolean;back:(()=>void)|null};
type BridgeWindow=Window&{__narxTelegramState:BridgeState};

test('Telegram: presentation bridge, safe-area и Назад без доверия к initData',async({page})=>{
  // Only the official SDK is replaced; the NarxPilot app/session API remains real.
  // This fixture does not contact Telegram or claim device/client compatibility.
  await page.route('https://telegram.org/js/telegram-web-app.js*',route=>route.fulfill({contentType:'application/javascript',body:`
    (() => {
      const state = window.__narxTelegramState = {calls: [], backVisible: false, back: null};
      document.documentElement.style.setProperty('--tg-content-safe-area-inset-top', '24px');
      document.documentElement.style.setProperty('--tg-content-safe-area-inset-bottom', '18px');
      window.Telegram = {WebApp: {
        platform: 'android', initData: 'user=unverified&hash=invalid-fixture',
        initDataUnsafe: {user: {id: 999999, first_name: 'Unverified fixture'}},
        isVersionAtLeast: () => true,
        ready: () => state.calls.push('ready'), expand: () => state.calls.push('expand'),
        setHeaderColor: color => state.calls.push('header:' + color),
        setBackgroundColor: color => state.calls.push('background:' + color),
        setBottomBarColor: color => state.calls.push('bottom:' + color),
        BackButton: {
          show: () => {state.backVisible = true;}, hide: () => {state.backVisible = false;},
          onClick: handler => {state.back = handler;},
          offClick: handler => {if (state.back === handler) state.back = null;}
        }
      }};
    })();
  `}));
  const mutations:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/'))mutations.push(new URL(request.url()).pathname);});
  const session=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/session'&&response.request().method()==='GET');
  await page.goto('/register');
  const response=await session;
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).profile).toBeNull();
  await expect(page.getByRole('heading',{name:'Создайте аккаунт',exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/telegram-mini-app/);
  await expect.poll(()=>page.evaluate(()=>(window as BridgeWindow).__narxTelegramState.calls)).toEqual(expect.arrayContaining(['ready','expand','header:#0d0e1c','background:#101222']));
  await expect(page.locator('body')).toHaveCSS('padding-top','24px');
  await expect(page.locator('body')).toHaveCSS('padding-bottom','18px');
  await expect.poll(()=>page.evaluate(()=>(window as BridgeWindow).__narxTelegramState.backVisible)).toBeTruthy();
  await page.evaluate(()=>(window as BridgeWindow).__narxTelegramState.back?.());
  await expect(page).toHaveURL(/:\/\/[^/]+\/$/);
  await expect(page.getByRole('heading',{name:/Уверенность/})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as BridgeWindow).__narxTelegramState.backVisible)).toBeFalsy();
  expect(mutations).toEqual([]);
});
