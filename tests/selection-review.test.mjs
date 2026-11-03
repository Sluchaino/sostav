import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer;
import { editReview, validateSelectionReview, reviewFromScene, reviewWithSupport } from '../.build/editor/selection.js';
import { createBlankScene, validateScene, readScene, reduceHistory } from '../.build/editor/model.js';
import { generateLayouts } from '../.build/editor/layout.js';
const catalog = JSON.parse(await readFile(new URL('../public/library/catalog.json', import.meta.url),'utf8'));
const item = { objectId:'book',role:'secondary',origin:'rules',reason:'Знания' };

test('review edits retain roles on replacement, enforce limits, deduplicate and honor exclusions',()=>{
  const original=[item];
  const replaced=editReview(original,{type:'replace',objectId:'lamp',previousId:'book'},catalog);
  assert.equal(replaced[0].role,'secondary'); assert.equal(replaced[0].origin,'manual');
  assert.equal(original[0].objectId,'book');
  assert.deepEqual(editReview(original,{type:'remove',objectId:'book'},catalog),[]);
  assert.throws(()=>editReview(original,{type:'add',objectId:'book'},catalog));
  assert.throws(()=>editReview(original,{type:'add',objectId:'phone'},catalog,['phone']));
  assert.throws(()=>editReview(original,{type:'replace',objectId:'lamp',previousId:'missing'},catalog));
  const full=catalog.objects.slice(0,6).map(o=>({...item,objectId:o.id}));
  assert.throws(()=>editReview(full,{type:'add',objectId:catalog.objects[6].id},catalog));
});

test('manual selections persist, validate and assemble with undo as a single scene',()=>{
  const review={prompt:'Платное обучение',items:[{objectId:'book',role:'main',origin:'rules',reason:'Знания'}, {objectId:'coin',role:'main',origin:'manual',reason:'Выбрано вручную.'}]};
  const scene={...createBlankScene(),selectionReview:review,objects:review.items.map(item=>({instanceId:'review-'+item.objectId,objectId:item.objectId,role:item.role,x:.5,y:.5,rotation:0}))};
  const restored=JSON.parse(JSON.stringify(scene)); validateScene(restored,catalog);
  const variants=generateLayouts(catalog,restored,{seed:0});
  assert.equal(variants.length,3); assert.deepEqual(variants[0].scene.selectionReview,review);
  const initial=createBlankScene();const h=reduceHistory({past:[],present:initial,future:[]},{type:'commit',value:variants[0].scene});
  assert.deepEqual(reduceHistory(h,{type:'undo'}).present,initial);
  for(const change of [{origin:'unknown'},{role:'unknown'},{objectId:'missing'},{reason:''}]){
    assert.throws(()=>validateSelectionReview({...review,items:[{...review.items[0],...change}]},catalog));
  }
  assert.throws(()=>validateSelectionReview({...review,items:[review.items[0],review.items[0]]},catalog));
  validateScene(createBlankScene(),catalog);
});

test('reopening composition uses current canvas roles and additions, not stale selection provenance',()=>{
  const object=(id,role='main')=>({instanceId:'theme-'+id,objectId:id,role,x:.5,y:.5,rotation:0});
  const stale={prompt:'Обучение онлайн',items:[{objectId:'book',role:'main',origin:'rules',reason:'Знания'},{objectId:'phone',role:'main',origin:'rules',reason:'Связь'}]};
  const scene={...createBlankScene(),selectionReview:stale,objects:[object('phone','secondary'),object('pen')]};
  const items=reviewFromScene(scene);
  assert.deepEqual(items.map(i=>[i.objectId,i.role,i.origin]),[['phone','secondary','manual'],['pen','main','manual']]);
  assert.equal(stale.items[1].role,'main');
  const updated={...scene,selectionReview:{prompt:stale.prompt,items}};
  for(let seed=0;seed<5;seed++)for(const variant of generateLayouts(catalog,updated,{seed})){
    const restored=JSON.parse(JSON.stringify(variant.scene));validateScene(restored,catalog);
    assert.deepEqual(restored.objects.map(o=>[o.objectId,o.role]),[['phone','secondary'],['pen','main']]);
    assert.deepEqual(reviewFromScene(restored),items);
  }
  assert.deepEqual(reviewFromScene({...scene,objects:[]}),[],'deleted objects must not return from history');
  assert.equal(reviewFromScene({...scene,objects:[object('book'),{...object('book','secondary'),instanceId:'copy'}]}),null,'duplicate instances must use canvas mode');
  assert.equal(reviewFromScene(createBlankScene()),null);
});

