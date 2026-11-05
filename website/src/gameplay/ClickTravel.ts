import Phaser from "phaser";
import type { PlayerController } from "../player/PlayerController";
import type { LoadedMap } from "../pixellab/types";
import { findPath, type Point } from "../shared/navigation";

/** A click selects a walkable route; keyboard movement takes priority. */
export class ClickTravel {
  private path: Point[] = [];
  private controlled: boolean = false;
  constructor(private scene: Phaser.Scene, private player: PlayerController, private map: LoadedMap, private active: () => boolean) {
    scene.input.on("pointerdown", this.click);
    scene.events.once("shutdown", () => scene.input.off("pointerdown", this.click));
    (window as unknown as Record<string, unknown>).walkTo = (x: number, y: number) => this.route(x,y);
  }
  private route(x: number,y: number): void {
    if (!this.active()) return;
    this.path = findPath(this.map,this.player.worldPosition,{x,y},{width:6,height:4,footOffsetY:10}) ?? [];
  }
  private click = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.button !== 0) return;
    const p = this.scene.cameras.main.getWorldPoint(pointer.x,pointer.y);
    this.route(p.x,p.y);
  };
  setMap(map: LoadedMap): void { this.map=map;this.path=[];this.player.setTouchMovement(0,0); }
  update(): void {
    const keyboard = this.scene.input.keyboard;
    const manual = ["W","A","S","D","UP","DOWN","LEFT","RIGHT"].some(k => keyboard?.addKey(k).isDown);
    if (!this.active() || manual) this.path=[];
    const p=this.player.worldPosition;
    while(this.path.length && Math.hypot(this.path[0].x-p.x,this.path[0].y-p.y)<5)this.path.shift();
    const next=this.path[0];
    if(next) {this.player.setTouchMovement(next.x-p.x,next.y-p.y);this.controlled=true;}
    else if(this.controlled){this.player.setTouchMovement(0,0);this.controlled=false;}
  }
}
