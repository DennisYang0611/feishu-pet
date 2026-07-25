export type SkinId = 'pixel' | 'caishen' | 'plant' | 'unicorn' | 'plane'
export type PetForm = 'baby' | 'adult'

export interface SkinDef {
  id: SkinId
  name: string
  /** 图片皮肤的路径模板，{form} 替换 baby/adult；像素皮肤为 null */
  img: string | null
}

export const SKINS: SkinDef[] = [
  { id: 'pixel', name: '小绝 · 像素猫', img: null },
  { id: 'caishen', name: '财神到', img: './skins/caishen-{form}.png' },
  { id: 'plant', name: '小绿芽', img: './skins/plant-{form}.png' },
  { id: 'unicorn', name: '彩虹独角兽', img: './skins/unicorn-{form}.png' },
  { id: 'plane', name: '飞飞 · 小飞机', img: './skins/plane-{form}.png' },
]

export const FORMS: { id: PetForm; name: string }[] = [
  { id: 'baby', name: '幼年形态' },
  { id: 'adult', name: '成年形态' },
]

export function skinImage(skin: SkinId, form: PetForm): string | null {
  const def = SKINS.find((s) => s.id === skin)
  return def?.img ? def.img.replace('{form}', form) : null
}
