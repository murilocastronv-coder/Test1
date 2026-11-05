import Phaser from "phaser";
import type { LoadedMap } from "../pixellab/types";
import { isPositionClear } from "../shared/collision";
import { setYDepth } from "../shared/depth";
import { vectorFromDirection, type Direction } from "../shared/direction";

interface Target { sprite: {x:number;y:number}; hitRadius:number; hit(x:number,y:number,strength:number):boolean }
interface Shot { visual: Phaser.GameObjects.Graphics; x:number; y:number; vx:number; vy:number; age:number; kind:"arrow"|"magic" }
/** Weapon releases travel through the world; damage occurs on contact, not at launch. */
export class WeaponProjectiles {
  private shots: Shot[] = [];
  released: number = 0;
  hits: number = 0;
  constructor(private scene: Phaser.Scene, private map: LoadedMap) {}
  get count(): number { return this.shots.length; }
  cast(origin:{x:number;y:number}, direction:Direction, kind:"arrow"|"magic"):void {
    const v=vectorFromDirection(direction);
    const visual=this.scene.add.graphics();
    if(kind==="arrow") {
      visual.lineStyle(2,0xd4ba82).lineBetween(-11,0,7,0);
      visual.fillStyle(0xe7fff1).fillTriangle(12,0,5,-3,5,3);
      visual.lineStyle(1,0x72d6a2).lineBetween(-9,0,-13,-4).lineBetween(-9,0,-13,4);
    } else {
      visual.fillStyle(0x567dff,.25).fillCircle(0,0,9);
      visual.fillStyle(0x8fe9ff,.8).fillCircle(0,0,5);
      visual.fillStyle(0xf3ffff).fillCircle(0,0,2);
    }
    const x=origin.x+v.x*12,y=origin.y+v.y*12;
    visual.setPosition(x,y-7).setRotation(Math.atan2(v.y,v.x));
    this.shots.push({visual,x,y,vx:v.x*260,vy:v.y*260,age:0,kind});this.released++;
  }
  update(delta:number, targets:Target[]):void {
    for(let i=this.shots.length-1;i>=0;i--){
      const s=this.shots[i];s.age+=delta;
      let remove=s.age>1100;
      // Small steps prevent fast arrows passing through a monster or a wall.
      const steps=Math.max(1,Math.ceil(delta/12));
      for(let step=0;step<steps&&!remove;step++){
        s.x+=s.vx*delta/1000/steps;s.y+=s.vy*delta/1000/steps;
        if(!isPositionClear(this.map,s.x,s.y,{width:2,height:2,footOffsetY:0})){remove=true;break;}
        for(const t of targets)if(Math.hypot(t.sprite.x-s.x,t.sprite.y-s.y)<t.hitRadius+4&&t.hit(s.x-s.vx*.03,s.y-s.vy*.03,100)){this.hits++;remove=true;break;}
      }
      if(remove){s.visual.destroy();this.shots.splice(i,1);continue;}
      s.visual.setPosition(s.x,s.y-7);setYDepth(s.visual,s.y,6);
      if(s.kind==="magic")s.visual.setScale(1+Math.sin(s.age*.04)*.12);
    }
  }
  destroy():void {for(const s of this.shots)s.visual.destroy();this.shots=[];}
}
