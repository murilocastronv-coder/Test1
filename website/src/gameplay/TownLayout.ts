import { WORLD_DESTINATIONS } from './WorldDestinations';
export interface TownPoint {x:number;y:number}
export interface TownProp extends TownPoint { kind:string }
export const TOWN_SIZE = {width:2304,height:2048};
export const TOWN_CENTER = {x:1152,y:1024};
export const SAFE_POLYGON:TownPoint[]=[{x:800,y:736},{x:1504,y:736},{x:1568,y:800},{x:1568,y:1216},{x:1504,y:1312},{x:800,y:1312},{x:736,y:1216},{x:736,y:800}];
export function townName(folder:string):string|undefined{return WORLD_DESTINATIONS.slice(0,3).find(d=>d.id===folder)?.name;}
export function insideTown(point:TownPoint):boolean {let inside=false;for(let i=0,j=SAFE_POLYGON.length-1;i<SAFE_POLYGON.length;j=i++){const a=SAFE_POLYGON[i],b=SAFE_POLYGON[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
export function townProps(name:string):TownProp[]{
 const prefix=name==='Lorencia'?'lor':name==='Noria'?'nor':'dev';const out:TownProp[]=[];
 for(const y of [1000,1240])for(const x of [872,1000,1304,1432])out.push({kind:prefix+'_casa',x,y});
 if(name==='Lorencia'){
  for(const x of [760,888,1016,1288,1416,1544])for(const y of [736,1352])out.push({kind:'lor_muralha',x,y});
  out.push({kind:'lor_fonte',x:1152,y:1000});
  for(const x of [808,1496])for(const y of [950,1120])out.push({kind:'lor_barris',x,y});
  for(const x of [1080,1224])for(const y of [816,1248])out.push({kind:'lor_poste',x,y});
 }
 const tree=name==='Noria'?'nor_arvore':name==='Devias'?'dev_pinheiro':'lor_muralha';
 for(let y=208;y<=1856;y+=160)for(let x=176;x<=2128;x+=176){if(x>650&&x<1650&&y>620&&y<1430)continue;if(Math.abs(x-1152)<115||Math.abs(y-1024)<105)continue;if((x/176+Math.round(y/160))%3===0)continue;out.push({kind:tree,x,y});}
 if(name==='Noria'){for(const x of [704,1600])out.push({kind:'nor_ponte',x,y:1024});for(const x of [820,1000,1300,1480])out.push({kind:'nor_cogumelos',x,y:1100});}
 if(name==='Devias')out.push({kind:'dev_caverna',x:1872,y:400});
 out.push({kind:'portal',x:1152,y:688},{kind:'portal',x:1664,y:1024},{kind:'portal',x:640,y:1024});return out;
}
export function monsterHomes(index:number):TownPoint[]{const corners=[{x:1736,y:1480},{x:536,y:1480},{x:536,y:520},{x:1768,y:520}];const p=corners[index%4];return [p,{x:p.x+96,y:p.y+96},{x:p.x-96,y:p.y+64}];}
