import Phaser from "phaser";
import type { LoadedMap } from "../pixellab/types";
import { moveWithCollision } from "../shared/collision";
import { setYDepth } from "../shared/depth";
import { vectorFromDirection, type Direction } from "../shared/direction";
interface Bolt { graphic:Phaser.GameObjects.Graphics; x:number;y:number;vx:number;vy:number;age:number;damage:number; }
/** Enemy projectiles resolve on contact and are cancelled on entering sanctuary. */
export class MonsterCombat {
 private bolts:Bolt[]=[];
 released:number=0;
 hits:number=0;
 constructor(private scene:Phaser.Scene,private map:LoadedMap){}
 cast(origin:{x:number;y:number},direction:Direction,damage:number):void {
  const v=vectorFromDirection(direction),graphic=this.scene.add.graphics();
  graphic.fillStyle(0x7e37d9,.35).fillCircle(0,0,9).fillStyle(0xce88ff).fillCircle(0,0,4).fillStyle(0xf9e6ff).fillCircle(0,0,2);
  this.bolts.push({graphic,x:origin.x,y:origin.y,vx:v.x*130,vy:v.y*130,age:0,damage});this.released++;
 }
 update(delta:number,player:{x:number;y:number},safe:(p:{x:number;y:number})=>boolean,hit:(damage:number)=>void):void {
  for(let i=this.bolts.length-1;i>=0;i--){
   const b=this.bolts[i];b.age+=delta;let remove=b.age>1800||safe(player);
   const steps=Math.max(1,Math.ceil(delta/12));
   for(let step=0;step<steps&&!remove;step++){
    const moved=moveWithCollision(this.map,b.x,b.y,b.vx*delta/1000/steps,b.vy*delta/1000/steps,{width:2,height:2,footOffsetY:0});
    if(Math.hypot(moved.x-b.x,moved.y-b.y)<.01){remove=true;break;}
    b.x=moved.x;b.y=moved.y;
    if(safe(b)){remove=true;break;}
    if(Math.hypot(player.x-b.x,player.y-b.y)<12){hit(b.damage);this.hits++;remove=true;}
   }
   if(remove){b.graphic.destroy();this.bolts.splice(i,1);continue;}
   b.graphic.setPosition(b.x,b.y-7);setYDepth(b.graphic,b.y,6);
  }
 }
 destroy():void {for(const b of this.bolts)b.graphic.destroy();this.bolts=[];}
}
