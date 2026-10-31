// Supplemental syntax check; this does not replace tsc or a Next.js build.
const ts=require(process.env.TYPESCRIPT_PATH||'typescript');
const fs=require('node:fs');const path=require('node:path');let count=0,failed=0;
function visit(folder){for(const e of fs.readdirSync(folder,{withFileTypes:true})){const p=path.join(folder,e.name);if(e.isDirectory())visit(p);else if(/\.tsx?$/.test(e.name)&&!e.name.endsWith('.d.ts')){count++;const result=ts.transpileModule(fs.readFileSync(p,'utf8'),{fileName:p,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,isolatedModules:true}});for(const d of result.diagnostics||[])if(d.category===ts.DiagnosticCategory.Error){failed++;console.error(p,ts.flattenDiagnosticMessageText(d.messageText,' '));}}}}
for(const folder of ['app','src','scripts','tests'])visit(folder);
console.log(JSON.stringify({typescript_files:count,syntax_errors:failed}));process.exitCode=failed?1:0;
