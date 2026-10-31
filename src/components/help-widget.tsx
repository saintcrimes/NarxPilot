'use client';
import { Component,useEffect,useRef,useState } from 'react';
import type { ReactNode,KeyboardEvent } from 'react';
import Link from 'next/link';
import { faqItems,answerById,matchQuestion,type HelpAnswer } from '../domain/faq';
import { Icon } from './ui';
export class HelpBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?null:this.props.children;}
}
export function HelpWidget() {
  const [open,setOpen]=useState(false);const [text,setText]=useState('');const [error,setError]=useState('');
  const [history,setHistory]=useState<{question:string;response:HelpAnswer}[]>([]);
  const input=useRef<HTMLInputElement>(null);const button=useRef<HTMLButtonElement>(null);const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(open)input.current?.focus();},[open]);
  function close(){setOpen(false);button.current?.focus();}
  function answer(question:string,id?:string){if(question.length>1000){setError('Не более 1000 символов. Сократите вопрос.');return;}setError('');setHistory(h=>[...h.slice(-19),{question,response:id?answerById(id):matchQuestion(question)}]);setText('');}
  function keyboard(e:KeyboardEvent){if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const focusable=dialog.current?.querySelectorAll<HTMLElement>('button, a, input');if(!focusable?.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}
  return <><button ref={button} className="help-launcher" aria-expanded={open} aria-controls="narxpilot-help" onClick={()=>setOpen(v=>!v)}><Icon name="help"/>Помощь</button>{open&&<div ref={dialog} id="narxpilot-help" className="help-dialog" role="dialog" aria-modal="true" aria-label="Помощь по NarxPilot" onKeyDown={keyboard}><div className="help-header"><div><b>Помощь по NarxPilot</b><small>Ответы из справки о продукте</small></div><button className="icon-button" aria-label="Закрыть помощь" onClick={close}>×</button></div><div className="help-content" aria-live="polite"><p className="small muted">Не отправляйте пароли и платёжные данные. Переписка хранится только в памяти этой страницы.</p><div className="faq-buttons">{faqItems.slice(0,6).map(f=><button key={f.id} onClick={()=>answer(f.question,f.id)}>{f.question}</button>)}</div>{history.map((h,i)=><div key={i}><p className="help-question">{h.question}</p><div className="help-answer"><p>{h.response.answer}</p>{h.response.links.map(l=><Link key={l.href} href={l.href} onClick={close}>{l.label} →</Link>)}{h.response.suggestions?.map(s=><button key={s.id} className="faq-suggestion" onClick={()=>answer(s.question,s.id)}>{s.question}</button>)}</div></div>)}</div><form className="help-form" onSubmit={e=>{e.preventDefault();if(text.trim())answer(text);}}><label className="sr-only" htmlFor="help-question">Вопрос о продукте</label><input ref={input} id="help-question" value={text} onChange={e=>setText(e.target.value)} placeholder="Вопрос о продукте…"/><button className="icon-button" aria-label="Отправить вопрос"><Icon name="arrow"/></button>{error&&<p role="alert">{error}</p>}</form></div>}</>;
}
