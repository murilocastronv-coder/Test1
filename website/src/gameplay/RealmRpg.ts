import Phaser from "phaser";
import type { LoadedMap } from "../pixellab/types";
import type { PlayerController } from "../player/PlayerController";
import { CharacterAgent } from "../npc/CharacterAgent";
import { WING_MASTER, MONSTERS } from "./WorldRoster";
import { CLASSIC_MONSTERS, type ClassicMonster } from "./ClassicMonsterRoster";
import { MonsterCombat } from "./MonsterCombat";
import { WING_CATALOG, wingCatalogHtml } from "./WingCatalog";
import { characterAtlasKey, characterManifest } from "../shared/animation";
import { nearestWalkable, findPath, type Point } from "../shared/navigation";
import { moveWithCollision } from "../shared/collision";
import { setYDepth } from "../shared/depth";
import { directionFromVector, vectorFromDirection } from "../shared/direction";
import type { Direction } from "../shared/direction";
import "./rpg.css";

import { WORLD_DESTINATIONS } from "./WorldDestinations";
import { HeroWings } from "./HeroWings";
import { HeroPowers, HERO_POWERS } from "./HeroPowers";
import { TouchMovement } from "./TouchMovement";
import { WeaponProjectiles } from "./WeaponProjectiles";
import { HEROES, heroPreview, type HeroClass } from "./HeroRoster";
interface Save { wingId?: string; wings: boolean; name: string; hero: HeroClass; level: number; xp: number; gold: number; kills: number; quest: number; weapon: number; armor: number; potions: number; points: number; strength: number; vitality: number; items: number; }
interface Mob { classic?: ClassicMonster; attackMs: number; strikeAt: number; struck: boolean; hurtMs: number; facing: Direction; agent: CharacterAgent; health: number; max: number; boss: boolean; home: Point; path: Point[]; repath: number; cooldown: number; dead: number; label: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics; hitRadius: number; sprite: Phaser.GameObjects.Sprite; hit: (x: number,y: number,strength: number) => boolean; }
const COLLIDER = { width: 8, height: 4, footOffsetY: 15 };
const SAVE_KEY = "aether-reborn-save-v1";
export class RealmRpg {
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  private modal: HTMLDivElement;
  private messages: string[] = [];
  private mobs: Mob[] = [];
  private home: Point;
  private save: Save = { wings: false, name: "Viajante", hero: "Cavaleiro", level: 1, xp: 0, gold: 0, kills: 0, quest: 0, weapon: 0, armor: 0, potions: 5, points: 0, strength: 0, vitality: 0, items: 0 };
  private selected: HeroClass = "Cavaleiro";
  private running: boolean = false;
  private health: number = 120;
  private mana: number = 80;
  private elapsed: number = 0;
  private renderMs: number = 0;
  private powers: HeroPowers;
  private powerMultiplier: number = 1;
  private weaponShots: WeaponProjectiles;
  private monsterCombat: MonsterCombat;
  private spellHit: boolean = false;
  private stored: boolean = false;
  private keyboard: Phaser.Input.Keyboard.KeyboardPlugin | null;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private touchMovement: TouchMovement;
  private wings: HeroWings;
  private heroLabel: Phaser.GameObjects.Text;
  private wingMaster!: CharacterAgent;
  private masterLabel!: Phaser.GameObjects.Text;
  private masterButton!: HTMLButtonElement;
  constructor(private scene: Phaser.Scene, private player: PlayerController, private map: LoadedMap) {
    this.weaponShots = new WeaponProjectiles(scene,map);
    this.monsterCombat=new MonsterCombat(scene,map);
    this.powers = new HeroPowers(scene);
    this.wings = new HeroWings(scene, player);
    this.touchMovement = new TouchMovement(player);
    this.touchMovement.setActive(false);
    this.home = { ...player.worldPosition };
    try { const data = JSON.parse(localStorage.getItem(SAVE_KEY) || "null") as Save | null; if (data && Number.isFinite(data.level) && data.level >= 1 && HEROES.some(hero => hero.name === data.hero)) { this.save = { ...this.save, ...data }; this.selected = data.hero; this.stored = true; } } catch { /* a new adventure remains available */ }
    this.root = document.createElement("div"); this.root.className = "rpg-ui";
    this.panel = document.createElement("div"); this.modal = document.createElement("div"); this.root.append(this.panel, this.modal); document.getElementById("hud-root")!.append(this.root);
    this.keyboard = scene.input.keyboard;
    for (const key of ["Q", "E", "I", "C", "B", "R", "ONE", "TWO", "THREE", "FOUR"]) if (this.keyboard) this.keys[key] = this.keyboard.addKey(key);
    this.heroLabel = scene.add.text(player.sprite.x, player.sprite.y - 40, "", { fontFamily: "Arial", fontSize: "9px", color: "#ead398", stroke: "#11171c", strokeThickness: 3 }).setOrigin(.5).setDepth(200000);
    this.createMobs(); this.createWingMaster(); this.startScreen(); this.render();
    const hooks = window as unknown as Record<string, unknown>;
    hooks.rpgState = () => ({ map: this.map.map.name, mapFolder: this.map.folder, destinations: WORLD_DESTINATIONS, attack: this.player.attackState, weaponProjectiles: {active:this.weaponShots.count,released:this.weaponShots.released,hits:this.weaponShots.hits}, powers: this.powers.state(this.save.hero,this.elapsed), started: this.running, modal: !!this.modal.innerHTML, ...this.save, wingsVisible: this.wings.visible, characterId: HEROES.find(h=>h.name===this.save.hero)?.id, texture: this.player.sprite.texture.key, frame: this.player.sprite.frame.name, scale: this.player.sprite.scaleX, displayHeight: this.player.sprite.displayHeight, facing: this.player.facing, safeZone:this.inSafeZone(this.player.worldPosition), safeCenter:this.home, safeRadius:64, health: Math.ceil(this.health), maxHealth: this.maxHealth, mana: Math.floor(this.mana), x: this.player.sprite.x, y: this.player.sprite.y, wingCount: WING_CATALOG.length, wingTexture: this.wings.texture, master: {x:this.wingMaster.sprite.x,y:this.wingMaster.sprite.y,near:this.nearMaster,frame:this.wingMaster.sprite.frame.name}, enemies: this.mobs.map((m,i) => ({ id:i, x:m.sprite.x, y:m.sprite.y, health:m.health, name:m.label.text, frame:m.sprite.frame.name, boss:m.boss, classic:!!m.classic, stats:m.classic, state:m.dead?"death":m.hurtMs>0?"hurt":m.attackMs>0?"attack":"move", attackMs:m.attackMs, strikeAt:m.strikeAt, struck:m.struck, respawnRemaining:m.dead, dead:m.dead > 0 })) });
    hooks.rpgReturnSafe=()=>{this.player.teleportTo(this.home.x,this.home.y);};
    hooks.rpgVisitMaster = () => { const p=nearestWalkable(this.map,{x:this.wingMaster.sprite.x,y:this.wingMaster.sprite.y+22},{width:6,height:4,footOffsetY:10},8);if(p)this.player.teleportTo(p.x,p.y); };
    hooks.rpgAction = (action: string) => this.action(action);
    hooks.rpgApproach = (id: number) => { const mob = this.mobs[id]; if (mob) { const p = nearestWalkable(this.map, {x:mob.sprite.x,y:mob.sprite.y+27}, {width:6,height:4,footOffsetY:10},8); if(p) this.player.teleportTo(p.x,p.y); } };
    this.root.addEventListener("click", (event) => { const filter = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-wing-filter]"); if(filter) { for(const card of this.modal.querySelectorAll<HTMLElement>("[data-wing-family]")) card.hidden = filter.dataset.wingFilter !== "Todas" && card.dataset.wingFamily !== filter.dataset.wingFilter; return; } const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]"); if (target) { this.action(target.dataset.action!); target.blur(); this.scene.game.canvas.focus(); } });
  }
  setMapData(map: LoadedMap): void {
    this.weaponShots.destroy(); this.weaponShots=new WeaponProjectiles(this.scene,map);
    this.monsterCombat.destroy();this.monsterCombat=new MonsterCombat(this.scene,map);
    for(const m of this.mobs){m.agent.destroy();m.label.destroy();m.bar.destroy();}
    this.mobs=[];this.wingMaster.destroy();this.masterLabel.destroy();this.masterButton.remove();
    this.map=map;this.home={...this.player.worldPosition};this.createMobs();this.createWingMaster();
    this.log(`Chegou em ${map.map.name}.`);this.render();
  }
  setTravelHandler(handler: (id: string) => Promise<void>): void { this.travelHandler=handler; }
  private travelHandler?: (id: string) => Promise<void>;
  private showMaps(): void {
    this.modal.dataset.view="maps";
    this.modal.innerHTML=`<div class="rpg-overlay"><section class="rpg-window"><button class="rpg-close" data-action="close">Fechar ×</button><div class="rpg-caption">VIAGEM LIVRE · 20 DESTINOS</div><h2>Mapas</h2><p>Escolha seu destino. Blood Castle e Devil Square: visita livre, sem regras de evento.</p><div class="rpg-map-grid">${WORLD_DESTINATIONS.map(d=>`<button data-action="travel:${d.id}" ${d.id===this.map.folder?"disabled":""}><strong>${d.name}</strong><small>${d.theme}${d.id===this.map.folder?" · Você está aqui":""}</small></button>`).join("")}</div></section></div>`;
  }
  get active(): boolean { return this.running && !this.modal.innerHTML; }
  get targets(): Mob[] { return this.active && !this.inSafeZone(this.player.worldPosition) ? this.mobs.filter(m => !m.dead) : []; }
  get maxHealth(): number { return 120 + (this.save.level-1)*18 + this.save.vitality*12 + (this.save.hero === "Cavaleiro" ? 30 : 0); }
  private get damage(): number { return 16 + this.save.level*3 + this.save.weapon*9 + this.save.strength*3 + (this.save.hero === "Cavaleiro" ? 6 : 0); }
  private inSafeZone(point: Point): boolean { return Math.hypot(point.x-this.home.x,point.y-this.home.y)<=64; }
  private receiveMonsterDamage(damage:number):void {
    if(!this.active||this.inSafeZone(this.player.worldPosition))return;
    const value=Math.max(2,damage-this.save.armor*3);this.health-=value;
    this.float(this.player.sprite.x,this.player.sprite.y-18,`−${value}`,"#fa8577");
    this.player.sprite.setTint(0xf89c99);this.scene.time.delayedCall(120,()=>this.player.sprite.clearTint());
    if(this.health<=0)this.defeat();
  }
  private updateClassicMob(m:Mob,delta:number):void {
    const kind=m.classic!;m.agent.update(delta);m.cooldown-=delta;m.repath-=delta;
    const safe=this.inSafeZone(this.player.worldPosition);
    const distance=Math.hypot(m.sprite.x-this.player.sprite.x,m.sprite.y-this.player.sprite.y);
    if(safe){m.attackMs=0;m.path=[];}
    if(m.hurtMs>0){m.hurtMs-=delta;}
    else if(m.attackMs>0){
      m.attackMs=Math.max(0,m.attackMs-delta);
      if(!m.struck&&m.attackMs<=m.strikeAt){
        m.struck=true;
        if(!safe&&!this.inSafeZone(m.sprite)){
          if(kind.ranged)this.monsterCombat.cast(m.sprite,m.facing,kind.damage);
          else if(distance<38){const v=vectorFromDirection(m.facing);const dx=this.player.sprite.x-m.sprite.x,dy=this.player.sprite.y-m.sprite.y;if(dx*v.x+dy*v.y>-3)this.receiveMonsterDamage(kind.damage);}
        }
      }
    }else if(!m.agent.stunned){
      const homeDistance=Math.hypot(m.sprite.x-m.home.x,m.sprite.y-m.home.y);
      const chasing=!safe&&distance<175&&homeDistance<245;
      const range=kind.ranged?110:28;
      if(chasing&&distance<=range&&m.cooldown<=0){
        m.facing=directionFromVector(this.player.sprite.x-m.sprite.x,this.player.sprite.y-m.sprite.y);
        m.attackMs=m.agent.playControlled("attack",m.facing,true);m.strikeAt=m.attackMs*.5;m.struck=false;m.cooldown=m.attackMs+850;m.path=[];
      }else{
        const target=chasing?(distance>range?this.player.worldPosition:null):homeDistance>12?m.home:null;
        if(target){
          if(m.repath<=0){m.path=findPath(this.map,m.sprite,target,COLLIDER)??[];m.repath=600;}
          while(m.path.length&&Math.hypot(m.sprite.x-m.path[0].x,m.sprite.y-m.path[0].y)<5)m.path.shift();
          const next=m.path[0];let moving=false;
          if(next){const dx=next.x-m.sprite.x,dy=next.y-m.sprite.y,len=Math.hypot(dx,dy),step=Math.min(len,delta*(chasing?.052:.027));
            const moved=moveWithCollision(this.map,m.sprite.x,m.sprite.y,dx/len*step,dy/len*step,COLLIDER);
            if(!this.inSafeZone(moved)){const ax=moved.x-m.sprite.x,ay=moved.y-m.sprite.y;if(Math.hypot(ax,ay)>.01){m.sprite.setPosition(moved.x,moved.y);m.facing=directionFromVector(ax,ay);m.agent.playControlled(chasing?"run":"walk",m.facing);moving=true;}}
          }
          if(!moving)m.agent.playControlled("idle",m.facing);
        }else{m.path=[];m.agent.playControlled("idle",m.facing);}
      }
    }
    setYDepth(m.sprite,m.sprite.y+15);m.label.setPosition(m.sprite.x,m.sprite.y-32);setYDepth(m.label,m.sprite.y+15,2);
    m.bar.clear().fillStyle(0x090c10,.9).fillRect(m.sprite.x-16,m.sprite.y-25,32,3).fillStyle(0xac503e).fillRect(m.sprite.x-16,m.sprite.y-25,32*m.health/m.max,3);setYDepth(m.bar,m.sprite.y+15,3);
  }
  private createMobs(): void {

    const mapName = WORLD_DESTINATIONS.find(d=>d.id===this.map.folder)?.name;
    const roster=CLASSIC_MONSTERS.filter(m=>m.map===mapName);
    if(roster.length) {
      const offsets=[[108,32],[160,90],[80,160],[-100,90]];
      roster.forEach((kind,i)=>{
        const [dx,dy]=offsets[i];
        const home=nearestWalkable(this.map,{x:this.home.x+dx,y:this.home.y+dy},COLLIDER,14);
        if(!home||this.inSafeZone(home)||!findPath(this.map,this.home,home,COLLIDER))return;
        const agent=new CharacterAgent(this.scene,this.map,{atlasKey:characterAtlasKey(kind.id),manifest:characterManifest(this.scene,kind.id),id:`classic-${kind.name}`,role:"monster",x:home.x,y:home.y,footOffsetY:10,roaming:false});
        agent.sprite.setScale(.5);
        const mob:Mob={classic:kind,attackMs:0,strikeAt:0,struck:false,hurtMs:0,facing:"south",agent,sprite:agent.sprite,home,health:kind.hp,max:kind.hp,boss:false,path:[],repath:0,cooldown:1200,dead:0,hitRadius:14,label:this.scene.add.text(home.x,home.y-32,`${kind.name} · Nv.${kind.level}`,{fontFamily:"Arial",fontSize:"8px",color:"#e0d5bd",stroke:"#101414",strokeThickness:3}).setOrigin(.5),bar:this.scene.add.graphics(),hit:(x,y,strength)=>this.hitMob(mob,x,y,strength)};
        this.mobs.push(mob);
      });
      return;
    }
    const offsets = [[70,60],[-65,100],[145,90],[-120,40],[100,175],[-100,190],[205,155]];
    offsets.forEach(([dx,dy],i) => {
      const home = nearestWalkable(this.map, {x:this.home.x+dx,y:this.home.y+dy}, COLLIDER,12); if (!home) return;
      const kind = MONSTERS[i % MONSTERS.length];
      const agent = new CharacterAgent(this.scene,this.map,{atlasKey:characterAtlasKey(kind.id),manifest:characterManifest(this.scene,kind.id),id:`rift-${i}`,role:"monster",x:home.x,y:home.y,footOffsetY:10,roaming:false,preferredClips:["walking-6-frames"]});
      const boss = i === offsets.length-1;
      agent.sprite.setScale(boss ? .6 : .5);
      const max = boss ? 240 : 60+i*8;
      const mob: Mob = { attackMs:0,strikeAt:0,struck:false,hurtMs:0,facing:"south",agent, sprite:agent.sprite, home, health:max, max, boss, path:[], repath:0, cooldown:1200, dead:0, hitRadius:boss?19:14, label:this.scene.add.text(home.x,home.y-32,boss?`${kind.name} · ELITE`:kind.name,{fontFamily:"Arial",fontSize:boss?"9px":"8px",color:boss?"#f7a6ba":"#e0d5bd",stroke:"#101414",strokeThickness:3}).setOrigin(.5), bar:this.scene.add.graphics(), hit:(x,y,strength) => this.hitMob(mob,x,y,strength) };
      this.mobs.push(mob);
    });
  }
  private get nearMaster(): boolean { return Phaser.Math.Distance.Between(this.player.sprite.x,this.player.sprite.y,this.wingMaster.sprite.x,this.wingMaster.sprite.y)<65; }
  private createWingMaster(): void {
    const p=nearestWalkable(this.map,{x:this.home.x-40,y:this.home.y-15},{width:6,height:4,footOffsetY:10},10) ?? this.home;
    this.wingMaster=new CharacterAgent(this.scene,this.map,{atlasKey:characterAtlasKey(WING_MASTER),manifest:characterManifest(this.scene,WING_MASTER),id:"wing-master",role:"wing-master",x:p.x,y:p.y,footOffsetY:10,roaming:false});
    this.wingMaster.sprite.setScale(.5);
    this.masterLabel=this.scene.add.text(p.x,p.y-27,"MESTRE DAS ASAS",{fontFamily:"Arial",fontSize:"8px",color:"#f4d78e",stroke:"#15151d",strokeThickness:3}).setOrigin(.5);setYDepth(this.masterLabel,p.y+10,2);
    this.masterButton=document.createElement("button");this.masterButton.dataset.action="master";this.masterButton.textContent="E · Conversar com Mestre das Asas";this.masterButton.style.cssText="position:absolute;left:50%;bottom:180px;transform:translateX(-50%);pointer-events:auto;padding:12px;border:1px solid #c8a56b;background:#171d29;color:#f4d78e;border-radius:8px;max-width:90%";this.masterButton.hidden=true;this.root.append(this.masterButton);
  }
  private hitMob(mob: Mob,x: number,y: number,strength: number): boolean {
    if (!this.active || this.inSafeZone(this.player.worldPosition) || this.inSafeZone(mob.sprite) || mob.dead || !mob.agent.hit(x,y,strength)) return false;
    const dmg = Math.max(1,Math.round((this.damage + (this.spellHit ? (this.save.hero === "Feiticeiro" ? 22 : 10) : 0))*this.powerMultiplier)-(mob.classic?.defense??0));
    mob.attackMs=0; mob.path=[];
    if(mob.classic)mob.hurtMs=mob.agent.playControlled("hurt",mob.facing,true);
    mob.health = Math.max(0,mob.health-dmg); this.float(mob.sprite.x,mob.sprite.y-18,`${dmg}`,"#f6d596");
    if (!mob.health) {
      mob.dead = mob.classic?.respawnMs ?? (mob.boss ? 22000 : 10000);
      mob.hurtMs=0;
      if(mob.classic){mob.sprite.clearTint();mob.agent.playControlled("death",mob.facing,true);}else mob.sprite.setVisible(false); mob.label.setVisible(false); mob.bar.clear();
      const xp = mob.classic?.exp ?? (mob.boss ? 120 : 35); const gold = mob.classic?.zen ?? (mob.boss ? 100 : 20);
      const drop=!mob.classic||Math.random()<mob.classic.dropChance;
      this.save.xp += xp; this.save.gold += gold; this.save.kills++; if(drop)this.save.items++;
      this.log(`${mob.boss?"Guardião derrotado":"Fera derrotada"} · +${xp} EXP · +${gold} ouro${drop?" · 1 fragmento":""}`);
      while(this.save.xp >= this.save.level*100) { this.save.xp -= this.save.level*100; this.save.level++; this.save.points += 5; this.health=this.maxHealth; this.mana=80; this.log(`NÍVEL ${this.save.level}! +5 pontos de atributos`); this.banner(`Nível ${this.save.level}`); }
      this.persist();
    }
    this.render(); return true;
  }
  slash(origin: Point,direction: Direction): void {
    if (!this.active) return;
    if (this.weaponRanged(origin,direction)) return;
    const vec = vectorFromDirection(direction);
    this.spellHit=false;
    this.targets.forEach(m => { const dx=m.sprite.x-origin.x,dy=m.sprite.y-origin.y; const forward=dx*vec.x+dy*vec.y; if(forward>=-8&&forward<52&&Math.abs(dx*vec.y-dy*vec.x)<29) m.hit(origin.x,origin.y,100); });
  }
  weaponRanged(origin: Point,direction: Direction): boolean {
    if(this.save.hero!=="Arqueiro"&&this.save.hero!=="Feiticeiro")return false;
    if(this.active)this.weaponShots.cast(origin,direction,this.save.hero==="Arqueiro"?"arrow":"magic");
    return true;
  }
  allowSpell(): boolean {
    if (!this.active || this.mana<9) { if(this.active) this.log("Mana insuficiente. Ela se regenera com o tempo."); return false; }
    this.mana-=9; return true;
  }
  update(delta: number): void {
    if (this.running) {
      for(const key of ["I","C","B"]) if(this.keys[key]&&Phaser.Input.Keyboard.JustDown(this.keys[key])) this.action(key);
      if(this.active) for(const key of ["Q","E","R"]) if(this.keys[key]&&Phaser.Input.Keyboard.JustDown(this.keys[key])) this.action(key);
    }
    if(this.active) ["ONE","TWO","THREE","FOUR"].forEach((key,i)=>{if(this.keys[key]&&Phaser.Input.Keyboard.JustDown(this.keys[key]))this.action(`power:${i}`);});
    if(this.active)this.weaponShots.update(delta,this.targets);
    this.touchMovement.setActive(this.active);
    this.wings.update(this.save.wings, this.running, this.save.wingId);
    this.masterButton.hidden = !this.running || !!this.modal.innerHTML || !this.nearMaster;
    if(this.active) this.wingMaster.update(delta);
    this.heroLabel.setPosition(this.player.sprite.x,this.player.sprite.y-24).setText(`${this.save.name} · Nv.${this.save.level}`);
    if (!this.active) return;
    this.monsterCombat.update(delta,this.player.worldPosition,p=>this.inSafeZone(p),damage=>this.receiveMonsterDamage(damage));
    if(!this.active)return;
    this.elapsed+=delta; this.mana=Math.min(80,this.mana+delta*.004); this.health=Math.min(this.maxHealth,this.health+delta*.0007);
    for(const m of this.mobs) {
      if(m.dead) { if(m.classic){m.agent.update(delta);if(m.dead<(m.classic.respawnMs-1200))m.sprite.setVisible(false);} m.dead-=delta; if(m.dead<=0) {m.dead=0;m.health=m.max;m.sprite.setPosition(m.home.x,m.home.y).setVisible(true);m.label.setVisible(true);m.path=[];m.attackMs=0;m.hurtMs=0;m.cooldown=1800;if(m.classic)m.agent.playControlled("idle",m.facing);} continue; }
      if(m.classic){this.updateClassicMob(m,delta);continue;}
      const beforeX=m.sprite.x,beforeY=m.sprite.y;
      m.agent.update(delta); m.cooldown-=delta; m.repath-=delta;
      const distance=Phaser.Math.Distance.Between(m.sprite.x,m.sprite.y,this.player.sprite.x,this.player.sprite.y);
      if(distance<105&&distance>24&&!m.agent.stunned&&Phaser.Math.Distance.Between(this.player.sprite.x,this.player.sprite.y,this.home.x,this.home.y)>64) {
        if(m.repath<=0) {m.path=findPath(this.map,{x:m.sprite.x,y:m.sprite.y},this.player.worldPosition,COLLIDER) ?? [];m.repath=700;}
        while(m.path.length&&Phaser.Math.Distance.Between(m.sprite.x,m.sprite.y,m.path[0].x,m.path[0].y)<6) m.path.shift();
        const target=m.path[0]; if(target) {const dx=target.x-m.sprite.x,dy=target.y-m.sprite.y,len=Math.hypot(dx,dy); const moved=moveWithCollision(this.map,m.sprite.x,m.sprite.y,dx/len*delta*.038,dy/len*delta*.038,COLLIDER);const actualX=moved.x-m.sprite.x,actualY=moved.y-m.sprite.y;m.sprite.setPosition(moved.x,moved.y); if(actualX||actualY) {const facing=directionFromVector(actualX,actualY);m.sprite.setData("facing",facing);m.agent.playControlled("walking-6-frames",facing);}}
      }
      if(Math.hypot(m.sprite.x-beforeX,m.sprite.y-beforeY)<.01&&!m.agent.stunned)m.agent.playControlled("breathing-idle",m.sprite.getData("facing") as Direction || "south");
      if(distance<31&&m.cooldown<=0&&Phaser.Math.Distance.Between(this.player.sprite.x,this.player.sprite.y,this.home.x,this.home.y)>64) {m.cooldown=m.boss?1300:1800;const dmg=Math.max(2,(m.boss?18:6)-this.save.armor*3);this.health-=dmg;this.float(this.player.sprite.x,this.player.sprite.y-18,`−${dmg}`,"#fa8577");this.player.sprite.setTint(0xf89c99);this.scene.time.delayedCall(120,()=>this.player.sprite.clearTint());if(this.health<=0){this.defeat();return;}}
      setYDepth(m.sprite,m.sprite.y+15);m.label.setPosition(m.sprite.x,m.sprite.y-32);setYDepth(m.label,m.sprite.y+15,2);m.bar.clear().fillStyle(0x090c10,.9).fillRect(m.sprite.x-16,m.sprite.y-25,32,3).fillStyle(m.boss?0xd284ab:0xac503e).fillRect(m.sprite.x-16,m.sprite.y-25,32*m.health/m.max,3);setYDepth(m.bar,m.sprite.y+15,3);
    }
    this.renderMs+=delta; if(this.renderMs>250){this.renderMs=0;this.render();}
  }
  private action(action: string): void {
    if(action.startsWith("class:")){const hero=HEROES.find(h=>h.name===action.slice(6));if(hero){this.selected=hero.name;this.startScreen();}return;}
    if(action==="start") {const input=this.modal.querySelector<HTMLInputElement>("input");this.save.hero=this.selected;if(!this.stored){this.save.name=(input?.value.trim()||"Viajante").slice(0,18);}this.player.setCharacter(HEROES.find(h=>h.name===this.save.hero)!.id);this.health=this.maxHealth;this.mana=80;this.running=true;this.modal.innerHTML="";this.log("Bem-vindo! Clique no chão para andar ou abra Mapas para viajar.");this.persist();this.render();return;}
    if(action==="heroes"){this.startScreen();return;}
    if(!this.running) return;
    if(action==="maps"){this.showMaps();return;}
    if(action.startsWith("travel:")){
      const id=action.slice(7);if(!WORLD_DESTINATIONS.some(d=>d.id===id)||!this.travelHandler)return;
      this.modal.innerHTML='<div class="rpg-overlay"><section class="rpg-window"><h2>Viajando…</h2></section></div>';
      void this.travelHandler(id).then(()=>{this.modal.innerHTML="";this.banner(this.map.map.name);}).catch((error:unknown)=>{this.showMaps();this.banner("Não foi possível viajar. Tente novamente.");console.error(error);});return;
    }
    if(action==="master"){if(this.nearMaster)this.showWindow("W");else this.banner("Aproxime-se do Mestre das Asas no refúgio.");return;}
    if(action==="catalog"){this.showWindow("W");return;}
    if(action.startsWith("equip-wing:")){const wing=WING_CATALOG.find(w=>w.id===action.slice(11));if(wing){this.save.wingId=wing.id;this.save.wings=true;this.persist();this.showWindow("W");}return;}
    if(action==="wings"){this.save.wings=!this.save.wings;this.persist();this.showWindow("I");return;}
    if(this.health<=0 && action!=="revive") return;
    if(action==="close"){this.modal.innerHTML="";return;}
    if(["I","C","B"].includes(action)){if(this.modal.dataset.view===action&&this.modal.innerHTML){this.modal.innerHTML="";return;}this.showWindow(action);return;}
    if(action==="revive"){this.health=this.maxHealth;this.mana=80;this.player.teleportTo(this.home.x,this.home.y);this.mobs.forEach(m=>{if(!m.dead)m.sprite.setPosition(m.home.x,m.home.y);m.path=[];m.cooldown=2000;});this.modal.innerHTML="";return;}
    if(!this.active && !["weapon","armor","buy","sell","strength","vitality"].includes(action))return;
    if(action==="Q"){if(this.save.potions&&this.health<this.maxHealth){this.save.potions--;this.health=Math.min(this.maxHealth,this.health+85);this.log("Poção utilizada · +85 vida");}}
    if(action==="R"){if(this.targets.some(m=>Phaser.Math.Distance.Between(m.sprite.x,m.sprite.y,this.player.sprite.x,this.player.sprite.y)<100)){this.log("Afaste-se dos monstros para retornar ao refúgio.");return;}this.player.teleportTo(this.home.x,this.home.y);this.health=this.maxHealth;this.mana=80;this.log("Refúgio: vida e mana recuperadas.");}
    if(action==="attack" && this.active){const range=this.save.hero==="Arqueiro"||this.save.hero==="Feiticeiro"?260:52;const near=this.targets.filter(m=>Phaser.Math.Distance.Between(m.sprite.x,m.sprite.y,this.player.sprite.x,this.player.sprite.y)<range).sort((a,b)=>Phaser.Math.Distance.Between(a.sprite.x,a.sprite.y,this.player.sprite.x,this.player.sprite.y)-Phaser.Math.Distance.Between(b.sprite.x,b.sprite.y,this.player.sprite.x,this.player.sprite.y))[0];this.player.performAttack(near?directionFromVector(near.sprite.x-this.player.sprite.x,near.sprite.y-this.player.sprite.y):this.player.facing);}
    if(action==="E") {if(this.nearMaster)this.action("master");else this.castPower(1);return;}
    if(action.startsWith("power:")){const slot=Number(action.slice(6));if(Number.isInteger(slot)&&slot>=0&&slot<4)this.castPower(slot);return;}
    if(action==="claim"){const required=(this.save.quest+1)*5;if(this.save.kills>=required){this.save.gold+=100;this.save.quest++;this.log("Contrato concluído · +100 ouro");this.banner("Contrato concluído");}}
    if(action==="weapon"||action==="armor"){const cost=80+(action==="weapon"?this.save.weapon:this.save.armor)*60;if(this.save.gold>=cost){this.save.gold-=cost;this.save[action]++;this.log(`${action==="weapon"?"Arma":"Armadura"} aprimorada para +${this.save[action]}`);}else this.log(`Você precisa de ${cost} ouro.`);this.showWindow("B");}
    if(action==="buy"){if(this.save.gold>=20){this.save.gold-=20;this.save.potions+=3;this.log("Compradas 3 poções.");}else this.log("Você precisa de 20 ouro.");this.showWindow("B");}
    if(action==="sell"){if(this.save.items){this.save.gold+=this.save.items*12;this.save.items=0;this.log("Fragmentos vendidos por 12 ouro cada.");}this.showWindow("I");}
    if(action==="strength"||action==="vitality"){if(this.save.points){this.save.points--;this.save[action]++;}this.showWindow("C");}
    this.persist();this.render();
  }
  private castPower(slot: number): void {
    if(!this.active)return;
    const power=HERO_POWERS[this.save.hero][slot];
    if(!this.powers.ready(slot,this.elapsed)){this.log(`${power.name}: aguarde a recarga.`);return;}
    if(this.mana<power.cost){this.log(`${power.name}: precisa de ${power.cost} mana.`);return;}
    this.mana-=power.cost;
    const hitTimes=new Map<Mob,number>();
    this.powers.cast(this.save.hero,slot,{...this.player.worldPosition},vectorFromDirection(this.player.facing),this.targets,this.elapsed,(point,radius,multiplier)=>{
      if(!this.active)return;
      this.powerMultiplier=multiplier;
      for(const mob of this.targets){if(Phaser.Math.Distance.Between(point.x,point.y,mob.sprite.x,mob.sprite.y)<=radius+mob.hitRadius && this.elapsed-(hitTimes.get(mob)??-10000)>=180){if(mob.hit(point.x,point.y,100))hitTimes.set(mob,this.elapsed);}}
      this.powerMultiplier=1;
    });
    this.log(power.name);this.render();
  }
  private defeat():void {this.health=0;this.modal.dataset.view="defeat";this.save.gold=Math.floor(this.save.gold*.95);this.persist();this.modal.innerHTML=`<div class="rpg-overlay"><div class="rpg-window"><div class="rpg-caption">A FENDA COBROU SEU PREÇO</div><h2>Você caiu em batalha</h2><p>Você perdeu 5% do ouro. Seu nível e seus equipamentos foram preservados.</p><button data-action="revive" class="rpg-primary">Renascer no refúgio</button></div></div>`;this.render();}
  private startScreen():void {
    this.modal.dataset.view="start";
    this.modal.innerHTML=`<div class="rpg-overlay"><section class="rpg-window"><div class="rpg-caption">CINCO HERÓIS • FANTASIA SOMBRIA</div><h2>AETHER REBORN</h2><p>Escolha seu personagem. ${this.stored?`Seu progresso de nível ${this.save.level} será preservado.`:"Forje seu herói e enfrente o Guardião da Fenda."}</p><div class="rpg-classes">${HEROES.map(hero=>`<button class="rpg-class ${this.selected===hero.name?"selected":""}" data-action="class:${hero.name}"><img class="rpg-hero-preview" src="${heroPreview(this.scene,hero)}" alt="${hero.name}"><b>${hero.name}</b><span>${hero.description}</span></button>`).join("")}</div>${this.stored?"":'<input aria-label="Nome do herói" maxlength="18" placeholder="Nome do herói" value="Viajante">'}<button data-action="start" class="rpg-primary">${this.stored?"Continuar jornada":"Entrar no mundo"} →</button><p style="font-size:10px;margin-bottom:0">WASD mover · J atacar · L magia · 1–4 poderes · E poder 2 · Q poção<br>30 asas disponíveis na mochila [I] ou com o Mestre [E]. Progresso salvo neste navegador.</p></section></div>`;
  }
  private showWindow(view:string):void {this.modal.dataset.view=view;const s=this.save;const item=(name:string,desc:string,action:string,label:string)=>`<div class="rpg-item"><strong>${name}</strong><span>${desc}</span><br><button data-action="${action}">${label}</button></div>`;let body="";
    if(view==="I")body=`<p>${s.gold} ouro · Equipamentos ativos abaixo</p><div class="rpg-items">${item(`Arma +${s.weapon}`,`${this.damage} dano efetivo`,"B","Aprimorar")}${item(`Armadura +${s.armor}`,`Reduz ${s.armor*3} dano`,"B","Aprimorar")}${item(`Poções ×${s.potions}`,"Recuperam 85 vida", "close","Voltar · Q para usar")}${item(`Fragmentos ×${s.items}`,"12 ouro por fragmento","sell","Vender todos")}${item("Asas equipáveis",s.wings?"Equipadas · cosméticas, sem voo":"Cosméticas · todas as cinco classes","wings",s.wings?"Retirar asas":"Equipar asas")}${item("Coleção de asas · 30 modelos","6 famílias × níveis 1 a 5","catalog","Abrir catálogo")}</div>`;
    if(view==="W")body=wingCatalogHtml(s.wingId,s.wings);
    if(view==="C")body=`<p>${s.hero} · Nível ${s.level} · ${s.xp}/${s.level*100} EXP<br>Vida máxima ${this.maxHealth} · Dano ${this.damage}<br><b>${s.points} pontos disponíveis</b></p><div class="rpg-items">${item(`Força ${s.strength}`,"+3 dano por ponto","strength","Adicionar +1")}${item(`Vitalidade ${s.vitality}`,"+12 vida por ponto","vitality","Adicionar +1")}${item("Cinco heróis","Troque a aparência sem perder seu progresso","heroes","Escolher herói")}</div>`;
    if(view==="B")body=`<p>Ferreiro do refúgio · ${s.gold} ouro<br>A loja pode ser acessada de qualquer lugar nesta versão.</p><div class="rpg-items">${item(`Arma +${s.weapon} → +${s.weapon+1}`,"+9 dano. Sucesso garantido.","weapon",`${80+s.weapon*60} ouro`)}${item(`Armadura +${s.armor} → +${s.armor+1}`,"−3 dano recebido.","armor",`${80+s.armor*60} ouro`)}${item("3 poções","Recupere a vida durante a caçada.","buy","20 ouro")}</div>`;
    this.modal.innerHTML=`<div class="rpg-overlay"><section class="rpg-window"><button class="rpg-close" data-action="close">Fechar ×</button><div class="rpg-caption">AETHER REBORN</div><h2>${view==="I"?"Inventário":view==="C"?"Personagem":view==="W"?"Mestre das Asas":"Ferreiro"}</h2>${body}<p style="font-size:10px">O combate fica pausado enquanto este painel estiver aberto.</p></section></div>`;}
  private render():void {const s=this.save;this.panel.innerHTML=`<header class="rpg-brand"><h1>AETHER</h1><small>R E B O R N</small></header><div class="rpg-region"><strong>${this.map.map.name.toUpperCase()}</strong><div>${this.inSafeZone(this.player.worldPosition)?"🛡 Zona segura":"⚔ Área de combate"}</div><div>Canal 01 · mundo compartilhado</div></div><nav class="rpg-menu"><button data-action="I">Mochila [I]</button><button data-action="C">Herói [C]</button><button data-action="B">Loja [B]</button></nav><div class="rpg-help">WASD · mover / Shift · correr<br>J · golpe / L · magia<br>1–4 · poderes exclusivos / E · mestre próximo / poder 2<br>R · retornar ao refúgio</div><div class="rpg-feed">${this.messages.map(m=>`<div>${m}</div>`).join("")}</div><footer class="rpg-bottom"><div class="rpg-orb"><b>${Math.max(0,Math.ceil(this.health))}</b><span>VIDA / ${this.maxHealth}</span></div><div class="rpg-bars"><div class="rpg-character-line"><span>Nv.${s.level} · ${s.hero}</span><span>${s.gold} OURO</span></div><div class="rpg-xp"><i style="width:${s.xp/(s.level*100)*100}%"></i></div><div class="rpg-powers">${this.powers.state(s.hero,this.elapsed).skills.map((p,i)=>`<button data-action="power:${i}" style="--power:#${HERO_POWERS[s.hero][i].color.toString(16).padStart(6,"0")}" title="${p.name} · ${p.cost} mana" ${p.remaining||this.mana<p.cost?"disabled":""}><em>${i+1}</em><span>${p.name}</span><small>${p.remaining?`${p.remaining}s`:`${p.cost} MP`}</small></button>`).join("")}</div><div class="rpg-actions"><button data-action="maps">🌍 Mapas</button><button data-action="attack"><em>J</em> Golpe</button><button data-action="Q"><em>Q</em> Poção ×${s.potions}</button></div></div><div class="rpg-orb mana"><b>${Math.floor(this.mana)}</b><span>MANA / 80</span></div></footer>`;if(s.hero==="Arqueiro"&&this.active)this.mana=Math.min(80,this.mana+.5);}
  private float(x:number,y:number,text:string,color:string):void {const label=this.scene.add.text(x,y,text,{fontFamily:"Arial",fontSize:"14px",fontStyle:"bold",color,stroke:"#121318",strokeThickness:3}).setOrigin(.5).setDepth(200000);this.scene.tweens.add({targets:label,y:y-26,alpha:0,duration:800,onComplete:()=>label.destroy()});}
  private banner(text:string):void {const el=document.createElement("div");el.className="rpg-toast";el.textContent=text;this.root.append(el);this.scene.time.delayedCall(2500,()=>el.remove());}
  private log(text:string):void {this.messages.unshift(text);this.messages=this.messages.slice(0,4);}
  private persist():void {try{localStorage.setItem(SAVE_KEY,JSON.stringify(this.save));}catch{/* Storage disabled by the browser. */}}
  destroy():void {this.monsterCombat.destroy();this.weaponShots.destroy();this.powers.destroy();this.touchMovement.destroy();this.wings.destroy();this.persist();this.root.remove();this.heroLabel.destroy();this.wingMaster.destroy();this.masterLabel.destroy();for(const m of this.mobs){m.agent.destroy();m.label.destroy();m.bar.destroy();}const hooks=window as unknown as Record<string,unknown>;delete hooks.rpgState;delete hooks.rpgAction;delete hooks.rpgApproach;delete hooks.rpgVisitMaster;}
}
