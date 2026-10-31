'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
export type Profile={user_id:string;organization_id:string;name:string;organization_name:string;role:'buyer'|'supplier'|'admin'};
export type SessionInfo={csrf:string;demo:boolean;chatbot_enabled:boolean;chatbot_provider:'local'|'bro24';chatbot_available:boolean;profiles:Profile[];profile:Profile|null};
export async function request<T>(path:string,options:RequestInit={}):Promise<T> {
  const response=await fetch('/api/'+path,{...options,cache:'no-store'});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error?.message??'Не удалось выполнить запрос');
  return data as T;
}
export function useResource<T>(path:string|null,refresh=0,poll=false) {
  const [result,setResult]=useState<{key:string|null;data?:T;error?:string}>({key:null});
  const [version,setVersion]=useState(0);
  useEffect(()=>{
    if(path===null) return;
    let alive=true;const controller=new AbortController();
    const read=()=>request<T>(path,{signal:controller.signal}).then(data=>{if(alive)setResult({key:path,data});}).catch(e=>{if(alive&&!controller.signal.aborted)setResult({key:path,error:e.message});});
    void read();const timer=poll?setInterval(()=>void read(),5000):undefined;
    return ()=>{alive=false;controller.abort();if(timer)clearInterval(timer);};
  },[path,refresh,version,poll]);
  return {data:result.key===path?result.data:undefined,error:result.key===path?result.error:undefined,loading:path!==null&&result.key!==path,reload:useCallback(()=>setVersion(v=>v+1),[])};
}
export function useMutation(csrf:string,onSuccess?:()=>void) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const keys=useRef(new Map<string,string>());
  async function mutate<T>(path:string,body:unknown):Promise<T|undefined> {
    if(busy)return;
    const signature=path+JSON.stringify(body);const key=keys.current.get(signature)??crypto.randomUUID();keys.current.set(signature,key);
    setBusy(true);setError('');
    try {const result=await request<T>(path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key},body:JSON.stringify(body)});keys.current.delete(signature);onSuccess?.();return result;}
    catch(e) {setError(e instanceof Error?e.message:'Ошибка запроса');return undefined;}
    finally {setBusy(false);}
  }
  return {mutate,busy,error};
}
/** Денежные строки форматируются без преобразования в Number. */
export function formatMoney(value:string|null|undefined) {
  if(value==null)return 'нет данных';
  const [integer,fraction='00']=value.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')+(fraction==='00'?'':','+fraction);
}
export function dateTime(value:Date|string|null|undefined) {
  return value?new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Tashkent',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'нет данных';
}
export const statusNames:Record<string,string>={REQUESTED:'Заявка отправлена',QUOTED:'Условия подтверждены',RESERVED:'Товар в резерве',SHIPPED:'Отгружен',COMPLETED:'Приёмка подтверждена',CANCELLED:'Отменён',EXPIRED:'Резерв истёк',DISPUTED:'Открыт спор',REJECTED:'Отклонён'};
