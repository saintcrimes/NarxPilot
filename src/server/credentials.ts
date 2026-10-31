import { pbkdf2,randomBytes,timingSafeEqual,randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { query,transaction } from './db';
import { DomainError,requireThat } from '../domain/errors';

const derive=promisify(pbkdf2);
const iterations=600000;
export type AccountProfile={user_id:string;organization_id:string;name:string;role:'buyer'|'supplier'|'admin';organization_name:string};
const email=z.string().trim().max(254).email().transform(value=>value.toLowerCase());
const password=z.string().min(10,'Пароль должен содержать минимум 10 символов').max(128);
export const registrationSchema=z.object({name:z.string().trim().min(2).max(100),email,password,organizationName:z.string().trim().min(2).max(150),role:z.enum(['buyer','supplier'])}).strict();
export const loginSchema=z.object({email,password:z.string().min(1).max(128)}).strict();

export async function hashPassword(value:string){
  const salt=randomBytes(24).toString('hex');
  const digest=await derive(value,salt,iterations,32,'sha256');
  return `pbkdf2-sha256$${iterations}$${salt}$${digest.toString('hex')}`;
}
export async function verifyPassword(value:string,encoded:string){
  const parts=encoded.split('$');
  const valid=parts.length===4&&parts[0]==='pbkdf2-sha256'&&parts[1]===String(iterations)&&/^[a-f0-9]{48}$/.test(parts[2])&&/^[a-f0-9]{64}$/.test(parts[3]);
  // Missing accounts take the same password-derivation path as existing accounts.
  const salt=valid?parts[2]:'0'.repeat(48);
  const expected=valid?Buffer.from(parts[3],'hex'):Buffer.alloc(32);
  const actual=await derive(value,salt,iterations,32,'sha256');
  return timingSafeEqual(actual,expected)&&valid;
}
export async function memberProfile(userId:string,organizationId:string){
  return (await query<AccountProfile>(`SELECT u.id user_id,m.organization_id,u.name,m.role,o.name organization_name
    FROM users u JOIN memberships m ON m.user_id=u.id JOIN organizations o ON o.id=m.organization_id
    WHERE u.id=$1 AND m.organization_id=$2`,[userId,organizationId]))[0]??null;
}
export async function registerAccount(input:unknown){
  const body=registrationSchema.parse(input);
  const encoded=await hashPassword(body.password);
  try{
    return await transaction(async db=>{
      const user=(await db.query('INSERT INTO users(name,is_demo) VALUES($1,false) RETURNING id',[body.name])).rows[0];
      await db.query('INSERT INTO auth_credentials(user_id,email,password_hash) VALUES($1,$2,$3)',[user.id,body.email,encoded]);
      const organization=(await db.query('INSERT INTO organizations(name,kind) VALUES($1,$2) RETURNING id',[body.organizationName,body.role])).rows[0];
      await db.query('INSERT INTO memberships(user_id,organization_id,role) VALUES($1,$2,$3)',[user.id,organization.id,body.role]);
      if(body.role==='supplier'){
        const location=(await db.query("SELECT id FROM locations ORDER BY (id='malika') DESC,id LIMIT 1")).rows[0];
        requireThat(location,'LOCATIONS_UNAVAILABLE','Справочник складов пока не настроен',503);
        await db.query('INSERT INTO warehouses(organization_id,location_id,name) VALUES($1,$2,$3)',[organization.id,location.id,'Основной склад']);
      }
      await db.query("INSERT INTO audit_log(actor_id,organization_id,action,object_id,request_id) VALUES($1,$2,'auth.register',$1,$3)",[user.id,organization.id,randomUUID()]);
      return {user_id:user.id,organization_id:organization.id,name:body.name,role:body.role,organization_name:body.organizationName};
    });
  }catch(error){
    if((error as {code?:string;constraint?:string}).code==='23505'&&(error as {constraint?:string}).constraint==='auth_credentials_email_key')throw new DomainError('EMAIL_EXISTS','Не удалось зарегистрировать этот email. Попробуйте войти.',409);
    throw error;
  }
}
export async function authenticateAccount(input:unknown){
  const body=loginSchema.parse(input);
  const account=(await query(`SELECT c.password_hash,u.id user_id,m.organization_id,u.name,m.role,o.name organization_name
    FROM auth_credentials c JOIN users u ON u.id=c.user_id JOIN memberships m ON m.user_id=u.id
    JOIN organizations o ON o.id=m.organization_id WHERE c.email=$1 AND NOT u.is_demo ORDER BY m.organization_id LIMIT 1`,[body.email]))[0];
  const valid=await verifyPassword(body.password,account?.password_hash??'');
  requireThat(account&&valid,'INVALID_CREDENTIALS','Неверный email или пароль',401);
  return {user_id:account.user_id,organization_id:account.organization_id,name:account.name,role:account.role,organization_name:account.organization_name};
}
