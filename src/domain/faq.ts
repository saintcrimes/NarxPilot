import content from '../../examples/product_faq.json';
export type FaqItem=typeof content.items[number];
export const faqItems: FaqItem[]=content.items;
export type HelpAnswer={answer:string;links:{label:string;href:string}[];suggestions?:FaqItem[];id?:string;routeOnly?:boolean};
export function normalizeQuestion(text:string) {return text.toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();}
export function answerById(id:string):HelpAnswer {
  const item=faqItems.find(i=>i.id===id);
  return item?{answer:item.answer,links:item.links,id:item.id}:fallback();
}
function fallback():HelpAnswer {return {answer:'В справке пока нет точного ответа на этот вопрос. Выберите одну из тем ниже или откройте нужный раздел платформы.',links:[{label:'Каталог',href:'/catalog'},{label:'Мои закупки',href:'/orders'}],suggestions:faqItems.slice(0,3)};}
export function matchQuestion(text:string):HelpAnswer {
  if(text.length>1000)return {answer:'Сообщение слишком длинное. Сократите вопрос до 1000 символов.',links:[]};
  const normalized=normalizeQuestion(text);
  // Only explicit approved phrases. A common word such as «цена» cannot select an answer.
  const exact=faqItems.filter(i=>[i.question,...i.variants].some(q=>normalizeQuestion(q)===normalized));
  if(exact.length===1)return answerById(exact[0].id);
  if(/(мой|моего|мои|статус|где).*заказ|заказ.*(статус|мой)/u.test(normalized))return {routeOnly:true,answer:'Справка не читает личные заказы. Посмотрите актуальный статус в авторизованном разделе закупок.',links:[{label:'Мои закупки',href:'/orders'}]};
  if(/(подтверди|отмени|оформи|купи|зарезервируй|измени)/u.test(normalized))return {routeOnly:true,answer:'Справка не выполняет действия. Откройте соответствующий экран и проверьте условия перед подтверждением.',links:[{label:'Мои закупки',href:'/orders'},{label:'Сравнение',href:'/compare'}]};
  if(/(прогноз|завтра|подешевеет|подорожает|когда покупать)/u.test(normalized))return {routeOnly:true,answer:'Справка не прогнозирует цены. Статус экспериментального прогноза и ограничения данных находятся в аналитике.',links:[{label:'Аналитика',href:'/analytics'}]};
  if(/(сейчас|сегодня|текущ|сколько стоит|в наличии|остаток)/u.test(normalized))return {routeOnly:true,answer:'В справке нет текущих цен и остатков. Проверьте актуальные предложения точного товара в сравнении.',links:[{label:'Сравнение',href:'/compare'},{label:'Каталог',href:'/catalog'}]};
  const candidates=faqItems.filter(i=>i.variants.some(v=>normalized.includes(normalizeQuestion(v))));
  if(candidates.length)return {answer:'Выберите вопрос, который вы имели в виду:',suggestions:candidates.slice(0,3),links:[]};
  return fallback();
}
