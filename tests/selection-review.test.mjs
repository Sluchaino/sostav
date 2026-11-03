import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { semanticDocuments, chooseSuggestion } from '../.build/editor/semantic.js';
import { editReview, confirmedSuggestion, validateSelectionReview } from '../.build/editor/selection.js';
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
