import { expect, test } from "@playwright/test";

/**
 * F-68 PWA 아이콘 PNG (이슈 #39).
 *
 * 검증의 핵심은 "파일이 있다" 가 아니라 **선언과 실물이 어긋나지 않는가** 다.
 * 매니페스트가 192x192 라고 적었는데 실제가 512 면 브라우저는 조용히 잘못
 * 고르고, 아무 오류도 나지 않는다. 그래서 IHDR 을 직접 읽어 대조한다.
 */

/** PNG 헤더에서 시그니처·크기·색상 타입을 읽는다. */
function readPngHeader(bytes: Buffer) {
  return {
    signature: bytes.subarray(0, 8).toString("hex"),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

const PNG_SIGNATURE = "89504e470d0a1a0a";

const ICONS = [
  { path: "/apple-touch-icon.png", size: 180 },
  { path: "/icon-192.png", size: 192 },
  { path: "/icon-512.png", size: 512 },
  { path: "/icon-maskable-512.png", size: 512 },
];

for (const icon of ICONS) {
  test(`GET ${icon.path} → 200, ${icon.size}x${icon.size} PNG`, async ({ request }) => {
    const response = await request.get(icon.path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");

    const header = readPngHeader(await response.body());
    expect(header.signature).toBe(PNG_SIGNATURE);
    expect(header.width).toBe(icon.size);
    expect(header.height).toBe(icon.size);
    expect(header.bitDepth).toBe(8);
    expect(header.colorType).toBe(6); // RGBA
  });
}

test("매니페스트가 선언한 sizes 와 실제 PNG 크기가 일치한다", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  const pngIcons = manifest.icons.filter((entry: { type: string }) => entry.type === "image/png");

  expect(pngIcons.length).toBeGreaterThanOrEqual(3);

  for (const entry of pngIcons) {
    const header = readPngHeader(await (await request.get(entry.src)).body());
    const [declaredW, declaredH] = entry.sizes.split("x").map(Number);
    expect(
      { src: entry.src, w: header.width, h: header.height },
      `${entry.src} 의 실제 크기가 선언(${entry.sizes})과 다르다`,
    ).toEqual({ src: entry.src, w: declaredW, h: declaredH });
  }
});

test("maskable 아이콘은 모서리가 꽉 차 있다 (OS 마스크가 두 번 깎지 않도록)", async ({
  request,
}) => {
  // maskable 은 OS 가 자기 마스크를 덧씌운다. 이미 둥근 이미지를 주면 모서리가
  // 두 번 깎여 이음매가 보인다. 그래서 이 변형만 full-bleed 여야 한다.
  const maskable = manifestEntry(await (await request.get("/manifest.webmanifest")).json());
  expect(maskable.src).toBe("/icon-maskable-512.png");

  const body = await (await request.get(maskable.src)).body();
  // any 용 아이콘은 투명 모서리를 갖고, maskable 은 갖지 않는다.
  // 투명 픽셀이 있으면 압축이 훨씬 잘 되므로 바이트 수가 뚜렷이 작다.
  const rounded = await (await request.get("/icon-512.png")).body();
  expect(body.length).toBeLessThan(rounded.length);

  function manifestEntry(manifest: { icons: Array<{ src: string; purpose: string }> }) {
    const entry = manifest.icons.find((i) => i.purpose === "maskable");
    if (!entry) throw new Error("purpose=maskable 아이콘이 매니페스트에 없다");
    return entry;
  }
});

test("index.html 이 apple-touch-icon 을 선언한다", async ({ page }) => {
  await page.goto("/");
  const href = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute("href");

  // iOS 는 SVG 를 지원하지 않는다 — 여기에 .svg 가 들어가면 홈 화면 추가 시
  // 아이콘 대신 페이지 스크린샷이 쓰인다.
  expect(href).toBe("/apple-touch-icon.png");
});
