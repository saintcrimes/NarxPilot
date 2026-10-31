'use client';
import { Component,useEffect,useRef,useState } from 'react';
import type { ReactNode,KeyboardEvent } from 'react';
import Link from 'next/link';
import { faqItems,answerById,matchQuestion,type HelpAnswer } from '../domain/faq';
import { request } from './client';
import { Icon } from './ui';
import { usePreferences } from './preferences';
import { canonicalHelpQuestion } from '../lib/help-translations';
type HelpProvider='local'|'bro24';
type ChatReply=HelpAnswer&{provider:HelpProvider;fallback:boolean};
type HistoryEntry={question:string;faqId?:string;response:HelpAnswer;provider:HelpProvider;fallback:boolean};
type HelpWidgetProps={csrf:string;provider:HelpProvider;available:boolean};
function readChatReply(value:unknown):ChatReply {
  if(!value||typeof value!=='object')throw new Error('Invalid help response');
  const data=value as Record<string,unknown>;
  if((data.provider!=='local'&&data.provider!=='bro24')||typeof data.fallback!=='boolean'||typeof data.answer!=='string'||!data.answer.trim()||data.answer.length>10000||!Array.isArray(data.links)||data.links.length>8)throw new Error('Invalid help response');
  const links=data.links.map((entry:unknown)=>{
    if(!entry||typeof entry!=='object')throw new Error('Invalid help link');
    const link=entry as Record<string,unknown>;
    if(typeof link.label!=='string'||link.label.length>120||typeof link.href!=='string'||!/^\/(catalog|compare|orders|analytics|supplier|notifications)$/.test(link.href))throw new Error('Invalid help link');
    return {label:link.label,href:link.href};
  });
  return {provider:data.provider,fallback:data.fallback,answer:data.answer,links};
}
export class HelpBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?null:this.props.children;}
}
export function HelpWidget({csrf,provider,available}:HelpWidgetProps) {
  const {t,locale}=usePreferences();
  const [open,setOpen]=useState(false);const [text,setText]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [history,setHistory]=useState<HistoryEntry[]>([]);
  const input=useRef<HTMLInputElement>(null);const button=useRef<HTMLButtonElement>(null);const dialog=useRef<HTMLDivElement>(null);
  const pending=useRef<AbortController|null>(null);const mounted=useRef(true);const sending=useRef(false);
  const remoteReady=provider==='bro24'&&available;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.abort();};},[]);
  useEffect(()=>{if(open&&!busy)input.current?.focus();},[open,busy]);
  function close(){setOpen(false);button.current?.focus();}
  async function answer(question:string,id?:string){
    if(sending.current)return;
    const message=question.trim();if(!message)return;
    if(message.length>1000){setError('Не более 1000 символов. Сократите вопрос.');return;}
    setError('');setText('');
    const localMessage=canonicalHelpQuestion(message,locale);
    let response=id?answerById(id):matchQuestion(localMessage);let source:HelpProvider='local';let fallback=!id&&provider==='bro24'&&!available;
    if(!id&&remoteReady){
      sending.current=true;setBusy(true);const controller=new AbortController();pending.current=controller;
      const timeout=setTimeout(()=>controller.abort(),25000);
      try {
        const reply=readChatReply(await request<unknown>('help/chat',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({message}),signal:controller.signal}));
        response=reply.provider==='local'?{...matchQuestion(localMessage),...reply}:reply;source=reply.provider;fallback=reply.fallback;
      } catch {fallback=true;}
      finally {clearTimeout(timeout);pending.current=null;sending.current=false;if(mounted.current)setBusy(false);}
    }
    if(mounted.current)setHistory(h=>[...h.slice(-19),{question:message,...(id?{faqId:id}:{}),response,provider:source,fallback}]);
  }
  function keyboard(e:KeyboardEvent){
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Tab'){
      const focusable=dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a, input:not([disabled])');if(!focusable?.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  }
  return <><button ref={button} className="help-launcher" aria-expanded={open} aria-controls="narxpilot-help" onClick={()=>setOpen(v=>!v)}><Icon name="help"/>{t('Помощь')}</button>{open&&<div ref={dialog} id="narxpilot-help" className="help-dialog" role="dialog" aria-modal="true" aria-label={t('Помощь по NarxPilot')} onKeyDown={keyboard}>
    <div className="help-header"><div><b>{t('Помощь по NarxPilot')}</b><small>{t(remoteReady?'Помощник продукта и локальная справка':'Ответы из справки о продукте')}</small></div><button className="icon-button" aria-label={t('Закрыть помощь')} onClick={close}>×</button></div>
    <div className="help-content" aria-live="polite" aria-busy={busy}>
      <p className="small muted">{t(remoteReady?'Введённые вопросы передаются внешнему сервису Bro24. Не отправляйте пароли, платёжные или личные данные. Кнопки справки работают локально.':'Не отправляйте пароли и платёжные данные. Переписка хранится только в памяти этой страницы.')}</p>
      {provider==='bro24'&&!available&&<p className="small muted">{t('Подключение внешней помощи сейчас недоступно. Работает локальная справка.')}</p>}
      <div className="faq-buttons">{faqItems.slice(0,6).map(f=><button key={f.id} disabled={busy} onClick={()=>void answer(f.question,f.id)}>{t(f.question)}</button>)}</div>
      {history.map((h,i)=><div key={i}><p className="help-question">{h.faqId?t(faqItems.find(f=>f.id===h.faqId)?.question??h.question):h.question}</p><div className="help-answer"><small className="muted">{t(h.provider==='bro24'?'Ответ внешнего помощника':h.fallback?'Внешняя помощь недоступна · локальная справка':'Ответ из справки')}</small><p>{h.provider==='local'?t(h.response.answer):h.response.answer}</p>{h.response.links.map(l=><Link key={l.href} href={l.href} onClick={close}>{h.provider==='local'?t(l.label):l.label} →</Link>)}{h.response.suggestions?.map(s=><button key={s.id} disabled={busy} className="faq-suggestion" onClick={()=>void answer(s.question,s.id)}>{t(s.question)}</button>)}</div></div>)}
      {busy&&<p role="status" className="small muted">{t('Помощник готовит ответ…')}</p>}
    </div>
    <form className="help-form" onSubmit={e=>{e.preventDefault();void answer(text);}}><label className="sr-only" htmlFor="help-question">{t('Вопрос о продукте')}</label><input ref={input} id="help-question" value={text} disabled={busy} aria-invalid={Boolean(error)} onChange={e=>setText(e.target.value)} placeholder={t('Вопрос о продукте…')}/><button className="icon-button" disabled={busy} aria-label={t('Отправить вопрос')}><Icon name="arrow"/></button>{error&&<p role="alert">{t(error)}</p>}</form>
  </div>}</>;
}
