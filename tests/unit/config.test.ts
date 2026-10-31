import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDatabase } from '../../src/server/config';
test('B15: demo не может использовать live-базу и наоборот',()=>{
  const previous=process.env.DEMO_MODE;
  try{process.env.DEMO_MODE='true';assert.equal(validateDatabase('postgresql://localhost/narxpilot_demo'),'narxpilot_demo');assert.throws(()=>validateDatabase('postgresql://localhost/narxpilot_live'));process.env.DEMO_MODE='false';assert.throws(()=>validateDatabase('postgresql://localhost/narxpilot_demo'));assert.equal(validateDatabase('postgresql://localhost/narxpilot_live'),'narxpilot_live');}finally{process.env.DEMO_MODE=previous;}
});
