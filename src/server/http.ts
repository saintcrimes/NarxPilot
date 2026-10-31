import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { DomainError,requireThat } from '../domain/errors';
import { session } from './auth';
import { query } from './db';
export async function bodyOf(request:NextRequest):Promise<unknown> {
  requireThat(request.headers.get('content-type')?.includes('application/json'),'CONTENT_TYPE','Требуется JSON',415);
  requireThat(Number(request.headers.get('content-length')??0)<=65536,'BODY_TOO_LARGE','Слишком большой запрос',413);
  const reader=request.body?.getReader();
  requireThat(reader,'INVALID_JSON','Пустое тело запроса',400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();throw new DomainError('BODY_TOO_LARGE','Слишком большой запрос',413);}chunks.push(part.value);}
  const text=Buffer.concat(chunks).toString('utf8');
  try {return JSON.parse(text);} catch {throw new DomainError('INVALID_JSON','Некорректный JSON',400);}
}
export async function protectMutation(request:NextRequest) {
  const origin=process.env.APP_ORIGIN??'http://localhost:3000';
  requireThat(request.headers.get('origin')===origin,'ORIGIN_FORBIDDEN','Недопустимый источник запроса',403);
  const s=await session();
  requireThat(s.csrf && request.headers.get('x-csrf-token')===s.csrf,'CSRF_INVALID','Обновите страницу перед действием',403);
}
export async function rateLimit(key:string,limit=300) {
  const result=await query(`INSERT INTO rate_limits(key,window_start,count) VALUES($1,date_trunc('minute',now()),1)
    ON CONFLICT(key,window_start) DO UPDATE SET count=rate_limits.count+1 RETURNING count`,[key]);
  requireThat(result[0].count<=limit,'RATE_LIMITED','Слишком много запросов. Повторите через минуту',429);
}
export async function respond(fn:()=>Promise<unknown>) {
  const requestId=randomUUID();
  try {return NextResponse.json(await fn(),{headers:{'Cache-Control':'no-store','X-Request-Id':requestId}});}
  catch(error) {
    if(error instanceof DomainError) return NextResponse.json({error:{code:error.code,message:error.message,request_id:requestId}},{status:error.status});
    if(error instanceof ZodError) return NextResponse.json({error:{code:'VALIDATION_ERROR',message:'Проверьте заполненные поля',fields:error.issues.map(i=>({path:i.path.join('.'),message:i.message})),request_id:requestId}},{status:400});
    // SQL, сессии, payload и секреты не журналируются.
    console.error(JSON.stringify({request_id:requestId,error:error instanceof Error?error.name:'UnknownError'}));
    return NextResponse.json({error:{code:'SERVICE_UNAVAILABLE',message:'Сервис временно недоступен. Попробуйте ещё раз',request_id:requestId}},{status:503});
  }
}
