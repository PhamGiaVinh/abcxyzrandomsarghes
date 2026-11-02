// Read-only reproducible R00/R12 inventory, not a runtime route acceptance test.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {createHash} from 'node:crypto';
const rows=[];
const entryDispatches=[];
const imports=new Map();
const locals=new Map(),framework=new Map();
const resolveModule=(file,specifier)=>{
  const base=specifier.startsWith('@/')?path.resolve('src',specifier.slice(2))
    :specifier.startsWith('.')?path.resolve(path.dirname(file),specifier):null;
  return base&&[base,...['.tsx','.ts','/index.tsx','/index.ts'].map(ext=>base+ext)].find(candidate=>existsSync(candidate)&&statSync(candidate).isFile());
};
for(const file of ['src/App.tsx','src/OpsApp.tsx','src/main.tsx']){
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const bindings=new Map();imports.set(file,bindings);
  const definitions=new Map(),frameworkBindings=new Set();locals.set(file,definitions);framework.set(file,frameworkBindings);
  const guardValues=new Map();
  const attribute=(node,name)=>node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(source)===name)?.initializer;
  const element=node=>attribute(node,'element')?.getText(source).replace(/\s+/g,' ').replace(/\|/g,'\\|')??'—';
  function visit(node){
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){
      const target=resolveModule(file,node.moduleSpecifier.text),clause=node.importClause;
      if(target&&clause?.name)bindings.set(clause.name.text,target);
      if(target&&clause?.namedBindings&&ts.isNamedImports(clause.namedBindings))
        for(const item of clause.namedBindings.elements)bindings.set(item.name.text,target);
      if(node.moduleSpecifier.text==='react-router-dom'&&clause?.namedBindings&&ts.isNamedImports(clause.namedBindings))
        for(const item of clause.namedBindings.elements)if((item.propertyName??item.name).text==='Navigate')frameworkBindings.add(item.name.text);
    }
    if(ts.isFunctionDeclaration(node)&&node.name)definitions.set(node.name.text,{node,source});
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer
      &&(ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer)))definitions.set(node.name.text,{node:node.initializer,source});
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){
      guardValues.set(node.name.text,node.initializer);
      const findImport=child=>{
        if(ts.isCallExpression(child)&&child.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(child.arguments[0])){
          const target=resolveModule(file,child.arguments[0].text);if(target)bindings.set(node.name.text,target);
        }
        ts.forEachChild(child,findImport);
      };findImport(node.initializer);
    }
    if((ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node))&&node.tagName.getText(source)==='Route'){
      const path=attribute(node,'path');
      if(path&&ts.isStringLiteral(path)){
        const wrappers=[],conditions=[];let parent=node.parent;
        while(parent){
          if(ts.isJsxElement(parent)&&parent.openingElement!==node&&parent.openingElement.tagName.getText(source)==='Route')wrappers.unshift(element(parent.openingElement));
          if(ts.isBinaryExpression(parent)&&parent.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken)conditions.unshift(parent.left.getText(source));
          if(ts.isIfStatement(parent))conditions.unshift(parent.expression.getText(source));
          parent=parent.parent;
        }
        rows.push({file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,path:path.text,element:element(node),wrappers,conditions});
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  const pathnameGuards=(node,seen=new Set())=>{
    if(ts.isIdentifier(node)&&guardValues.has(node.text)&&!seen.has(node.text)){
      const next=new Set(seen);next.add(node.text);return pathnameGuards(guardValues.get(node.text),next)
        .map(guard=>({...guard,resolvedCondition:guardValues.get(node.text).getText(source)}));
    }
    if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.EqualsEqualsToken].includes(node.operatorToken.kind)){
      for(const [value,target] of [[node.left,node.right],[node.right,node.left]]){
        if(ts.isStringLiteral(value)&&target.getText(source).includes('window.location.pathname'))
          return [{path:value.text,resolvedGuard:node.getText(source)}];
      }
    }
    const found=[];ts.forEachChild(node,child=>{found.push(...pathnameGuards(child,seen));});return found;
  };
  const scanDispatch=node=>{
    if(ts.isIfStatement(node)){
      const guards=pathnameGuards(node.expression);
      if(guards.length){
        const targets=new Set();
        const scanBranch=child=>{
          if((ts.isJsxOpeningElement(child)||ts.isJsxSelfClosingElement(child))&&bindings.has(child.tagName.getText(source)))
            targets.add(bindings.get(child.tagName.getText(source)));
          if(ts.isCallExpression(child)&&child.expression.kind===ts.SyntaxKind.ImportKeyword&&child.arguments[0]&&ts.isStringLiteral(child.arguments[0])){
            const target=resolveModule(file,child.arguments[0].text);if(target)targets.add(target);
          }
          ts.forEachChild(child,scanBranch);
        };
        scanBranch(node.thenStatement);
        for(const guard of guards)for(const target of targets.size?targets:[null])entryDispatches.push({
          kind:'pathname_dispatch',file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,
          ...guard,condition:node.expression.getText(source),resolvedCondition:guard.resolvedCondition??node.expression.getText(source),source:target?path.relative(process.cwd(),target).replaceAll('\\','/'):null,
        });
      }
    }
    ts.forEachChild(node,scanDispatch);
  };
  scanDispatch(source);
}
if(process.argv.includes('--actions')||process.argv.includes('--dependencies')){
  const pages=new Map(),unresolved=[],inlineRoutes=[],frameworkRoutes=[];
  for(const route of rows){
    const tags=[...route.element.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)].map(match=>match[1]);
    const resolveTag=(name,seen=new Set())=>{
      if(seen.has(name))return [];
      const target=imports.get(route.file).get(name);if(target)return [target];
      if(framework.get(route.file).has(name)){frameworkRoutes.push({route:route.path,component:name,source:route.file});return [];}
      const local=locals.get(route.file).get(name);
      if(!local){unresolved.push({route:route.path,component:name,source:route.file});return [];}
      const next=new Set(seen);next.add(name);
      inlineRoutes.push({route:route.path,component:name,source:route.file,line:local.source.getLineAndCharacterOfPosition(local.node.getStart(local.source)).line+1});
      const children=new Set();
      const collect=node=>{if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&/^[A-Z]/.test(node.tagName.getText(local.source)))children.add(node.tagName.getText(local.source));ts.forEachChild(node,collect);};
      collect(local.node);
      return [...children].flatMap(child=>resolveTag(child,next));
    };
    for(const name of tags){
     for(const target of new Set(resolveTag(name))){
      if(!pages.has(target))pages.set(target,{source:path.relative(process.cwd(),target).replaceAll('\\','/'),routes:[],routeIds:[],actions:[],directCalls:[]});
      const page=pages.get(target);if(!page.routes.includes(route.path))page.routes.push(route.path);
      const routeId=route.file+':'+route.line+':'+route.path;
      if(!page.routeIds.includes(routeId))page.routeIds.push(routeId);
     }
    }
  }
  for(const entry of entryDispatches){
    if(!entry.source){unresolved.push({route:entry.path,source:entry.file,kind:entry.kind});continue;}
    const target=path.resolve(entry.source);
    if(!pages.has(target))pages.set(target,{source:entry.source,routes:[],routeIds:[],actions:[],directCalls:[]});
    const page=pages.get(target);if(!page.routes.includes(entry.path))page.routes.push(entry.path);
    page.routeIds.push(entry.file+':'+entry.line+':'+entry.path+':pathname_dispatch');
  }
  for(const [file,page] of pages){
    const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const line=node=>source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
    const owner=node=>{let parent=node.parent;while(parent){
      if((ts.isFunctionDeclaration(parent)||ts.isMethodDeclaration(parent))&&parent.name)return parent.name.getText(source);
      if(ts.isVariableDeclaration(parent)&&ts.isIdentifier(parent.name)&&parent.initializer
        &&(ts.isArrowFunction(parent.initializer)||ts.isFunctionExpression(parent.initializer)
          ||ts.isCallExpression(parent.initializer)&&['useCallback','useMemo'].includes(parent.initializer.expression.getText(source))))return parent.name.text;
      parent=parent.parent;
    }return '<module>';};
    function scan(node){
      if(ts.isJsxAttribute(node)&&['onClick','onSubmit'].includes(node.name.getText(source)))
        page.actions.push({line:line(node),owner:owner(node),event:node.name.getText(source),handler:node.initializer?.getText(source).replace(/\s+/g,' ').slice(0,180)??''});
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)
        &&['rpc','invoke','select','insert','upsert','update','delete','upload','remove',
          'signInWithPassword','signUp','signOut','resetPasswordForEmail','updateUser','getUser','getSession','exchangeCodeForSession','verifyOtp'].includes(node.expression.name.text))
        page.directCalls.push({line:line(node),owner:owner(node),method:node.expression.name.text,call:node.getText(source).replace(/\s+/g,' ').slice(0,240)});
      ts.forEachChild(node,scan);
    }scan(source);
  }
  if(process.argv.includes('--dependencies')){
    // Import reachability is deliberately an over-approximation, not a call graph.
    // Keep only serializable records; release each parsed AST before the next file.
    const nodes=new Map();const queue=[...pages.keys()];
    const relative=file=>path.relative(process.cwd(),file).replaceAll('\\','/');
    const apiMethods=new Set(['rpc','invoke','from','insert','upsert','update','delete','upload','remove']);
    const possibleTargets=expression=>{
      if(!expression)return [null];
      if(ts.isStringLiteral(expression)||ts.isNoSubstitutionTemplateLiteral(expression))return [expression.text];
      if(ts.isParenthesizedExpression(expression)||ts.isAsExpression(expression)||ts.isTypeAssertionExpression(expression))return possibleTargets(expression.expression);
      if(ts.isConditionalExpression(expression))return [...new Set([...possibleTargets(expression.whenTrue),...possibleTargets(expression.whenFalse)])];
      return [null];
    };
    for(let cursor=0;cursor<queue.length;cursor++){
      const file=queue[cursor];if(nodes.has(file))continue;
      const content=readFileSync(file,'utf8');
      const source=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
      const node={source:relative(file),sha256:createHash('sha256').update(content).digest('hex'),imports:[],assets:[],actions:[],apiCandidates:[],coverage:'RUNTIME_UNVERIFIED'};
      nodes.set(file,node);
      const dependencies=new Set();
      const addImport=(specifier,kind,line)=>{
        const target=resolveModule(file,specifier);
        if(target&&relative(target).startsWith('src/')){
          if(/\.tsx?$/.test(target)){
            node.imports.push({source:relative(target),kind,line});dependencies.add(target);
          }else{
            node.assets.push({source:relative(target),kind,line,sha256:createHash('sha256').update(readFileSync(target)).digest('hex')});
          }
        }
      };
      function scanDependency(child){
        const line=source.getLineAndCharacterOfPosition(child.getStart(source)).line+1;
        if(ts.isImportDeclaration(child)&&!child.importClause?.isTypeOnly&&ts.isStringLiteral(child.moduleSpecifier))
          addImport(child.moduleSpecifier.text,'static',line);
        if(ts.isExportDeclaration(child)&&!child.isTypeOnly&&child.moduleSpecifier&&ts.isStringLiteral(child.moduleSpecifier))
          addImport(child.moduleSpecifier.text,'re-export',line);
        if(ts.isCallExpression(child)&&child.expression.kind===ts.SyntaxKind.ImportKeyword&&child.arguments[0]&&ts.isStringLiteral(child.arguments[0]))
          addImport(child.arguments[0].text,'dynamic',line);
        if(ts.isJsxAttribute(child)&&['onClick','onSubmit','onChange','onCheckedChange','onValueChange'].includes(child.name.getText(source)))
          node.actions.push({line,event:child.name.getText(source)});
        if(ts.isCallExpression(child)&&ts.isPropertyAccessExpression(child.expression)&&apiMethods.has(child.expression.name.text)){
          const name=child.expression.name.text;
          for(const target of ['rpc','invoke','from'].includes(name)?possibleTargets(child.arguments[0]):[null])
            node.apiCandidates.push({line,method:name,target});
        }else if(ts.isCallExpression(child)&&ts.isIdentifier(child.expression)&&child.expression.text==='rpc'){
          // A named callback is a candidate only; this does not resolve its runtime implementation.
          for(const target of possibleTargets(child.arguments[0]))
            node.apiCandidates.push({line,method:'rpc',target,callStyle:'named-callback-heuristic'});
        }
        ts.forEachChild(child,scanDependency);
      }scanDependency(source);
      for(const dependency of dependencies)if(!nodes.has(dependency))queue.push(dependency);
    }
    const bySource=new Map([...nodes.values()].map(node=>[node.source,node]));
    const roots=[...pages.values()].map(page=>{
      const seen=new Set();const pending=[page.source];
      while(pending.length){const file=pending.pop();if(seen.has(file))continue;seen.add(file);for(const edge of bySource.get(file)?.imports??[])pending.push(edge.source);}
      return {source:page.source,routes:page.routes,routeIds:page.routeIds,dependencySources:[...seen].sort(),coverage:'RUNTIME_UNVERIFIED'};
    });
    console.log(JSON.stringify({kind:'STATIC_ROUTE_IMPORT_REACHABILITY_NOT_CALL_GRAPH_OR_ACCEPTANCE',
      routeDeclarations:rows.length,summary:{roots:roots.length,sources:nodes.size,importEdges:[...nodes.values()].reduce((n,v)=>n+v.imports.length,0),actionCandidates:[...nodes.values()].reduce((n,v)=>n+v.actions.length,0),apiCandidates:[...nodes.values()].reduce((n,v)=>n+v.apiCandidates.length,0)},
      limitations:['Imports include unused and feature-gated code; reachability does not establish execution, actor authority or side effects.',
        'SDK-like methods and named rpc callbacks include false positives. Literal/conditional-branch table/RPC/function candidates are indexed without payload values; branch enabled-state and arbitrary aliases are not resolved.',
        'Dynamic non-literal imports, package internals, computed handlers and server implementation bodies are not resolved.',
        'No security audit or runtime calls. All coverage remains unverified; evidence must be attached per exact route/action/context.'],
      routeDeclarationsDetail:rows,entryDispatches,roots,nodes:[...nodes.values()],unresolved,inlineRoutes,frameworkRoutes},null,2));
    process.exit(0);
  }
  console.log(JSON.stringify({kind:'STATIC_DIRECT_ROUTE_SURFACES_NOT_RUNTIME_ACCEPTANCE',routeDeclarations:rows.length,
    limitations:['Literal route/import bindings and local JSX wrappers resolved; inline/framework routing and unresolved entries are explicit.',
      'Only direct onClick/onSubmit and selected SDK-like method names indexed; hooks/children/other events remain untraced.',
      'Method matches may be non-SDK calls; no authority, enabled-state, side-effect or coverage PASS is inferred.'],
    summary:{sources:pages.size,actions:[...pages.values()].reduce((n,p)=>n+p.actions.length,0),directCalls:[...pages.values()].reduce((n,p)=>n+p.directCalls.length,0),unresolved:unresolved.length},
    pages:[...pages.values()],entryDispatches,inlineRoutes,frameworkRoutes,unresolved},null,2));
  process.exit(0);
}
const escape=value=>String(value).replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
console.log('# Local route inventory — '+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'numeric',month:'long',year:'numeric'}).format(new Date())+'\n');
console.log('Source: integration HEAD ef6a26948 plus current working changes. Static TypeScript AST, no browser/network/DB writes. Re-run: `node tests/localRouteInventory.mjs`.\n');
console.log(`Explicit path declarations: ${rows.length}; App ${rows.filter(r=>r.file==='src/App.tsx').length}; Ops ${rows.filter(r=>r.file==='src/OpsApp.tsx').length}. Wrapper-only routes are carried in the parent column, not counted as paths.\n`);
console.log('Declaration is NOT active/runtime proof. DEV conditions, page feature gates, registry capability and backend authorization still apply. Every row remains RUNTIME_UNVERIFIED unless linked evidence below proves the specific action/scope. Never infer enabled status from old App comments.\n');
console.log('| Source | Path | Element / redirect | Parent route wrappers | Ancestor conditions |\n|---|---|---|---|---|');
for(const row of rows)console.log(`| ${row.file}:${row.line} | ${escape(row.path)} | ${escape(row.element)} | ${escape(row.wrappers.join(' → ')||'—')} | ${escape(row.conditions.join(' && ')||'—')} |`);
console.log('\n## Pathname dispatches before React Router\n');
console.log('These are additional entry dispatches, not Route declarations or runtime coverage. Literal pathname equality (including normalized pathname expressions) is resolved through local constant guards; computed routing helpers remain outside this static resolution.\n');
console.log('| Source | Path | Target source | Condition | Resolved condition |\n|---|---|---|---|---|');
for(const row of entryDispatches)console.log(`| ${row.file}:${row.line} | ${escape(row.path)} | ${escape(row.source??'UNRESOLVED')} | ${escape(row.condition)} | ${escape(row.resolvedCondition)} |`);
console.log('\n## Evidence routing and remaining coverage\n');
console.log('- Operational Floor/Cashier/Tracker/Chip/History/TV: partial native/browser evidence in `ops-local-integration.md`, central R00–R13 table; not every route or action accepted.');
console.log('- Staking source/native/browser fixtures and gaps: `staking-local-20261018.md`. Other admin/import/marketplace actions remain unaccepted.');
console.log('- F&B/social/chat: partial evidence in main handoff. Guest order, invite acceptance, uploads, full tenant/role/error recovery still need route-specific coverage.');
console.log('- Online poker source is currently enabled (`FEATURES.onlinePoker=true`, `RUNTIME_LIVE=true`); it cannot be classified retired because an old comment says dark. PokerIQ remote questions, staffApp and dealerMobileApp are also source-enabled; verify actual gates/behavior separately.');
console.log('- GTO: no explicit GTO route in these two trees. This alone does not prove retirement/no bootstrap; inspect entrypoint/import consumers and route smoke.');
console.log('- Audit next: GroupInvite read/token/actor fences and acceptance receipt, SetupDavinci bootstrap/auth errors, public/profile/leaderboard/schedule, online poker actions, staff salary/attendance, admin/finance/export/media. These are audit targets, not confirmed live vulnerabilities.');
console.log('- Full local acceptance and R13 browser performance remain open; no production release/CI/full build performed by this inventory.');
