import { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, CheckCheck, Download, Info, X } from 'lucide-react';
import type { Catalog } from '../library/types.js';
import type { Scene } from '../editor/model.js';
import { canvasSize } from '../editor/model.js';
import { inspectComposition } from '../editor/preflight.js';

export function PreflightDialog({catalog,scene,onClose,onExport,onSelect,onColors}:{catalog:Catalog;scene:Scene;onClose:()=>void;onExport:()=>void;onSelect:(id:string)=>void;onColors:(id:string)=>void}) {
  const dialog=useRef<HTMLElement>(null);
  const issues=useMemo(()=>inspectComposition(catalog,scene),[catalog,scene]);
  const warnings=issues.filter(item=>item.level==='warning').length;
  const {width,height}=canvasSize(catalog,scene);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.focus();
    return ()=>{previous?.focus();};
  },[]);
  const name=(id:string)=>{
    const index=scene.objects.findIndex(item=>item.instanceId===id),object=scene.objects[index]!;
    return `${catalog.objects.find(item=>item.id===object.objectId)!.name} · слой ${index+1}`;
  };
  return <div className="modal-backdrop" onClick={onClose}><section className="preflight-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="preflight-title" onClick={event=>event.stopPropagation()} onKeyDown={event=>{
    if(event.key==='Escape'){event.stopPropagation();onClose();}
    if(event.key==='Tab'){
      const controls=Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled)'));
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }}>
    <header><div><span className="eyebrow">ПЕРЕД СКАЧИВАНИЕМ</span><h2 id="preflight-title">Проверка композиции</h2><p>{scene.name} · {width} × {height} · SVG</p></div><button className="icon-button" aria-label="Закрыть проверку" onClick={onClose}><X size={19}/></button></header>
    <div className="preflight-body">
      <div className={`preflight-summary ${warnings?'has-warnings':'clear'}`}>{warnings?<AlertTriangle size={23}/>:<CheckCheck size={23}/>}<div><strong>{warnings?`Стоит проверить: ${warnings}`:issues.length?'Геометрических замечаний нет':'Замечаний не найдено'}</strong><p>{issues.length?'Выберите предмет, чтобы исправить его. Замечания не блокируют скачивание.':'Рамки предметов внутри холста, сильных перекрытий и неназначенных цветов не найдено.'}</p></div></div>
      <p className="preflight-note">Границы и перекрытия оцениваем по повёрнутым рамкам SVG. Прозрачные поля и форму контуров проверка не учитывает. Умеренное наложение может быть частью композиции.</p>
      <div className="preflight-issues">{issues.map(issue=><article className={`preflight-issue ${issue.level}`} key={issue.id}>
        <div className="preflight-issue-title">{issue.level==='warning'?<AlertTriangle size={16}/>:<Info size={16}/>}<h3>{issue.title}</h3></div><p>{issue.message}</p>
        {!!issue.colors?.length&&<div className="preflight-colors">{issue.colors.slice(0,12).map(color=><span key={color}><i style={{backgroundColor:color}}/>{color}</span>)}{issue.colors.length>12&&<span>Ещё {issue.colors.length-12}</span>}</div>}
        <div className="preflight-actions">{issue.instanceIds.map(id=><button className="button secondary" key={id} onClick={()=>onSelect(id)}>Выбрать: {name(id)}</button>)}{issue.objectId&&<button className="button secondary" onClick={()=>onColors(issue.objectId!)}>Настроить цвета</button>}</div>
      </article>)}</div>
    </div>
    <footer><button className="button secondary" onClick={onClose}>Вернуться в редактор</button><button className="button primary" onClick={onExport}><Download size={16}/>{issues.length?'Скачать без исправлений':'Скачать SVG'}</button></footer>
  </section></div>;
}
