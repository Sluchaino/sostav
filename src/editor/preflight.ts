import type { Catalog } from '../library/types.js';
import { selectObject } from '../library/index.js';
import { readCustomSvg } from '../library/custom.js';
import { canvasSize, compositionScale, type Scene } from './model.js';

export interface PreflightIssue {
  id: string;
  code: 'outside' | 'overlap' | 'original-colors' | 'empty';
  level: 'warning' | 'info';
  title: string;
  message: string;
  instanceIds: string[];
  objectId?: string;
  colors?: string[];
  overlap?: number;
}
interface Point { x: number; y: number }
const cross = (a: Point, b: Point, p: Point) => (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
function area(points: Point[]) {
  return Math.abs(points.reduce((sum, p, i) => { const next = points[(i+1)%points.length]!; return sum + p.x*next.y-next.x*p.y; }, 0))/2;
}
/** Convex clipping avoids treating the empty corners of a rotated bounding box as overlap. */
function clip(subject: Point[], boundary: Point[]): Point[] {
  let output = subject;
  for (let i=0; i<boundary.length && output.length; i++) {
    const a=boundary[i]!, b=boundary[(i+1)%boundary.length]!;
    const input=output; output=[];
    let previous=input.at(-1)!;
    for (const current of input) {
      const before=cross(a,b,previous), after=cross(a,b,current);
      const previousInside=before>=-1e-8, currentInside=after>=-1e-8;
      if (previousInside !== currentInside) {
        const t=before/(before-after);
        output.push({x:previous.x+t*(current.x-previous.x),y:previous.y+t*(current.y-previous.y)});
      }
      if (currentInside) output.push(current);
      previous=current;
    }
  }
  return output;
}

export function inspectComposition(catalog: Catalog, scene: Scene): PreflightIssue[] {
  const {width,height}=canvasSize(catalog,scene), scale=compositionScale(catalog,scene);
  const canvas=[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
  const issues: PreflightIssue[]=[];
  if (!scene.objects.length) issues.push({id:'empty',code:'empty',level:'info',title:'На холсте нет предметов',message:scene.backgroundVisible?'В SVG будет только фон.':'SVG будет пустым и прозрачным.',instanceIds:[]});
  const frames=scene.objects.map((object,index)=>{
    const asset=selectObject(catalog,object.objectId,scene.size,object.role);
    const w=asset.width*scale,h=asset.height*scale,angle=object.rotation*Math.PI/180;
    const points=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>({x:object.x*width+x!*Math.cos(angle)-y!*Math.sin(angle),y:object.y*height+x!*Math.sin(angle)+y!*Math.cos(angle)}));
    const name=catalog.objects.find(item=>item.id===object.objectId)!.name;
    const label=`«${name}», слой ${index+1}`;
    const sides=[points.some(p=>p.x<-.5)?'слева':'',points.some(p=>p.x>width+.5)?'справа':'',points.some(p=>p.y<-.5)?'сверху':'',points.some(p=>p.y>height+.5)?'снизу':''].filter(Boolean);
    if(sides.length) issues.push({id:'outside-'+object.instanceId,code:'outside',level:'warning',title:`${label}: выход за холст`,message:`Рамка выходит ${sides.join(', ')}. Часть предмета может быть обрезана. Проверьте координаты, поворот или общий масштаб.`,instanceIds:[object.instanceId]});
    return {object,points,visible:clip(points,canvas),area:w*h,label};
  });
  for(let i=0;i<frames.length;i++) for(let j=i+1;j<frames.length;j++) {
    const first=frames[i]!,second=frames[j]!;
    const overlap=area(clip(first.visible,second.points))/Math.min(first.area,second.area);
    if(overlap>.28+1e-9) issues.push({id:`overlap-${first.object.instanceId}-${second.object.instanceId}`,code:'overlap',level:'warning',title:'Сильное перекрытие предметов',message:`${first.label} и ${second.label}: пересекается примерно ${Math.round(overlap*100)}% меньшей рамки. Второй предмет находится выше в слоях. Проверьте расположение.`,instanceIds:[first.object.instanceId,second.object.instanceId],overlap});
  }
  const checked=new Set<string>();
  for(const object of scene.objects) {
    const definition=catalog.objects.find(item=>item.id===object.objectId)!;
    if(!definition.custom || checked.has(definition.id)) continue;
    checked.add(definition.id);
    const used=scene.objects.filter(item=>item.objectId===definition.id);
    const original=[...new Set(used.flatMap(item=>{
      const asset=selectObject(catalog,item.objectId,scene.size,item.role);
      return asset.colors.filter(color=>!Object.hasOwn(asset.paintRoles,color));
    }))];
    const source=scene.customObjects?.find(item=>item.id===definition.id);
    const unsupported=source?readCustomSvg(source.svg).unsupportedPaints:[];
    if(original.length || unsupported.length) issues.push({id:'colors-'+definition.id,code:'original-colors',level:'info',title:`«${definition.name}»: есть исходные цвета`,message:`${original.length?`Без назначения роли: ${original.length}. Эти цвета не меняются вместе с палитрой. `:''}${unsupported.length?`Не поддерживаются для перекраски: ${unsupported.slice(0,5).join(', ')}${unsupported.length>5?'…':''}. `:''}Если исходные цвета подходят, менять их не нужно.`,instanceIds:scene.objects.filter(item=>item.objectId===definition.id).map(item=>item.instanceId),objectId:definition.id,colors:original});
  }
  return issues;
}
