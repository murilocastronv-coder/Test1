import Phaser from 'phaser';
import type { LoadedMap } from '../pixellab/types';
import type { PlayerController } from '../player/PlayerController';
import { insideTown, townName, SAFE_POLYGON, TOWN_SIZE, townProps } from './TownLayout';
import { WORLD_DESTINATIONS } from './WorldDestinations';
import { isPositionClear } from '../shared/collision';
interface Portal {x:number;y:number;name:string;id:string}
/** DOM minimap and proximity portals. All travel uses the existing map loader. */
export class TownExplorer {
 private root:HTMLDivElement;private canvas:HTMLCanvasElement;private caption:HTMLDivElement;private button:HTMLButtonElement;
 private portals:Portal[]=[];private labels:Phaser.GameObjects.Text[]=[];private last:number=0;
 constructor(private scene:Phaser.Scene,private player:PlayerController,private map:LoadedMap,private active:()=>boolean,private travel:(id:string)=>void){
  this.root=document.createElement('div');this.root.className='town-minimap';
  this.canvas=document.createElement('canvas');this.canvas.width=180;this.canvas.height=160;this.caption=document.createElement('div');this.button=document.createElement('button');this.button.type='button';this.button.hidden=true;
  this.root.append(this.canvas,this.caption,this.button);document.getElementById('hud-root')!.append(this.root);
  this.button.onclick=()=>{const p=this.nearest();if(p&&this.active())this.travel(p.id);};
  this.setMap(map);
  const hooks=window as unknown as Record<string,unknown>;
  hooks.townState=()=>({name:townName(this.map.folder),safe:insideTown(this.player.worldPosition),polygon:SAFE_POLYGON,props:townName(this.map.folder)?townProps(townName(this.map.folder)!).length:0,portals:this.portals,clear:isPositionClear(this.map,this.player.sprite.x,this.player.sprite.y,{width:6,height:4,footOffsetY:10})});
  hooks.townVisit=(x:number,y:number)=>this.player.teleportTo(x,y);
  hooks.townEnterPortal=(index:number)=>{const p=this.portals[index];if(p)this.player.teleportTo(p.x,p.y+20);};
 }
 setMap(map:LoadedMap):void {
  this.map=map;for(const l of this.labels)l.destroy();this.labels=[];
  const name=townName(map.folder);this.root.hidden=!name;
  const names=name==='Lorencia'?['Dungeon 1','Noria','Devias']:name==='Noria'?['Lorencia','Devias','Devil Square']:['Lost Tower 1','Lorencia','Blood Castle'];
  const spots=[{x:1152,y:688},{x:1664,y:1024},{x:640,y:1024}];
  this.portals=name?names.map((n,i)=>({...spots[i],name:n,id:WORLD_DESTINATIONS.find(d=>d.name===n)!.id})):[];
  for(const p of this.portals)this.labels.push(this.scene.add.text(p.x,p.y+8,'→ '+p.name,{fontSize:'10px',color:'#9be8ff',stroke:'#101b28',strokeThickness:3}).setOrigin(.5).setDepth(p.y+9));
 }
 private nearest():Portal|undefined{return this.portals.find(p=>Math.hypot(p.x-this.player.sprite.x,p.y-this.player.sprite.y)<72);}
 update():void {
  if(!townName(this.map.folder))return;
  this.root.hidden=!this.active();const near=this.nearest();this.button.hidden=!near;if(near)this.button.textContent='Entrar: '+near.name;
  if(this.scene.time.now-this.last<150)return;this.last=this.scene.time.now;
  const ctx=this.canvas.getContext('2d');if(!ctx)return;
  const sx=180/TOWN_SIZE.width,sy=160/TOWN_SIZE.height;const name=townName(this.map.folder)!;
  ctx.fillStyle=name==='Devias'?'#426377':name==='Noria'?'#123d2e':'#333d27';ctx.fillRect(0,0,180,160);
  ctx.fillStyle='#998b6855';ctx.fillRect(88,0,5,160);ctx.fillRect(0,78,180,5);
  ctx.beginPath();SAFE_POLYGON.forEach((p,i)=>{if(i===0)ctx.moveTo(p.x*sx,p.y*sy);else ctx.lineTo(p.x*sx,p.y*sy);});ctx.closePath();ctx.fillStyle='#62bd9028';ctx.fill();ctx.strokeStyle='#8fd7ad';ctx.lineWidth=1;ctx.stroke();
  ctx.fillStyle='#d7c9a2';for(const p of townProps(name)){if(p.kind.includes('casa'))ctx.fillRect(p.x*sx-3,p.y*sy-3,6,4);}
  ctx.fillStyle='#7bddff';for(const p of this.portals)ctx.fillRect(p.x*sx-2,p.y*sy-2,4,4);
  ctx.fillStyle='#ffda73';ctx.beginPath();ctx.arc(this.player.sprite.x*sx,this.player.sprite.y*sy,3,0,Math.PI*2);ctx.fill();
  this.caption.textContent=`${name} · ${Math.round(this.player.sprite.x/16)}, ${Math.round(this.player.sprite.y/16)} · ${insideTown(this.player.worldPosition)?'Segura':'Combate'}`;
 }
 destroy():void{this.root.remove();for(const l of this.labels)l.destroy();const hooks=window as unknown as Record<string,unknown>;delete hooks.townState;delete hooks.townVisit;delete hooks.townEnterPortal;}
}
