import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { inspectComposition } from '../.build/editor/preflight.js';
import { createBlankScene } from '../.build/editor/model.js';
import { customLibrary, customTexts, readCustomSvg } from '../.build/library/custom.js';
import { exportSvg } from '../.build/editor/svg.js';
globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer;
const base=JSON.parse(await readFile(new URL('../public/library/catalog.json',import.meta.url),'utf8'));
function catalogFor(width=100,height=100){
 const definition=base.objects[0],original=definition.variants.L.main;
 const asset={...original,width,height};
 return {...base,objects:[{...definition,id:'box',name:'Предмет',variants:{S:{main:{...asset,width:20,height:20},secondary:asset},L:{main:asset,secondary:asset}}}]};
}
const instance=(id,x=.5,y=.5,rotation=0)=>({instanceId:id,objectId:'box',role:'main',x,y,rotation});
const sceneFor=objects=>({...createBlankScene(),backgroundVisible:false,compositionScale:1,objects});
const byCode=(issues,code)=>issues.filter(issue=>issue.code===code);

test('preflight treats exact canvas contact as inside and detects real protrusion with rotation',()=>{
 const catalog=catalogFor();
 assert.equal(byCode(inspectComposition(catalog,sceneFor([instance('edge',.05)])),'outside').length,0);
 assert.equal(byCode(inspectComposition(catalog,sceneFor([instance('outside',.049)])),'outside').length,1);
 assert.equal(byCode(inspectComposition(catalog,sceneFor([instance('rotated',.06,.5,45)])),'outside').length,1);
 assert.equal(byCode(inspectComposition(catalog,sceneFor([instance('inside',.071,.5,45)])),'outside').length,0);
});

test('preflight uses actual canvas format, size variant and common composition scale',()=>{
 const catalog=catalogFor();
 const landscape={...sceneFor([instance('edge',30/1200)]),formatId:'landscape'};
 assert.equal(byCode(inspectComposition(catalog,landscape),'outside').length,1);
 assert.equal(byCode(inspectComposition(catalog,{...landscape,compositionScale:.5}),'outside').length,0);
 assert.equal(byCode(inspectComposition(catalog,{...landscape,size:'S'}),'outside').length,0);
});

test('overlap threshold is strictly above 28 percent of the smaller frame and reports both layers',()=>{
 const catalog=catalogFor();
 assert.equal(byCode(inspectComposition(catalog,sceneFor([instance('a'),instance('b',.572)])),'overlap').length,0);
 const overlap=byCode(inspectComposition(catalog,sceneFor([instance('a'),instance('b',.571)])),'overlap');
 assert.equal(overlap.length,1);assert.ok(Math.abs(overlap[0].overlap-.29)<1e-9);
 assert.deepEqual(overlap[0].instanceIds,['a','b']);assert.match(overlap[0].message,/слой 1/);assert.match(overlap[0].message,/слой 2/);
 assert.equal(byCode(inspectComposition(catalog,sceneFor([instance('a'),instance('b',.6)])),'overlap').length,0);
});

test('parallel thin rotated frames do not overlap despite heavily overlapping axis-aligned bounds',()=>{
 const catalog=catalogFor(100,10),offset=20/Math.sqrt(2)/1000;
 const scene=sceneFor([instance('a',.5,.5,45),instance('b',.5-offset,.5+offset,45)]);
 assert.equal(byCode(inspectComposition(catalog,scene),'overlap').length,0);
 const coincident=inspectComposition(catalog,sceneFor([instance('a',.5,.5,45),instance('b',.5,.5,45)]));
 assert.ok(byCode(coincident,'overlap')[0].overlap>.999999);
});

test('objects entirely beyond canvas produce bounds warnings without invisible-overlap noise',()=>{
 const issues=inspectComposition(catalogFor(),sceneFor([instance('a',1.5),instance('b',1.5)]));
 assert.equal(byCode(issues,'outside').length,2);assert.equal(byCode(issues,'overlap').length,0);
});

test('only used custom colors are reported once, original colors remain a nonblocking recommendation',()=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0L10 10L20 0Z" fill="#f00" stroke="black"/></svg>';
 const item={id:'custom-check',name:'Свой',tags:[],meanings:[],svg:readCustomSvg(svg).svg};
 const catalog=customLibrary(base,[item]);
 const scene={...sceneFor([instance('a',.25),instance('b',.75)]),customObjects:[item]};
 scene.objects=scene.objects.map(object=>({...object,objectId:item.id}));
 const colors=byCode(inspectComposition(catalog,scene),'original-colors');
 assert.equal(colors.length,1);assert.equal(colors[0].level,'info');assert.deepEqual(colors[0].instanceIds,['a','b']);
 assert.deepEqual(colors[0].colors.sort(),['#000000','#FF0000']);
 assert.equal(byCode(inspectComposition(catalog,{...scene,objects:[]}),'original-colors').length,0);
 const assigned={...item,paintRoles:{'#FF0000':'object.primary','#000000':'neutral.ink'}};
 assert.equal(byCode(inspectComposition(customLibrary(base,[assigned]),{...scene,customObjects:[assigned]}),'original-colors').length,0);
});

test('unsupported custom paint values are reported even when recognized colors all have roles',()=>{
 const item={id:'custom-unsupported',name:'HSL',tags:[],meanings:[],svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle r="4" fill="hsl(30 50% 50%)"/></svg>'};
 const scene={...sceneFor([{...instance('hsl'),objectId:item.id}]),customObjects:[item]};
 const issues=byCode(inspectComposition(customLibrary(base,[item]),scene),'original-colors');
 assert.equal(issues.length,1);assert.match(issues[0].message,/hsl/);
});

test('preflight never edits scene or SVG and explains background-only or empty exports',()=>{
 const catalog=catalogFor(),scene=sceneFor([instance('a')]);
 const before=structuredClone(scene);inspectComposition(catalog,scene);assert.deepEqual(scene,before);
 assert.match(inspectComposition(catalog,sceneFor([]))[0].message,/пустым/);
 assert.match(inspectComposition(catalog,{...sceneFor([]),backgroundVisible:true})[0].message,/только фон/);
 const item={id:'custom-vector',name:'Вектор',tags:[],meanings:[],svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="M1 2L20 3Z" fill="#f00"/></svg>'};
 const merged=customLibrary(base,[item]);const portable={...sceneFor([{...instance('v'),objectId:item.id}]),customObjects:[item]};
 const texts=customTexts(new Map(),[item]),expected=exportSvg(merged,texts,portable);
 inspectComposition(merged,portable);assert.equal(exportSvg(merged,texts,portable),expected);
});
