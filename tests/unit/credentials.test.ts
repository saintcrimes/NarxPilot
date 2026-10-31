import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword,verifyPassword,registrationSchema,loginSchema } from '../../src/server/credentials';

test('Пароль хешируется с уникальной солью; верный пароль проходит, неверный — нет',async()=>{
  const value='Test-password-2026';const first=await hashPassword(value),second=await hashPassword(value);
  assert.notEqual(first,second);assert.ok(!first.includes(value));
  assert.equal(await verifyPassword(value,first),true);
  assert.equal(await verifyPassword('wrong-password',first),false);
  assert.equal(await verifyPassword(value,''),false);
  assert.equal(await verifyPassword(value,'pbkdf2-sha256$1$bad$bad'),false);
});
test('Регистрация нормализует email и запрещает admin, короткий пароль и дополнительные поля',()=>{
  const body={name:'  Тестовый пользователь  ',email:'  PERSON@Example.com ',password:'test-password-2026',organizationName:'  Компания  ',role:'buyer'};
  const parsed=registrationSchema.parse(body);assert.equal(parsed.email,'person@example.com');assert.equal(parsed.name,'Тестовый пользователь');assert.equal(parsed.organizationName,'Компания');
  for(const change of [{role:'admin'},{password:'short'},{email:'invalid'},{organizationId:'foreign-id'}])assert.throws(()=>registrationSchema.parse({...body,...change}));
  assert.equal(loginSchema.parse({email:'PERSON@EXAMPLE.COM',password:'x'}).email,'person@example.com');
});
