import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {readCustomSvg,customLibrary} from '../.build/library/custom.js';
import {namedObjectKeys,objectNameToken,parseObjectNames} from '../.build/editor/layout.js';
globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer;
const c=JSON.parse(await readFile(new URL('../public/library/catalog.json',import.meta.url),'utf8'));
test('SVG inline important preserves valid paints and CSS priority',()=>{
 const parsed=readCustomSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" style="fill:red !important;fill:blue;stroke:green!important;opacity:.5!important"/></svg>');
 const r=new DOMParser().parseFromString(parsed.svg,'image/svg+xml').getElementsByTagName('rect')[0];
 assert.equal(r.getAttribute('fill'),'red');assert.equal(r.getAttribute('stroke'),'green');assert.equal(r.getAttribute('opacity'),'.5');assert.equal(parsed.unsupportedPaints.length,0);
});
test('nested SVG preserves visible overflow in attributes and inline CSS',()=>{
 for(const attr of ['overflow="visible"','style="overflow:visible"']){
 const parsed=readCustomSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><svg width="50" height="50" ${attr}><rect width="100" height="100" fill="red"/></svg></svg>`);
 const nested=new DOMParser().parseFromString(parsed.svg,'image/svg+xml').getElementsByTagName('svg')[1];assert.equal(nested.getAttribute('overflow'),'visible');}
});
test('named objects keep role identity on deletion/reorder and distinct duplicate IDs',()=>{
 const original=namedObjectKeys(['book','phone','coin']);const roles={[original[1].instanceId]:'secondary'};
 for(const ids of [['phone','coin'],['coin','phone','book']])assert.equal(roles[namedObjectKeys(ids).find(o=>o.objectId==='phone').instanceId],'secondary');
 const duplicates=namedObjectKeys(['phone','phone']);assert.notEqual(duplicates[0].instanceId,duplicates[1].instanceId);
});
test('click tokens resolve exact custom objects even with colliding built-in names',async()=>{
 const s=JSON.parse(await readFile(new URL('../examples/end-to-end/custom-roles.sostav.json',import.meta.url),'utf8'));s.customObjects[0].name='Книга';
 const catalog=customLibrary(c,s.customObjects);
 for(const id of ['book',s.customObjects[0].id])assert.deepEqual(parseObjectNames(catalog,objectNameToken(catalog,id)).objectIds,[id]);
});
