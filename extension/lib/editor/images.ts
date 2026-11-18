// 사진을 본문의 "이미지 자리"에 끼워 넣는 계산. 화면이나 에디터를 건드리지 않고 값만 다룬다.
//
// 네이버 에디터에서 사진은 이렇게 다뤄진다 (docs/extension/EDITOR-NOTES.md):
//   - 사진의 주소(src, path, domain)는 네이버가 사진을 받은 뒤에 정해 준다. 직접 만들 수 없다.
//     그래서 사진을 에디터에 붙여넣어 올린 다음, 생긴 사진 부품을 원하는 자리로 옮긴다.
//   - 붙여넣으면 에디터가 커서 자리의 글 덩어리를 쪼갠다. 그 문서를 그대로 쓰지 않고,
//     붙여넣기 전의 문서에 사진 부품만 끼워 넣는다.
//   - 다 올라갔는지는 주소가 http 로 시작하는지로 본다.

export interface ImageSlot {
  /** 본문에 들어가 있는 "이미지 자리" 문단의 글자 */
  text: string;
  /** 이 자리에 넣을 사진의 파일 이름. 넣을 사진이 없으면 null */
  fileName: string | null;
}

export interface Placement {
  components: any[];
  /** 자리에 넣은 사진 수 */
  placed: number;
  /** 사진을 고르지 않았거나 올라오지 않아서 글자로 남은 자리 */
  emptySlots: string[];
  /** 자리를 찾지 못해 글 끝에 붙인 사진의 파일 이름 */
  appended: string[];
}

export const isImage = (comp: any): boolean => !!comp && comp['@ctype'] === 'image';

/** 문서에 있는 사진을 모두 꺼낸다. 나란히 넣은 묶음(imageStrip) 안의 사진도 한 장씩 센다. */
export function allImages(components: any[]): any[] {
  const out: any[] = [];
  for (const comp of components) {
    if (!comp) continue;
    if (comp['@ctype'] === 'imageStrip' && Array.isArray(comp.images)) out.push(...comp.images);
    else if (isImage(comp)) out.push(comp);
  }
  return out;
}

/** 네이버에 다 올라간 사진인지. 올리는 중에는 주소가 임시 주소다. */
export const isUploaded = (image: any): boolean => /^https?:\/\//i.test(String(image?.src ?? ''));

/** 파일 이름에서 확장자를 뗀다. 네이버가 확장자를 바꿔도 같은 사진인지 알아보려고 쓴다. */
export const baseName = (name: unknown): string => String(name ?? '').replace(/\.[a-z0-9]+$/i, '').toLowerCase();

function paragraphText(paragraph: any): string {
  const nodes: any[] = Array.isArray(paragraph?.nodes) ? paragraph.nodes : [];
  return nodes.map((node) => String(node?.value ?? '')).join('').replace(/[​﻿]/g, '').trim();
}

/**
 * 붙여넣기 전의 본문(base)에서 "이미지 자리" 문단을 올라온 사진으로 바꾼 본문을 만든다.
 *  - 자리는 본문에 나오는 순서대로 slots 와 짝을 짓는다.
 *  - 사진이 없는 자리는 글자를 그대로 둔다. 무엇이 빠졌는지 보이게 하려는 것이다.
 *  - 자리를 찾지 못한 사진은 버리지 않고 글 끝에 붙인다.
 *  - 글 덩어리를 쪼갤 때 첫 조각은 원래 id 를 쓰고, 나머지는 새 id 를 받는다.
 */
export function placeImages(base: any[], uploaded: any[], slots: ImageSlot[], newId: () => string): Placement {
  const byName = new Map<string, any>();
  for (const image of uploaded) byName.set(baseName(image.fileName), image);

  const components: any[] = [];
  const emptySlots: string[] = [];
  const used = new Set<any>();
  let slotIndex = 0;

  for (const comp of base) {
    if (!comp || comp['@ctype'] !== 'text' || !Array.isArray(comp.value)) {
      components.push(comp);
      continue;
    }
    let pending: any[] = [];
    let chunks = 0;
    const flush = () => {
      if (pending.length === 0) return;
      components.push({ ...comp, id: chunks === 0 ? comp.id : newId(), value: pending });
      chunks += 1;
      pending = [];
    };

    for (const paragraph of comp.value) {
      const slot = slots[slotIndex];
      if (!slot || paragraphText(paragraph) !== slot.text.trim()) {
        pending.push(paragraph);
        continue;
      }
      slotIndex += 1;
      const image = slot.fileName ? byName.get(baseName(slot.fileName)) : undefined;
      if (!image || used.has(image)) {
        emptySlots.push(slot.text);
        pending.push(paragraph);
        continue;
      }
      used.add(image);
      flush();
      components.push(JSON.parse(JSON.stringify(image)));
    }
    flush();
  }

  // 본문에서 찾지 못한 자리도 "빈 자리"로 알려 준다.
  for (const slot of slots.slice(slotIndex)) emptySlots.push(slot.text);

  const appended: string[] = [];
  for (const image of uploaded) {
    if (used.has(image)) continue;
    components.push(JSON.parse(JSON.stringify(image)));
    appended.push(String(image.fileName ?? ''));
  }

  // 대표 사진은 한 장만: 글에서 가장 먼저 나오는 사진.
  let first = true;
  for (const comp of components) {
    if (!isImage(comp)) continue;
    if ('represent' in comp || first) comp.represent = first;
    first = false;
  }

  return { components, placed: used.size, emptySlots, appended };
}
