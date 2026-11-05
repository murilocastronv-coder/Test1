import Phaser from "phaser";
import type { LoadedMap } from "../pixellab/types";
import type { PlayerController } from "../player/PlayerController";
import { CharacterAgent } from "../npc/CharacterAgent";
import { BEAR_CHARACTER_ID } from "../pixellab/templateAssetPaths";
import { characterAtlasKey, characterManifest } from "../shared/animation";
import { nearestWalkable, findPath, type Point } from "../shared/navigation";
import { moveWithCollision } from "../shared/collision";
import { setYDepth } from "../shared/depth";
import { directionFromVector, vectorFromDirection } from "../shared/direction";
import type { Direction } from "../shared/direction";
import "./rpg.css";

import { HeroWings } from "./HeroWings";
import { HEROES, heroPreview, type HeroClass } from "./HeroRoster";
interface Save { wings: boolean; name: string; hero: HeroClass; level: number; xp: number; gold: number; kills: number; quest: number; weapon: number; armor: number; potions: number; points: number; strength: number; vitality: number; items: number; }
interface Mob { agent: CharacterAgent; health: number; max: number; boss: boolean; home: Point; path: Point[]; repath: number; cooldown: number; dead: number; label: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics; hitRadius: number; sprite: Phaser.GameObjects.Sprite; hit: (x: number,y: number,strength: number) => boolean; }
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
  private skillAt: number = -10000;
  private attackAt: number = -10000;
  private spellHit: boolean = false;
  private stored: boolean = false;
  private keyboard: Phaser.Input.Keyboard.KeyboardPlugin | null;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private wings: HeroWings;
  private heroLabel: Phaser.GameObjects.Text;
  constructor(private scene: Phaser.Scene, private player: PlayerController, private map: LoadedMap) {
    this.wings = new HeroWings(scene, player);
    this.home = { ...player.worldPosition };
    try { const data = JSON.parse(localStorage.getItem(SAVE_KEY) || "null") as Save | null; if (data && Number.isFinite(data.level) && data.level >= 1 && HEROES.some(hero => hero.name === data.hero)) { this.save = { ...this.save, ...data }; this.selected = data.hero; this.stored = true; } } catch { /* a new adventure remains available */ }
    this.root = document.createElement("div"); this.root.className = "rpg-ui";
    this.panel = document.createElement("div"); this.modal = document.createElement("div"); this.root.append(this.panel, this.modal); document.getElementById("hud-root")!.append(this.root);
    this.keyboard = scene.input.keyboard;
    for (const key of ["Q", "E", "I", "C", "B", "R"]) if (this.keyboard) this.keys[key] = this.keyboard.addKey(key);
    this.heroLabel = scene.add.text(player.sprite.x, player.sprite.y - 40, "", { fontFamily: "Arial", fontSize: "9px", color: "#ead398", stroke: "#11171c", strokeThickness: 3 }).setOrigin(.5).setDepth(200000);
    this.createMobs(); this.startScreen(); this.render();
    const hooks = window as unknown as Record<string, unknown>;
    hooks.rpgState = () => ({ started: this.running, modal: !!this.modal.innerHTML, ...this.save, wingsVisible: this.wings.visible, characterId: HEROES.find(h=>h.name===this.save.hero)?.id, texture: this.player.sprite.texture.key, frame: this.player.sprite.frame.name, health: Math.ceil(this.health), maxHealth: this.maxHealth, mana: Math.floor(this.mana), x: this.player.sprite.x, y: this.player.sprite.y, enemies: this.mobs.map((m,i) => ({ id:i, x:m.sprite.x, y:m.sprite.y, health:m.health, boss:m.boss, dead:m.dead > 0 })) });
    hooks.rpgAction = (action: string) => this.action(action);
    hooks.rpgApproach = (id: number) => { const mob = this.mobs[id]; if (mob) { const p = nearestWalkable(this.map, {x:mob.sprite.x,y:mob.sprite.y+27}, {width:6,height:4,footOffsetY:10},8); if(p) this.player.teleportTo(p.x,p.y); } };
    this.root.addEventListener("click", (event) => { const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]"); if (target) { this.action(target.dataset.action!); target.blur(); this.scene.game.canvas.focus(); } });
  }
  get active(): boolean { return this.running && !this.modal.innerHTML; }
  get targets(): Mob[] { return this.active ? this.mobs.filter(m => !m.dead) : []; }
  get maxHealth(): number { return 120 + (this.save.level-1)*18 + this.save.vitality*12 + (this.save.hero === "Cavaleiro" ? 30 : 0); }
  private get damage(): number { return 16 + this.save.level*3 + this.save.weapon*9 + this.save.strength*3 + (this.save.hero === "Cavaleiro" ? 6 : 0); }
  private createMobs(): void {
    const manifest = characterManifest(this.scene, BEAR_CHARACTER_ID);
    const offsets = [[70,60],[-65,100],[145,90],[-120,40],[100,175],[-100,190],[205,155]];
    offsets.forEach(([dx,dy],i) => {
      const home = nearestWalkable(this.map, {x:this.home.x+dx,y:this.home.y+dy}, COLLIDER,12); if (!home) return;
      const agent = new CharacterAgent(this.scene,this.map,{atlasKey:characterAtlasKey(BEAR_CHARACTER_ID),manifest,id:`rift-${i}`,role:"monster",x:home.x,y:home.y,footOffsetY:15,roaming:false,preferredClips:["walk"]});
      const boss = i === offsets.length-1;
      agent.sprite.setTint(boss ? 0xcf849e : 0xb7c5aa); if (boss) agent.sprite.setScale(1.25);
      const max = boss ? 240 : 60+i*8;
      const mob: Mob = { agent, sprite:agent.sprite, home, health:max, max, boss, path:[], repath:0, cooldown:1200, dead:0, hitRadius:boss?19:14, label:this.scene.add.text(home.x,home.y-32,boss?"GUARDIÃO DA FENDA · ELITE":"Fera corrompida",{fontFamily:"Arial",fontSize:boss?"9px":"8px",color:boss?"#f7a6ba":"#e0d5bd",stroke:"#101414",strokeThickness:3}).setOrigin(.5), bar:this.scene.add.graphics(), hit:(x,y,strength) => this.hitMob(mob,x,y,strength) };
      this.mobs.push(mob);
    });
  }
  private hitMob(mob: Mob,x: number,y: number,strength: number): boolean {
    if (!this.active || mob.dead || !mob.agent.hit(x,y,strength)) return false;
    const dmg = this.damage + (this.spellHit ? (this.save.hero === "Feiticeiro" ? 22 : 10) : 0);
    mob.health = Math.max(0,mob.health-dmg); this.float(mob.sprite.x,mob.sprite.y-18,`${dmg}`,"#f6d596");
    if (!mob.health) {
      mob.dead = mob.boss ? 22000 : 10000; mob.sprite.setVisible(false); mob.label.setVisible(false); mob.bar.clear();
      const xp = mob.boss ? 120 : 35; const gold = mob.boss ? 100 : 20;
      this.save.xp += xp; this.save.gold += gold; this.save.kills++; this.save.items++;
      this.log(`${mob.boss?"Guardião derrotado":"Fera derrotada"} · +${xp} EXP · +${gold} ouro · 1 fragmento`);
      while(this.save.xp >= this.save.level*100) { this.save.xp -= this.save.level*100; this.save.level++; this.save.points += 5; this.health=this.maxHealth; this.mana=80; this.log(`NÍVEL ${this.save.level}! +5 pontos de atributos`); this.banner(`Nível ${this.save.level}`); }
      this.persist();
    }
    this.render(); return true;
  }
  slash(origin: Point,direction: Direction): void {
    if (!this.active) return;
    const vec = vectorFromDirection(direction);
    this.spellHit=false;
    this.targets.forEach(m => { const dx=m.sprite.x-origin.x,dy=m.sprite.y-origin.y; const forward=dx*vec.x+dy*vec.y; if(forward>=-8&&forward<52&&Math.abs(dx*vec.y-dy*vec.x)<29) m.hit(origin.x,origin.y,100); });
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
    this.wings.update(this.save.wings, this.running);
    this.heroLabel.setPosition(this.player.sprite.x,this.player.sprite.y-40).setText(`${this.save.name} · Nv.${this.save.level}`);
    if (!this.active) return;
    this.elapsed+=delta; this.mana=Math.min(80,this.mana+delta*.004); this.health=Math.min(this.maxHealth,this.health+delta*.0007);
    for(const m of this.mobs) {
      if(m.dead) { m.dead-=delta; if(m.dead<=0) {m.dead=0;m.health=m.max;m.sprite.setPosition(m.home.x,m.home.y).setVisible(true);m.label.setVisible(true);m.path=[];} continue; }
      m.agent.update(delta); m.cooldown-=delta; m.repath-=delta;
      const distance=Phaser.Math.Distance.Between(m.sprite.x,m.sprite.y,this.player.sprite.x,this.player.sprite.y);
      if(distance<105&&distance>24&&!m.agent.stunned&&Phaser.Math.Distance.Between(this.player.sprite.x,this.player.sprite.y,this.home.x,this.home.y)>42) {
        if(m.repath<=0) {m.path=findPath(this.map,{x:m.sprite.x,y:m.sprite.y},this.player.worldPosition,COLLIDER) ?? [];m.repath=700;}
        while(m.path.length&&Phaser.Math.Distance.Between(m.sprite.x,m.sprite.y,m.path[0].x,m.path[0].y)<6) m.path.shift();
        const target=m.path[0]; if(target) {const dx=target.x-m.sprite.x,dy=target.y-m.sprite.y,len=Math.hypot(dx,dy); const moved=moveWithCollision(this.map,m.sprite.x,m.sprite.y,dx/len*delta*.038,dy/len*delta*.038,COLLIDER);const actualX=moved.x-m.sprite.x,actualY=moved.y-m.sprite.y;m.sprite.setPosition(moved.x,moved.y); if(actualX||actualY) m.agent.setDirection(directionFromVector(actualX,actualY));}
      }
      if(distance<31&&m.cooldown<=0&&Phaser.Math.Distance.Between(this.player.sprite.x,this.player.sprite.y,this.home.x,this.home.y)>42) {m.cooldown=m.boss?1300:1800;const dmg=Math.max(2,(m.boss?18:6)-this.save.armor*3);this.health-=dmg;this.float(this.player.sprite.x,this.player.sprite.y-18,`−${dmg}`,"#fa8577");this.player.sprite.setTint(0xf89c99);this.scene.time.delayedCall(120,()=>this.player.sprite.clearTint());if(this.health<=0){this.defeat();return;}}
      setYDepth(m.sprite,m.sprite.y+15);m.label.setPosition(m.sprite.x,m.sprite.y-32);setYDepth(m.label,m.sprite.y+15,2);m.bar.clear().fillStyle(0x090c10,.9).fillRect(m.sprite.x-16,m.sprite.y-25,32,3).fillStyle(m.boss?0xd284ab:0xac503e).fillRect(m.sprite.x-16,m.sprite.y-25,32*m.health/m.max,3);setYDepth(m.bar,m.sprite.y+15,3);
    }
    this.renderMs+=delta; if(this.renderMs>250){this.renderMs=0;this.render();}
  }
  private action(action: string): void {
    if(action.startsWith("class:")){const hero=HEROES.find(h=>h.name===action.slice(6));if(hero){this.selected=hero.name;this.startScreen();}return;}
    if(action==="start") {const input=this.modal.querySelector<HTMLInputElement>("input");this.save.hero=this.selected;if(!this.stored){this.save.name=(input?.value.trim()||"Viajante").slice(0,18);}this.player.setCharacter(HEROES.find(h=>h.name===this.save.hero)!.id);this.health=this.maxHealth;this.mana=80;this.running=true;this.modal.innerHTML="";this.log("Bem-vindo ao Vale das Cinzas. Elimine as feras próximas.");this.persist();this.render();return;}
    if(action==="heroes"){this.startScreen();return;}
    if(!this.running) return;
    if(action==="wings"){this.save.wings=!this.save.wings;this.persist();this.showWindow("I");return;}
    if(this.health<=0 && action!=="revive") return;
    if(action==="close"){this.modal.innerHTML="";return;}
    if(["I","C","B"].includes(action)){if(this.modal.dataset.view===action&&this.modal.innerHTML){this.modal.innerHTML="";return;}this.showWindow(action);return;}
    if(action==="revive"){this.health=this.maxHealth;this.mana=80;this.player.teleportTo(this.home.x,this.home.y);this.mobs.forEach(m=>{if(!m.dead)m.sprite.setPosition(m.home.x,m.home.y);m.path=[];m.cooldown=2000;});this.modal.innerHTML="";return;}
    if(!this.active && !["weapon","armor","buy","sell","strength","vitality"].includes(action))return;
    if(action==="Q"){if(this.save.potions&&this.health<this.maxHealth){this.save.potions--;this.health=Math.min(this.maxHealth,this.health+85);this.log("Poção utilizada · +85 vida");}}
    if(action==="R"){if(this.targets.some(m=>Phaser.Math.Distance.Between(m.sprite.x,m.sprite.y,this.player.sprite.x,this.player.sprite.y)<100)){this.log("Afaste-se dos monstros para retornar ao refúgio.");return;}this.player.teleportTo(this.home.x,this.home.y);this.health=this.maxHealth;this.mana=80;this.log("Refúgio: vida e mana recuperadas.");}
    if(action==="attack" && this.active && this.elapsed-this.attackAt>500){this.attackAt=this.elapsed;const near=this.targets.filter(m=>Phaser.Math.Distance.Between(m.sprite.x,m.sprite.y,this.player.sprite.x,this.player.sprite.y)<52).sort((a,b)=>Phaser.Math.Distance.Between(a.sprite.x,a.sprite.y,this.player.sprite.x,this.player.sprite.y)-Phaser.Math.Distance.Between(b.sprite.x,b.sprite.y,this.player.sprite.x,this.player.sprite.y))[0];this.slash(this.player.worldPosition,near?directionFromVector(near.sprite.x-this.player.sprite.x,near.sprite.y-this.player.sprite.y):this.player.facing);}
    if(action==="E"){if(this.mana<24||this.elapsed-this.skillAt<5000){this.log("Nova devastação: 24 mana e 5s de recarga.");return;}this.mana-=24;this.skillAt=this.elapsed;this.spellHit=true;const pos=this.player.worldPosition;const ring=this.scene.add.circle(pos.x,pos.y,10,0xbba0f8,.1).setStrokeStyle(2,0xd8c1ff).setDepth(200000);this.scene.tweens.add({targets:ring,radius:100,alpha:0,duration:450,onComplete:()=>ring.destroy()});this.targets.filter(m=>Phaser.Math.Distance.Between(m.sprite.x,m.sprite.y,pos.x,pos.y)<100).forEach(m=>m.hit(pos.x,pos.y,120));this.spellHit=false;}
    if(action==="claim"){const required=(this.save.quest+1)*5;if(this.save.kills>=required){this.save.gold+=100;this.save.quest++;this.log("Contrato concluído · +100 ouro");this.banner("Contrato concluído");}}
    if(action==="weapon"||action==="armor"){const cost=80+(action==="weapon"?this.save.weapon:this.save.armor)*60;if(this.save.gold>=cost){this.save.gold-=cost;this.save[action]++;this.log(`${action==="weapon"?"Arma":"Armadura"} aprimorada para +${this.save[action]}`);}else this.log(`Você precisa de ${cost} ouro.`);this.showWindow("B");}
    if(action==="buy"){if(this.save.gold>=20){this.save.gold-=20;this.save.potions+=3;this.log("Compradas 3 poções.");}else this.log("Você precisa de 20 ouro.");this.showWindow("B");}
    if(action==="sell"){if(this.save.items){this.save.gold+=this.save.items*12;this.save.items=0;this.log("Fragmentos vendidos por 12 ouro cada.");}this.showWindow("I");}
    if(action==="strength"||action==="vitality"){if(this.save.points){this.save.points--;this.save[action]++;}this.showWindow("C");}
    this.persist();this.render();
  }
  private defeat():void {this.health=0;this.modal.dataset.view="defeat";this.save.gold=Math.floor(this.save.gold*.95);this.persist();this.modal.innerHTML=`<div class="rpg-overlay"><div class="rpg-window"><div class="rpg-caption">A FENDA COBROU SEU PREÇO</div><h2>Você caiu em batalha</h2><p>Você perdeu 5% do ouro. Seu nível e seus equipamentos foram preservados.</p><button data-action="revive" class="rpg-primary">Renascer no refúgio</button></div></div>`;this.render();}
  private startScreen():void {
    this.modal.dataset.view="start";
    this.modal.innerHTML=`<div class="rpg-overlay"><section class="rpg-window"><div class="rpg-caption">CINCO HERÓIS • FANTASIA SOMBRIA</div><h2>AETHER REBORN</h2><p>Escolha seu personagem. ${this.stored?`Seu progresso de nível ${this.save.level} será preservado.`:"Forje seu herói e enfrente o Guardião da Fenda."}</p><div class="rpg-classes">${HEROES.map(hero=>`<button class="rpg-class ${this.selected===hero.name?"selected":""}" data-action="class:${hero.name}"><img class="rpg-hero-preview" src="${heroPreview(this.scene,hero)}" alt="${hero.name}"><b>${hero.name}</b><span>${hero.description}</span></button>`).join("")}</div>${this.stored?"":'<input aria-label="Nome do herói" maxlength="18" placeholder="Nome do herói" value="Viajante">'}<button data-action="start" class="rpg-primary">${this.stored?"Continuar jornada":"Entrar no mundo"} →</button><p style="font-size:10px;margin-bottom:0">WASD mover · J atacar · L magia · E devastação · Q poção<br>Asas douradas disponíveis na mochila [I]. Progresso salvo neste navegador.</p></section></div>`;
  }
  private showWindow(view:string):void {this.modal.dataset.view=view;const s=this.save;const item=(name:string,desc:string,action:string,label:string)=>`<div class="rpg-item"><strong>${name}</strong><span>${desc}</span><br><button data-action="${action}">${label}</button></div>`;let body="";
    if(view==="I")body=`<p>${s.gold} ouro · Equipamentos ativos abaixo</p><div class="rpg-items">${item(`Arma +${s.weapon}`,`${this.damage} dano efetivo`,"B","Aprimorar")}${item(`Armadura +${s.armor}`,`Reduz ${s.armor*3} dano`,"B","Aprimorar")}${item(`Poções ×${s.potions}`,"Recuperam 85 vida", "close","Voltar · Q para usar")}${item(`Fragmentos ×${s.items}`,"12 ouro por fragmento","sell","Vender todos")}${item("Asas Angelicais Douradas",s.wings?"Equipadas · aparência cosmética":"Disponíveis · aparência cosmética","wings",s.wings?"Retirar asas":"Equipar asas")}</div>`;
    if(view==="C")body=`<p>${s.hero} · Nível ${s.level} · ${s.xp}/${s.level*100} EXP<br>Vida máxima ${this.maxHealth} · Dano ${this.damage}<br><b>${s.points} pontos disponíveis</b></p><div class="rpg-items">${item(`Força ${s.strength}`,"+3 dano por ponto","strength","Adicionar +1")}${item(`Vitalidade ${s.vitality}`,"+12 vida por ponto","vitality","Adicionar +1")}${item("Cinco heróis","Troque a aparência sem perder seu progresso","heroes","Escolher herói")}</div>`;
    if(view==="B")body=`<p>Ferreiro do refúgio · ${s.gold} ouro<br>A loja pode ser acessada de qualquer lugar nesta versão.</p><div class="rpg-items">${item(`Arma +${s.weapon} → +${s.weapon+1}`,"+9 dano. Sucesso garantido.","weapon",`${80+s.weapon*60} ouro`)}${item(`Armadura +${s.armor} → +${s.armor+1}`,"−3 dano recebido.","armor",`${80+s.armor*60} ouro`)}${item("3 poções","Recupere a vida durante a caçada.","buy","20 ouro")}</div>`;
    this.modal.innerHTML=`<div class="rpg-overlay"><section class="rpg-window"><button class="rpg-close" data-action="close">Fechar ×</button><div class="rpg-caption">AETHER REBORN</div><h2>${view==="I"?"Inventário":view==="C"?"Personagem":"Ferreiro"}</h2>${body}<p style="font-size:10px">O combate fica pausado enquanto este painel estiver aberto.</p></section></div>`;}
  private render():void {const s=this.save;this.panel.innerHTML=`<header class="rpg-brand"><h1>AETHER</h1><small>R E B O R N</small></header><div class="rpg-region"><strong>VALE DAS CINZAS</strong><div>Canal 01 · mundo compartilhado</div></div><nav class="rpg-menu"><button data-action="I">Mochila [I]</button><button data-action="C">Herói [C]</button><button data-action="B">Loja [B]</button></nav><div class="rpg-help">WASD · mover / Shift · correr<br>J · golpe / L · magia<br>R · retornar ao refúgio</div><aside class="rpg-quest"><div class="rpg-caption">CONTRATO ${s.quest+1}</div><strong>O despertar das feras</strong><p>Derrote criaturas corrompidas.<br>${Math.min(s.kills,(s.quest+1)*5)} / ${(s.quest+1)*5} eliminadas<br><span style="color:#d6b975">Recompensa: 100 ouro</span></p><button data-action="claim" ${s.kills<(s.quest+1)*5?"disabled":""}>Receber recompensa</button><p class="rpg-boss">Elite: Guardião da Fenda<br>Avance com equipamentos melhores.</p></aside><div class="rpg-feed">${this.messages.map(m=>`<div>${m}</div>`).join("")}</div><footer class="rpg-bottom"><div class="rpg-orb"><b>${Math.max(0,Math.ceil(this.health))}</b><span>VIDA / ${this.maxHealth}</span></div><div class="rpg-bars"><div class="rpg-character-line"><span>Nv.${s.level} · ${s.hero}</span><span>${s.gold} OURO</span></div><div class="rpg-xp"><i style="width:${s.xp/(s.level*100)*100}%"></i></div><div class="rpg-actions"><button data-action="attack"><em>J</em> Golpe</button><button data-action="E"><em>E</em> Devastação</button><button data-action="Q"><em>Q</em> Poção ×${s.potions}</button></div></div><div class="rpg-orb mana"><b>${Math.floor(this.mana)}</b><span>MANA / 80</span></div></footer>`;if(s.hero==="Arqueiro"&&this.active)this.mana=Math.min(80,this.mana+.5);}
  private float(x:number,y:number,text:string,color:string):void {const label=this.scene.add.text(x,y,text,{fontFamily:"Arial",fontSize:"14px",fontStyle:"bold",color,stroke:"#121318",strokeThickness:3}).setOrigin(.5).setDepth(200000);this.scene.tweens.add({targets:label,y:y-26,alpha:0,duration:800,onComplete:()=>label.destroy()});}
  private banner(text:string):void {const el=document.createElement("div");el.className="rpg-toast";el.textContent=text;this.root.append(el);this.scene.time.delayedCall(2500,()=>el.remove());}
  private log(text:string):void {this.messages.unshift(text);this.messages=this.messages.slice(0,4);}
  private persist():void {try{localStorage.setItem(SAVE_KEY,JSON.stringify(this.save));}catch{/* Storage disabled by the browser. */}}
  destroy():void {this.wings.destroy();this.persist();this.root.remove();this.heroLabel.destroy();for(const m of this.mobs){m.agent.destroy();m.label.destroy();m.bar.destroy();}const hooks=window as unknown as Record<string,unknown>;delete hooks.rpgState;delete hooks.rpgAction;delete hooks.rpgApproach;}
}