test('manual role edits survive repeated generation and automatic support toggles',()=>{
  const initial=[{objectId:'book',role:'main',origin:'rules',reason:'Знания'},{objectId:'phone',role:'main',origin:'rules',reason:'Онлайн'}];
  const edited=editReview(initial,{type:'role',objectId:'phone',role:'secondary'},catalog);
  assert.equal(edited[1].origin,'manual');assert.equal(initial[1].role,'main');
  const suggested=[...initial,{objectId:'pen',role:'secondary',origin:'rules',reason:'Дополнение'}];
  const enabled=reviewWithSupport(edited,suggested,true);
  assert.deepEqual(enabled.map(i=>[i.objectId,i.role]),[['book','main'],['phone','secondary'],['pen','secondary']]);
  assert.deepEqual(reviewWithSupport(enabled,suggested,false),edited,'turning off automatic support keeps the explicitly assigned background object');
  const base={...createBlankScene(),selectionReview:{prompt:'Обучение онлайн',items:edited},objects:edited.map(i=>({instanceId:'theme-'+i.objectId,objectId:i.objectId,role:i.role,x:.5,y:.5,rotation:0}))};
  for(let seed=0;seed<5;seed++)for(const variant of generateLayouts(catalog,base,{seed})){
    assert.equal(variant.scene.objects.find(o=>o.objectId==='phone').role,'secondary');
    assert.equal(variant.scene.objects.find(o=>o.objectId==='book').role,'main');
    validateScene(variant.scene,catalog);
  }
  assert.equal(reviewWithSupport(edited,suggested,true).filter(i=>i.objectId==='phone').length,1);
});

test('canvas review preserves roles without provenance and support stays within capacity',()=>{
  const scene={...createBlankScene(),objects:[{instanceId:'book',objectId:'book',role:'secondary',x:.5,y:.5,rotation:0}]};
  assert.equal(reviewFromScene(scene)[0].role,'secondary');
  const full=catalog.objects.slice(0,6).map(o=>({objectId:o.id,role:'main',origin:'manual',reason:'Выбор'}));
  const other={objectId:catalog.objects[6].id,role:'secondary',origin:'rules',reason:'Дополнение'};
  assert.equal(reviewWithSupport(full,[other],true).length,6);
});


test('import preserves scene geometry and custom SVG when optional selection history is unsupported',()=>{
  const original={...createBlankScene(),objects:[{instanceId:'saved-book',objectId:'book',role:'main',x:.3,y:.7,rotation:18}],selectionReview:{prompt:'Прежний выбор',items:[{objectId:'book',role:'main',origin:'unsupported',reason:'Ранее выбранный предмет.'}]}};
  const restored=readScene(original,catalog);
  assert.deepEqual(restored.objects,original.objects);
  assert.equal(restored.selectionReview,undefined);
  assert.ok(original.selectionReview,'import must not mutate the source');
  assert.throws(()=>readScene({...original,objects:[{...original.objects[0],objectId:'unknown'}]},catalog));
  const review={prompt:'Мой выбор',items:[{objectId:'book',role:'main',origin:'manual',reason:'Выбрано вручную.'}]};
  assert.deepEqual(readScene({...original,selectionReview:review},catalog).selectionReview,review);
  const extended={...review,metadata:{source:'retired'},items:review.items.map(item=>({...item,confidence:.9}))};
  assert.deepEqual(readScene({...original,selectionReview:extended},catalog).selectionReview,review,'only supported history fields are retained');
  const custom={id:'custom-saved',name:'Свой предмет',tags:[],meanings:[],svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10V10Z" fill="#ffffff"/></svg>'};
  const customScene={...original,customObjects:[custom],objects:[{...original.objects[0],objectId:custom.id}],selectionReview:{prompt:'Мой предмет',items:[{objectId:custom.id,role:'main',origin:'manual',reason:'Выбор'}]}};
  assert.deepEqual(readScene(customScene,catalog).selectionReview,customScene.selectionReview);
  const withoutHistory=readScene({...customScene,selectionReview:null},catalog);
  assert.deepEqual(withoutHistory.customObjects,[custom]);assert.deepEqual(withoutHistory.objects,customScene.objects);
});
