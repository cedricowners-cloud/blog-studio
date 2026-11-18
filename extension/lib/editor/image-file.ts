// 고른 사진 파일을 에디터에 보내기 좋게 다듬는다. 사이드 패널(브라우저)에서만 돈다.
//   - 긴 쪽이 2000픽셀을 넘으면 줄인다. 네이버도 어차피 줄여서 보여 준다.
//   - 다시 그리는 과정에서 사진에 들어 있던 촬영 위치 같은 정보(EXIF)가 빠진다.
//   - 움직이는 GIF 는 그대로 보낸다 (다시 그리면 멈춘 그림이 된다).

export interface PreparedImage {
  /** 올릴 때 쓰는 파일 이름. 올라온 사진과 짝을 맞추는 데 쓴다 */
  name: string;
  /** 사람이 고른 원래 파일 이름 (화면에 보여 주려고) */
  originalName: string;
  dataUrl: string;
  width: number;
  height: number;
  /** 다듬은 뒤의 크기 (바이트) */
  bytes: number;
}

const MAX_SIDE = 2000;
/** 한 장의 최대 크기. 이보다 크면 에디터에 보내지 않는다 */
const MAX_BYTES = 8 * 1024 * 1024;

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('사진을 읽지 못했어요.'));
    reader.readAsDataURL(blob);
  });

/** 파일 이름으로 쓰기 좋은 짧은 표시. 한 번의 채우기 안에서 사진끼리 겹치지 않게 한다 */
const stamp = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function prepareImage(file: File, order: number): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error(`사진 파일이 아니에요: ${file.name}`);
  const tag = `bs-${stamp()}-${order}`;

  if (file.type === 'image/gif') {
    if (file.size > MAX_BYTES) throw new Error(`GIF가 너무 커요 (8MB까지): ${file.name}`);
    const bitmap = await createImageBitmap(file).catch(() => null);
    return {
      name: `${tag}.gif`,
      originalName: file.name,
      dataUrl: await readAsDataUrl(file),
      width: bitmap?.width ?? 0,
      height: bitmap?.height ?? 0,
      bytes: file.size,
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`이 사진은 읽지 못해요: ${file.name}. JPG나 PNG로 바꿔서 골라 주세요. (아이폰의 HEIC 사진은 크롬이 읽지 못해요)`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('사진을 다듬지 못했어요.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // 투명한 곳이 있을 수 있는 PNG 는 PNG 로, 나머지는 JPG 로 내보낸다.
  const keepPng = file.type === 'image/png';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, keepPng ? 'image/png' : 'image/jpeg', 0.9));
  if (!blob) throw new Error('사진을 다듬지 못했어요.');
  if (blob.size > MAX_BYTES) throw new Error(`사진이 너무 커요 (8MB까지): ${file.name}`);
  return {
    name: `${tag}.${keepPng ? 'png' : 'jpg'}`,
    originalName: file.name,
    dataUrl: await readAsDataUrl(blob),
    width,
    height,
    bytes: blob.size,
  };
}

/**
 * AI에 보여 줄 작은 사본을 만든다. 긴 쪽 1280픽셀의 JPG 다.
 * 글을 쓰는 데는 이 크기로 충분하고, 보내는 양과 비용이 줄어든다. 네이버에는 원래 다듬은 사진을 올린다.
 * 투명한 곳은 흰색으로 채운다. 움직이는 GIF 는 첫 장면만 보낸다.
 */
export async function aiCopy(image: PreparedImage, maxSide = 1280): Promise<{ mime: string; data: string }> {
  const element = new Image();
  element.src = image.dataUrl;
  try {
    await element.decode();
  } catch {
    throw new Error(`이 사진은 AI에 보낼 수 없어요: ${image.originalName}`);
  }
  const scale = Math.min(1, maxSide / Math.max(element.naturalWidth, element.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(element.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(element.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('사진을 다듬지 못했어요.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(element, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return { mime: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}
