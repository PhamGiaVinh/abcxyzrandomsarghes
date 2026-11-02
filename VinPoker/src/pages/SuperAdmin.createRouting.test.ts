import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it} from 'vitest';

// Route wiring/architecture evidence only. The shared form's behavioral tests
// and native RPC qualification remain separate, not a browser-admin PASS.
const source=ts.createSourceFile('SuperAdmin.tsx',readFileSync('src/pages/SuperAdmin.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const all:ts.Node[]=[];
function visit(node:ts.Node){all.push(node);ts.forEachChild(node,visit);}visit(source);
it('imports the canonical atomic create dialog rather than shadowing it with a direct writer',()=>{
 const imported=all.some(node=>ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text==='@/components/floor/TournamentManagerShared'&&node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings)&&node.importClause.namedBindings.elements.some(item=>item.name.text==='NewTournamentDialog'));
 expect(imported).toBe(true);
 expect(all.some(node=>ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='NewTournamentDialog')).toBe(false);
});
it('keeps the admin entry single-day and selects only approved clubs through the shared form',()=>{
 const entry=all.find(node=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)==='NewTournamentDialog') as ts.JsxSelfClosingElement;
 expect(entry).toBeTruthy();const props=entry.attributes.getText(source);
 expect(props).toContain('defaultClubId=""');expect(props).toMatch(/multiClub(?:\s|$)/);expect(props).toContain('lockMode="single"');
 expect(props).toMatch(/clubs=\{clubs\.filter\(.*status\s*===\s*["']approved["']/);
});
it('has no tournaments insert or upsert remaining in this page',()=>{
 const direct=all.filter(node=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['insert','upsert'].includes(node.expression.name.text)) as ts.CallExpression[];
 expect(direct.filter(node=>/\.from\(["']tournaments["']\)/.test(node.expression.getText(source)))).toHaveLength(0);
});
it('routes edits through the shared scoped atomic dialog without a shadow direct writer',()=>{
 const imported=all.some(node=>ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text==='@/components/floor/TournamentManagerShared'&&node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings)&&node.importClause.namedBindings.elements.some(item=>item.name.text==='EditTournamentDialog'));
 expect(imported).toBe(true);
 expect(all.some(node=>ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='EditTournamentDialog')).toBe(false);
 const direct=all.filter(node=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='update') as ts.CallExpression[];
 const tournamentUpdates=direct.filter(node=>/\.from\(["']tournaments["']\)/.test(node.expression.getText(source)));
 expect(tournamentUpdates).toHaveLength(0);
});
