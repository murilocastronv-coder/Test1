// Configurable gameplay balance, inspired by classic MU; not official server data.
export interface ClassicMonster { id: string; name: string; map: string; level: number; hp: number; damage: number; defense: number; exp: number; zen: number; respawnMs: number; dropChance: number; ranged?: boolean; }
export const CLASSIC_MONSTERS: ClassicMonster[] = [
 {id:'88f0a8e6-a227-4ff3-af68-6d70d10fe862',name:'Bull Fighter',map:'Lorencia',level:6,hp:90,damage:9,defense:2,exp:30,zen:14,respawnMs:14000,dropChance:.24},
 {id:'b45625d2-31b9-473e-bff4-95f39090aa44',name:'Hound',map:'Lorencia',level:9,hp:105,damage:11,defense:3,exp:38,zen:18,respawnMs:14000,dropChance:.24},
 {id:'05f6621d-3a21-4b64-891f-ea07544ab4df',name:'Lich',map:'Lorencia',level:14,hp:115,damage:14,defense:3,exp:48,zen:24,respawnMs:16000,dropChance:.28,ranged:true},
 {id:'4b0feb8e-8958-4902-b1eb-749c3b15c4a3',name:'Giant',map:'Lorencia',level:17,hp:170,damage:17,defense:5,exp:64,zen:30,respawnMs:18000,dropChance:.3},
 {id:'765a1ab1-0538-4101-9520-bae405d3cbd4',name:'Goblin',map:'Noria',level:3,hp:55,damage:6,defense:1,exp:20,zen:10,respawnMs:12000,dropChance:.2},
 {id:'32411b98-4eb5-43cc-b8bd-c9b6ed3732bf',name:'Hunter',map:'Noria',level:13,hp:100,damage:12,defense:3,exp:42,zen:22,respawnMs:14000,dropChance:.25},
 {id:'5d23b8c8-d1bd-4e0e-94a9-facecd8f23c9',name:'Forest Monster',map:'Noria',level:15,hp:145,damage:14,defense:4,exp:52,zen:26,respawnMs:16000,dropChance:.28},
 {id:'e517606d-a1ba-4e77-9da6-2ba5af387ad1',name:'Agon',map:'Noria',level:16,hp:160,damage:16,defense:5,exp:60,zen:30,respawnMs:18000,dropChance:.3},
 {id:'5da2797c-f831-489c-ad9b-344b39cd74ea',name:'Ice Monster',map:'Devias',level:22,hp:175,damage:18,defense:6,exp:72,zen:34,respawnMs:16000,dropChance:.3},
 {id:'399d4689-9706-4f1f-9a48-bedddb261866',name:'Assassin',map:'Devias',level:26,hp:155,damage:20,defense:5,exp:80,zen:40,respawnMs:16000,dropChance:.32},
 {id:'b636b0c1-bf91-40ab-9ad8-f89feef13a08',name:'Yeti',map:'Devias',level:30,hp:220,damage:23,defense:7,exp:95,zen:48,respawnMs:18000,dropChance:.34},
 {id:'dfbd2cd2-035e-4d98-97f1-7b64305ff6fe',name:'Elite Yeti',map:'Devias',level:36,hp:280,damage:27,defense:9,exp:125,zen:60,respawnMs:22000,dropChance:.4},
];
