import Phaser from 'phaser';
import type { LoadedMap, Rectangle } from '../pixellab/types';
import { buildRectSpatialIndex } from '../pixellab/spatialIndex';
import { assetUrl } from '../pixellab/templateAssetPaths';
import { townName, townProps, type TownProp } from './TownLayout';
const ASSETS:Record<string,string>={lor_casa:'3a762cc5-ffe9-4714-91ba-58e137dd8d04',lor_muralha:'509f0444-d448-46cb-ac5c-a884df5b5153',lor_fonte:'4152c5d3-34c0-45a3-9cbd-1cc5add949a1',lor_barris:'6ad63400-e453-420c-bbda-ab84c5ad4ee1',lor_poste:'d0720586-8746-4402-9962-e7c5601d3f10',nor_casa:'b02aa97a-db21-4fa2-b9f8-fbb19fa1c265',nor_arvore:'9d674cdc-a93f-493e-a18d-1478a6109a5c',nor_ponte:'a15caf94-0f54-4d7c-ba31-faa16f765562',nor_cogumelos:'ab8b4789-747b-4b97-b582-22269b246062',dev_casa:'97ae9e9e-6d14-4e30-ac27-765adce84833',dev_pinheiro:'fa52c761-ad87-40e8-830c-9e1a8d2e87d4',dev_caverna:'5aa579aa-4b3a-4250-8a7a-f8fd306ee230',portal:'7e1e1931-ab70-4305-bcae-9a02bb1a39d7'};
export function propBlock(p:TownProp):Rectangle|null {
 if(p.kind==='portal'||p.kind==='nor_ponte'||p.kind==='nor_cogumelos')return null;
 const tree=p.kind==='nor_arvore'||p.kind==='dev_pinheiro';const w=tree?22:p.kind.includes('casa')?92:p.kind==='lor_muralha'?104:p.kind==='lor_fonte'?64:p.kind==='lor_poste'?8:36;
 const h=tree?16:p.kind.includes('casa')?40:p.kind==='lor_muralha'?32:p.kind==='lor_poste'?8:24;
 return {x:p.x-w/2,y:p.y-h,width:w,height:h};
}
export function applyTownCollision(map:LoadedMap):LoadedMap {
 const name=townName(map.folder);if(!name)return map;
 const blocks=townProps(name).flatMap(p=>{const b=propBlock(p);return b?[b]:[];});
 const objectBlockerRects=[...map.objectBlockerRects,...blocks];
 return {...map,walkableTerrainIds:new Set((map.map.terrains ?? []).map(t=>t.id)),objectBlockerRects,objectBlockerIndex:buildRectSpatialIndex(objectBlockerRects,64)};
}
export function preloadTownScenery(scene:Phaser.Scene,map:LoadedMap):void {
 const name=townName(map.folder);if(!name)return;
 for(const kind of new Set(townProps(name).map(p=>p.kind))){const key='town-'+kind;if(!scene.textures.exists(key))scene.load.image(key,assetUrl('objects',ASSETS[kind],'base','rotations','unknown.png'));}
}
export function renderTownScenery(scene:Phaser.Scene,map:LoadedMap):Phaser.GameObjects.GameObject[]{
 const name=townName(map.folder);if(!name)return [];
 const objects:Phaser.GameObjects.GameObject[]=[];
 for(const p of townProps(name)){
  const image=scene.add.image(p.x,p.y,'town-'+p.kind).setOrigin(.5,1).setDepth(p.y);
  // Bridges include a small stream patch; keep them below feet, never as blockers.
  if(p.kind==='nor_ponte')image.setDepth(-80000);
  image.setName('town:'+p.kind);objects.push(image);
 }
 const title=scene.add.text(1152,1060,name.toUpperCase()+' · REFÚGIO',{fontFamily:'Georgia',fontSize:'11px',color:'#d6d8c1',stroke:'#20232a',strokeThickness:3}).setOrigin(.5).setDepth(1062);objects.push(title);
 return objects;
}
