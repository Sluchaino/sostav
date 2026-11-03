import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { semanticDocuments, chooseSuggestion } from '../.build/editor/semantic.js';
import { editReview, confirmedSuggestion, validateSelectionReview, reviewFromScene, reviewWithSupport } from '../.build/editor/selection.js';
import { createBlankScene, validateScene, reduceHistory } from '../.build/editor/model.js';
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

test('archived model descriptions reproduce the frozen benchmark library and exclude SVG data',async()=>{
  const reference=JSON.parse(await readFile(new URL('../benchmarks/meaning/objects.json',import.meta.url),'utf8'));
  // The archived model experiment predates the expanded production tags.
  const frozenCatalog={...catalog,objects:catalog.objects.map(object=>({...object,tags:reference.find(item=>item.id===object.id)?.tags??object.tags}))};
  const documents=semanticDocuments(frozenCatalog);
  for(const object of reference.filter(o=>!o.custom)) assert.equal(documents.find(d=>d.id===object.id).text,`${object.name}. ${object.tags.join(', ')}. ${object.meanings.join(', ')}.`);
  assert.ok(!JSON.stringify(documents).includes('<svg'));
});

test('production suggestion threshold and margin reproduce frozen strict fallback decisions',async()=>{
  const run=JSON.parse(await readFile(new URL('../benchmarks/meaning/results/fallback.json',import.meta.url),'utf8'));
  for(const row of run.rows.filter(row=>!row.rules.selected.length)) {
    const allowed=row.scored.map(item=>item.id);
    const result=chooseSuggestion(row.scored,allowed,row.rules.excluded);
    assert.deepEqual(result?[result.objectId]:[],row.conservative.suggestion,row.case.prompt);
  }
  assert.equal(chooseSuggestion([{id:'book',score:NaN}],['book'],[]),null);
  assert.equal(chooseSuggestion([{id:'book',score:.9}],[],[]),null);
});

test('confirmed model selections persist, validate and assemble with undo as a single scene',()=>{
  const suggestion=confirmedSuggestion({objectId:'lamp',score:.6,margin:.15});
  const review={prompt:'Пролить свет на сложный вопрос',items:[{objectId:'lamp',role:'main',origin:'model-confirmed',reason:'Пользователь подтвердил предложение.'}],suggestion};
  const scene={...createBlankScene(),selectionReview:review,objects:[{instanceId:'theme-lamp',objectId:'lamp',role:'main',x:.5,y:.5,rotation:0}]};
  const restored=JSON.parse(JSON.stringify(scene)); validateScene(restored,catalog);
  const variants=generateLayouts(catalog,restored,{seed:0});
  assert.equal(variants.length,3); assert.deepEqual(variants[0].scene.selectionReview,review);
  const initial=createBlankScene();const h=reduceHistory({past:[],present:initial,future:[]},{type:'commit',value:variants[0].scene});
  assert.deepEqual(reduceHistory(h,{type:'undo'}).present,initial);
  assert.throws(()=>validateSelectionReview({...review,suggestion:{...suggestion,confirmed:false}},catalog));
  assert.throws(()=>validateSelectionReview({...review,suggestion:undefined},catalog));
  assert.throws(()=>validateSelectionReview({...review,suggestion:{...suggestion,score:.1}},catalog));
  assert.throws(()=>validateSelectionReview({...review,suggestion:{...suggestion,objectId:'book'}},catalog));
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
