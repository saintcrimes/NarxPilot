import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { randomBytes } from 'node:crypto';
import { query } from './db';
import { isDemo } from './config';
import type { Actor } from '../domain/types';
import { requireThat } from '../domain/errors';
import { memberProfile,registerAccount,authenticateAccount } from './credentials';
import type { AccountProfile } from './credentials';
type SessionData={userId?:string;organizationId?:string;csrf?:string};
export async function session() {
  const password=process.env.SESSION_SECRET??'';
  requireThat(password.length>=32,'SESSION_NOT_CONFIGURED','Задайте SESSION_SECRET длиной от 32 символов',503);
  return getIronSession<SessionData>(await cookies(),{password,cookieName:'narxpilot_session',ttl:60*60*8,
    cookieOptions:{httpOnly:true,sameSite:'lax',secure:process.env.APP_ORIGIN?.startsWith('https://')??false,path:'/'}});
}
export async function actor():Promise<Actor> {
  const s=await session();
  requireThat(s.userId && s.organizationId,'UNAUTHENTICATED','Войдите в аккаунт',401);
  const member=(await query(`SELECT user_id,organization_id,role FROM memberships WHERE user_id=$1 AND organization_id=$2`,[s.userId,s.organizationId]))[0];
  requireThat(member,'UNAUTHENTICATED','Сессия больше не действительна',401);
  return {userId:member.user_id,organizationId:member.organization_id,role:member.role};
}
export async function demoProfiles() {
  requireThat(isDemo(),'DEMO_DISABLED','Демонстрационные аккаунты отключены',404);
  return query<AccountProfile>(`SELECT u.id user_id,m.organization_id,u.name,m.role,o.name organization_name
    FROM users u JOIN memberships m ON m.user_id=u.id JOIN organizations o ON o.id=m.organization_id WHERE u.is_demo ORDER BY m.role,u.name`);
}
export async function loginDemo(userId:string) {
  const profiles=await demoProfiles();
  const profile=profiles.find(p=>p.user_id===userId);
  requireThat(profile,'NOT_FOUND','Демоаккаунт не найден',404);
  return signIn(profile);
}
export async function sessionProfile(){
  const s=await session();
  return s.userId&&s.organizationId?memberProfile(s.userId,s.organizationId):null;
}
async function signIn(profile:AccountProfile){
  const s=await session();s.userId=profile.user_id;s.organizationId=profile.organization_id;s.csrf=randomBytes(24).toString('hex');
  await s.save(); return {profile,csrf:s.csrf};
}
export async function register(input:unknown){return signIn(await registerAccount(input));}
export async function login(input:unknown){return signIn(await authenticateAccount(input));}
