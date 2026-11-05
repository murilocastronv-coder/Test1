import Phaser from "phaser";
import type { HeroClass } from "./HeroRoster";
import type { Point } from "../shared/navigation";

interface Power { name: string; cost: number; cooldown: number; color: number; kind: string; range: number; multiplier: number; }
export const HERO_POWERS: Record<HeroClass, readonly Power[]> = {
  Cavaleiro: [
    {name:"Corte Carmesim",cost:6,cooldown:1800,color:0xff4b54,kind:"slash",range:90,multiplier:1.4},
    {name:"Turbilhão de Aço",cost:10,cooldown:4200,color:0xffb463,kind:"whirl",range:85,multiplier:1.1},
    {name:"Ruptura da Terra",cost:14,cooldown:6000,color:0xff793a,kind:"quake",range:160,multiplier:2},
    {name:"Espadas do Julgamento",cost:20,cooldown:10000,color:0xffd37a,kind:"swords",range:110,multiplier:2.6},
  ],
  Feiticeiro: [
    {name:"Orbe Arcano",cost:6,cooldown:1800,color:0x64caff,kind:"orb",range:230,multiplier:1.5},
    {name:"Nova Glacial",cost:10,cooldown:4200,color:0xa5f4ff,kind:"frost",range:100,multiplier:1.8},
    {name:"Corrente de Raios",cost:14,cooldown:6000,color:0x9b99ff,kind:"lightning",range:210,multiplier:1.8},
    {name:"Chuva de Meteoros",cost:20,cooldown:10000,color:0xff8a45,kind:"meteors",range:110,multiplier:1.3},
  ],
  Arqueiro: [
    {name:"Disparo Esmeralda",cost:6,cooldown:1800,color:0x71ffad,kind:"arrow",range:250,multiplier:1.5},
    {name:"Leque de Flechas",cost:10,cooldown:4200,color:0xc4ff73,kind:"fan",range:210,multiplier:1.8},
    {name:"Raízes Selvagens",cost:14,cooldown:6000,color:0x55d16b,kind:"roots",range:95,multiplier:2},
    {name:"Fênix da Floresta",cost:20,cooldown:10000,color:0xffde7c,kind:"phoenix",range:230,multiplier:2.8},
  ],
  Gladiador: [
    {name:"Lâmina Violeta",cost:6,cooldown:1800,color:0xcb86ff,kind:"blade",range:180,multiplier:1.5},
    {name:"Cruz do Caos",cost:10,cooldown:4200,color:0xf29aff,kind:"cross",range:110,multiplier:1.8},
    {name:"Lanças Cristalinas",cost:14,cooldown:6000,color:0x9c7aff,kind:"crystals",range:160,multiplier:2.1},
    {name:"Vórtice Dimensional",cost:20,cooldown:10000,color:0xd2a4ff,kind:"vortex",range:110,multiplier:1.2},
  ],
  "Lorde Sombrio": [
    {name:"Garra das Sombras",cost:6,cooldown:1800,color:0xb87aff,kind:"claw",range:100,multiplier:1.5},
    {name:"Corvos da Ruína",cost:10,cooldown:4200,color:0xc5a1e8,kind:"ravens",range:220,multiplier:1},
    {name:"Correntes Malditas",cost:14,cooldown:6000,color:0xd1a754,kind:"chains",range:190,multiplier:2},
    {name:"Eclipse do Abismo",cost:20,cooldown:10000,color:0xeac765,kind:"eclipse",range:120,multiplier:3},
  ],
};
interface Target { sprite: Phaser.GameObjects.Sprite; }
type Hit = (point: Point, radius: number, multiplier: number) => void;
export class HeroPowers {
  private effects = new Set<Phaser.GameObjects.Graphics>();
  private timers = new Set<Phaser.Time.TimerEvent>();
  private readyAt: number[] = [0,0,0,0];
  private last: string = "";
  private casts: number = 0;
  constructor(private scene: Phaser.Scene) {}
  state(hero: HeroClass, now: number) { return {casts:this.casts,last:this.last,effects:this.effects.size,skills:HERO_POWERS[hero].map((p,i)=>({name:p.name,cost:p.cost,remaining:Math.max(0,Math.ceil((this.readyAt[i]-now)/1000))}))}; }
  ready(slot: number, now: number): boolean { return now >= this.readyAt[slot]; }
  private later(delay: number, fn: () => void): void { const timer=this.scene.time.delayedCall(delay,()=>{this.timers.delete(timer);fn();});this.timers.add(timer); }
  private animate(x: number,y: number,duration: number,draw:(g:Phaser.GameObjects.Graphics,t:number)=>void):void {
    const g=this.scene.add.graphics().setPosition(x,y).setDepth(190000);this.effects.add(g);
    const progress={t:0}; draw(g,0);
    this.scene.tweens.add({targets:progress,t:1,duration,onUpdate:()=>{g.clear();draw(g,progress.t);},onComplete:()=>{this.effects.delete(g);g.destroy();}});
  }
  private burst(p:Point,color:number,radius:number):void {
    this.animate(p.x,p.y,500,(g,t)=>{g.lineStyle(2,color,1-t);g.strokeCircle(0,0,8+t*radius);for(let i=0;i<12;i++){const a=i*Math.PI/6;g.fillStyle(i%2?color:0xffffff,1-t);g.fillRect(Math.cos(a)*t*radius,Math.sin(a)*t*radius,3,3);}});
  }
  cast(hero:HeroClass,slot:number,origin:Point,facing:Point,targets:readonly Target[],now:number,hit:Hit):void {
    const p=HERO_POWERS[hero][slot];this.readyAt[slot]=now+p.cooldown;this.last=p.name;this.casts++;
    const nearest=targets.filter(m=>Phaser.Math.Distance.Between(origin.x,origin.y,m.sprite.x,m.sprite.y)<p.range+60).sort((a,b)=>Phaser.Math.Distance.Between(origin.x,origin.y,a.sprite.x,a.sprite.y)-Phaser.Math.Distance.Between(origin.x,origin.y,b.sprite.x,b.sprite.y))[0];
    const raw=nearest?{x:nearest.sprite.x-origin.x,y:nearest.sprite.y-origin.y}:facing;
    const length=Math.hypot(raw.x,raw.y)||1;const dir={x:raw.x/length,y:raw.y/length};const angle=Math.atan2(dir.y,dir.x);
    const aim=nearest?{x:nearest.sprite.x,y:nearest.sprite.y}:{x:origin.x+dir.x*100,y:origin.y+dir.y*100};
    const impact=(point:Point,radius:number,mult=p.multiplier)=>{hit(point,radius,mult);this.burst(point,p.color,Math.min(radius,45));};
    // Every cast starts with a pulsing rune and casting sparks, without replacing the hero's idle/walk clips.
    this.animate(origin.x,origin.y,400,(g,t)=>{g.lineStyle(1,p.color,1-t);g.strokeEllipse(0,5,26+t*24,12+t*10);for(let i=0;i<6;i++){const a=i*Math.PI/3+t*4;g.fillStyle(p.color,1-t);g.fillRect(Math.cos(a)*18,Math.sin(a)*9-22*t,2,4);}});
    const lineHits=(distance:number,width:number,mult=p.multiplier)=>{const steps=Math.ceil(distance/18);for(let j=1;j<=steps;j++){const point={x:origin.x+dir.x*j*distance/steps,y:origin.y+dir.y*j*distance/steps};this.later(j*25,()=>hit(point,width,mult));}};
    // Moving missiles include a bright core, a fading trail, and a separate impact burst.
    const missile=(offset:number,kind:string,delay=0)=>{const a=angle+offset,d={x:Math.cos(a),y:Math.sin(a)};const travel=offset===0&&nearest?Math.min(length,p.range):p.range;
      this.later(delay,()=>{const struck=new Set<Target>();this.animate(origin.x,origin.y,650,(g,t)=>{const x=d.x*travel*t,y=d.y*travel*t;g.lineStyle(kind==="phoenix"?12:4,p.color,.45);g.lineBetween(x-d.x*30,y-d.y*30,x,y);g.lineStyle(1,0xffffff,.9);g.lineBetween(x-d.x*18,y-d.y*18,x,y);g.fillStyle(p.color,.9);
        if(kind==="orb") {g.fillCircle(x,y,7+Math.sin(t*25)*2);g.lineStyle(1,p.color,.5);g.strokeCircle(x,y,12);} else if(kind==="blade"){g.lineStyle(4,p.color,1);g.lineBetween(x-Math.cos(t*22)*16,y-Math.sin(t*22)*16,x+Math.cos(t*22)*16,y+Math.sin(t*22)*16);}else if(kind==="phoenix"){g.lineStyle(3,p.color,1);for(const side of [-1,1])g.lineBetween(x,y,x-d.x*18-d.y*side*(12+Math.sin(t*32)*10),y-d.y*18+d.x*side*(12+Math.sin(t*32)*10));}else{g.fillTriangle(x+d.x*7,y+d.y*7,x-d.x*6-d.y*4,y-d.y*6+d.x*4,x-d.x*6+d.y*4,y-d.y*6-d.x*4);}
        for(const target of targets){if(!struck.has(target)&&Phaser.Math.Distance.Between(target.sprite.x,target.sprite.y,origin.x+x,origin.y+y)<(kind==="phoenix"?30:18)){struck.add(target);impact({x:target.sprite.x,y:target.sprite.y},1);}}
      });this.later(650,()=>this.burst({x:origin.x+d.x*travel,y:origin.y+d.y*travel},p.color,20));});};
    switch(p.kind){
      case "orb": case "arrow": case "blade": case "phoenix": missile(0,p.kind);break;
      case "fan": for(const offset of [-.38,-.19,0,.19,.38])missile(offset,"arrow");break;
      case "slash": case "claw": {
        const count=p.kind==="claw"?3:1;
        for(let i=0;i<count;i++)this.later(i*80,()=>this.animate(origin.x,origin.y,350,(g,t)=>{g.lineStyle(5-i,p.color,1-t);g.beginPath();g.arc(0,0,20+t*65,angle-1.1+i*.25,angle+.7+i*.25);g.strokePath();g.lineStyle(1,0xffffff,1-t);g.beginPath();g.arc(0,0,24+t*65,angle-1.1,angle+.7);g.strokePath();}));
        this.later(160,()=>impact({x:origin.x+dir.x*45,y:origin.y+dir.y*45},48));break;}
      case "whirl": this.animate(origin.x,origin.y,900,(g,t)=>{for(let i=0;i<4;i++){const a=t*18+i*Math.PI/2;g.lineStyle(4,p.color,1-t*.8);g.beginPath();g.arc(0,0,35+t*45,a,a+1);g.strokePath();}});for(let i=0;i<3;i++)this.later(180+i*260,()=>hit(origin,85,p.multiplier));break;
      case "quake": for(let i=1;i<=6;i++){const point={x:origin.x+dir.x*i*25,y:origin.y+dir.y*i*25};this.later(i*90,()=>{this.animate(point.x,point.y,420,(g,t)=>{g.fillStyle(p.color,1-t);g.fillTriangle(-12,5,0,-30*(1-t),12,5);g.lineStyle(2,0xffdf9d,1-t);g.lineBetween(-15,8,15,-8);});impact(point,25);});}break;
      case "swords": for(let i=0;i<7;i++){const a=i*Math.PI*2/7;const point={x:origin.x+Math.cos(a)*65,y:origin.y+Math.sin(a)*65};this.later(i*85,()=>{this.animate(point.x,point.y,550,(g,t)=>{const y=-75*(1-Math.min(t*2,1));g.lineStyle(4,p.color,1-t*.8);g.lineBetween(0,y-22,0,y);g.lineBetween(-8,y-15,8,y-15);});this.later(260,()=>impact(point,40));});}break;
      case "frost": this.animate(origin.x,origin.y,850,(g,t)=>{g.lineStyle(3,p.color,1-t);g.strokeCircle(0,0,t*100);for(let i=0;i<12;i++){const a=i*Math.PI/6,r=t*95;g.lineBetween(Math.cos(a)*r*.7,Math.sin(a)*r*.7,Math.cos(a)*r,Math.sin(a)*r);g.fillStyle(0xeaffff,1-t);g.fillTriangle(Math.cos(a)*r-4,Math.sin(a)*r,Math.cos(a)*r,Math.sin(a)*r-14,Math.cos(a)*r+4,Math.sin(a)*r);}});this.later(350,()=>impact(origin,100));break;
      case "lightning": {let from=origin;const victims=targets.filter(m=>Phaser.Math.Distance.Between(origin.x,origin.y,m.sprite.x,m.sprite.y)<210).slice(0,5);const ends=victims.length?victims.map(m=>({x:m.sprite.x,y:m.sprite.y})):[aim];ends.forEach((end,i)=>{const start={...from};this.later(i*110,()=>{this.animate(start.x,start.y,420,(g,t)=>{g.lineStyle(4,p.color,1-t);g.beginPath();g.moveTo(0,0);for(let j=1;j<=10;j++)g.lineTo((end.x-start.x)*j/10+(j<10?Math.sin(j*9+t*45)*7:0),(end.y-start.y)*j/10);g.strokePath();});impact(end,20);});from=end;});break;}
      case "meteors": for(let i=0;i<6;i++){const a=i*2.4;const point={x:aim.x+Math.cos(a)*(i?48:0),y:aim.y+Math.sin(a)*(i?40:0)};this.later(i*160,()=>{this.animate(point.x,point.y,450,(g,t)=>{g.lineStyle(10,p.color,.65);g.lineBetween(-60*(1-t),-100*(1-t),-60*(1-t)-18,-100*(1-t)-30);g.fillStyle(0xfff3b3);g.fillCircle(-60*(1-t),-100*(1-t),7);g.lineStyle(1,p.color,.5);g.strokeEllipse(0,0,35,18);});this.later(450,()=>impact(point,45));});}break;
      case "roots": for(let i=0;i<8;i++){const a=i*Math.PI/4;this.animate(aim.x,aim.y,1100,(g,t)=>{const r=65*Math.min(1,t*3);g.lineStyle(3,p.color,1-t*.7);g.beginPath();g.moveTo(Math.cos(a)*r,Math.sin(a)*r);g.lineTo(Math.cos(a)*r*.6,Math.sin(a)*r*.6-25*Math.sin(t*Math.PI));g.lineTo(Math.cos(a)*r*.25,Math.sin(a)*r*.25);g.strokePath();});}this.later(350,()=>impact(aim,95));break;
      case "cross": this.animate(origin.x,origin.y,650,(g,t)=>{g.lineStyle(8,p.color,1-t);for(const a of [angle+Math.PI/4,angle-Math.PI/4])g.lineBetween(-Math.cos(a)*110*t,-Math.sin(a)*110*t,Math.cos(a)*110*t,Math.sin(a)*110*t);g.lineStyle(2,0xffffff,1-t);g.strokeCircle(0,0,t*60);});this.later(220,()=>impact(origin,110));break;
      case "crystals": for(let i=1;i<=5;i++)this.later(i*100,()=>{const point={x:origin.x+dir.x*i*30,y:origin.y+dir.y*i*30};this.animate(point.x,point.y,700,(g,t)=>{const h=Math.sin(t*Math.PI)*45;g.fillStyle(p.color,1-t*.7);g.fillTriangle(-12,2,0,-h,12,2);g.lineStyle(1,0xffffff,1-t);g.lineBetween(0,-h,4,0);});impact(point,30);});break;
      case "vortex": this.animate(aim.x,aim.y,1600,(g,t)=>{g.fillStyle(0x211333,(1-t)*.7);g.fillCircle(0,0,65);for(let i=0;i<40;i++){const a=i*.65+t*14,r=(i/40)*90*(1-t*.3);g.fillStyle(i%3?p.color:0xffffff,1-t*.8);g.fillRect(Math.cos(a)*r,Math.sin(a)*r*.6,3,3);}g.lineStyle(2,p.color,1-t);g.strokeEllipse(0,0,150,85);});for(let i=0;i<4;i++)this.later(250+i*300,()=>hit(aim,110,p.multiplier));break;
      case "ravens": for(let i=0;i<5;i++)this.later(i*130,()=>{this.animate(origin.x,origin.y,600,(g,t)=>{const x=(aim.x-origin.x)*t+Math.sin(t*Math.PI)*(i-2)*14,y=(aim.y-origin.y)*t-15;g.lineStyle(3,p.color,1-t*.5);const flap=Math.sin(t*36+i)*9;g.lineBetween(x-10,y+flap,x,y);g.lineBetween(x,y,x+10,y+flap);});this.later(600,()=>impact(aim,24));});break;
      case "chains": {const ends=targets.filter(m=>Phaser.Math.Distance.Between(origin.x,origin.y,m.sprite.x,m.sprite.y)<190).slice(0,5).map(m=>({x:m.sprite.x,y:m.sprite.y}));if(!ends.length)ends.push(aim);ends.forEach(end=>{this.animate(origin.x,origin.y,950,(g,t)=>{const reach=Math.min(t*4,1);g.lineStyle(2,p.color,1-t*.6);for(let i=0;i<12*reach;i++)g.strokeEllipse((end.x-origin.x)*i/12,(end.y-origin.y)*i/12,8,4);g.strokeCircle((end.x-origin.x)*reach,(end.y-origin.y)*reach,12+Math.sin(t*15)*4);});this.later(300,()=>impact(end,22));});break;}
      case "eclipse": this.animate(aim.x,aim.y,1500,(g,t)=>{const r=Math.sin(t*Math.PI)*65;g.fillStyle(0x110d22,.85*(1-t*.6));g.fillCircle(0,-20,r);g.lineStyle(3,p.color,1-t*.6);g.strokeCircle(0,-20,r);for(let i=0;i<16;i++){const a=i*Math.PI/8+t*2;g.lineBetween(Math.cos(a)*r,Math.sin(a)*r-20,Math.cos(a)*(r+14),Math.sin(a)*(r+14)-20);}g.strokeEllipse(0,0,120+t*100,65+t*40);});this.later(1000,()=>impact(aim,120));break;
    }
    // Line spells may intersect the same foe several times; combat de-duplicates hits per pulse.
    if(p.kind==="quake") lineHits(150,18,.4);
  }
  destroy():void {for(const timer of this.timers)timer.remove(false);this.timers.clear();for(const effect of this.effects){this.scene.tweens.killTweensOf(effect);effect.destroy();}this.effects.clear();}
}
