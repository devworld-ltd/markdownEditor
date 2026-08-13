#!/usr/bin/env node
/**
 * F-68 PWA 아이콘 PNG 생성 (이슈 #39).
 *
 * `public/icon.svg` 를 읽어 PNG 를 만든다. 산출물은 **저장소에 커밋**되고 빌드
 * 시점에는 실행되지 않는다 — CI 에 이미지 툴체인을 요구하지 않기 위해서다.
 * 아이콘을 바꿨을 때만 `npm run icons` 로 다시 돌린다.
 *
 * 왜 직접 래스터화하는가:
 * - `sips`/`rsvg-convert`/`sharp` 는 각각 macOS 전용·시스템 설치 필요·네이티브
 *   의존성이다. 이 저장소는 런타임 의존성이 marked/DOMPurify 둘뿐이고,
 *   아이콘 하나 때문에 그 성질을 잃을 이유가 없다.
 * - 이 아이콘은 **둥근 사각형 + 직선 폴리곤**뿐이라 정확한 기하 판정이 가능하다.
 *   베지어도 그라디언트도 없어서 범용 SVG 렌더러가 필요 없다.
 *
 * 한계: 여기 있는 파서는 이 파일이 쓰는 SVG 부분집합(`<rect rx>` 1개 +
 * 직선 명령만 쓰는 `<path>` 1개)만 다룬다. 아이콘에 곡선·그라디언트·복수
 * 도형을 넣으면 **조용히 틀리는 대신 예외로 멈춘다**(아래 검증 참고).
 */

import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG_PATH = join(ROOT, "public", "icon.svg");

/** 픽셀당 슈퍼샘플 격자 한 변. 4 → 픽셀당 16 샘플. */
const SUPERSAMPLE = 4;

// --- SVG 파싱 (의도적으로 좁은 부분집합) ------------------------------------

function parseIcon(svgText) {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svgText);
  if (!viewBox) throw new Error("viewBox='0 0 W H' 를 찾지 못했다.");

  const rect = /<rect\s+width="(\d+)"\s+height="(\d+)"\s+rx="(\d+)"\s+fill="(#[0-9a-fA-F]{6})"\s*\/>/.exec(svgText);
  if (!rect) throw new Error("배경 <rect width height rx fill> 를 찾지 못했다.");

  const path = /<path\s+d="([^"]+)"\s+fill="(#[0-9a-fA-F]{6})"\s*\/>/.exec(svgText);
  if (!path) throw new Error("전경 <path d fill> 를 찾지 못했다.");

  const shapeCount = (svgText.match(/<(rect|path|circle|ellipse|polygon|polyline|g|image|use)\b/g) ?? []).length;
  if (shapeCount !== 2) {
    throw new Error(
      `도형이 2개(rect+path)일 때만 지원한다. ${shapeCount}개를 찾았다 — ` +
        "아이콘이 바뀌었으면 이 스크립트를 함께 갱신하라.",
    );
  }

  return {
    size: Number(viewBox[1]),
    rect: {
      width: Number(rect[1]),
      height: Number(rect[2]),
      rx: Number(rect[3]),
      fill: hexToRgb(rect[4]),
    },
    polygon: parsePath(path[1]),
    fill: hexToRgb(path[2]),
  };
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * 직선 명령만 쓰는 path 를 폴리곤 정점 배열로 바꾼다.
 * 지원: M/m L/l H/h V/v Z/z. 곡선(C/S/Q/T/A)을 만나면 예외로 멈춘다.
 */
function parsePath(d) {
  // 지원하지 않는 명령까지 **모두** 토큰으로 잡아야 아래 가드가 실행된다.
  // 지원 문자만 매칭하면 'C' 같은 글자가 조용히 버려져 곡선이 직선으로
  // 파싱된다 — 막으려던 실패 모드가 그대로 일어난다.
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const points = [];
  let cursor = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let command = null;
  let i = 0;

  const num = () => {
    const value = Number(tokens[i++]);
    if (Number.isNaN(value)) throw new Error(`path 숫자 파싱 실패: ${d}`);
    return value;
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (/[A-Za-z]/.test(token)) {
      if (!/[MmLlHhVvZz]/.test(token)) {
        throw new Error(`직선 명령만 지원한다. '${token}' 을 만났다 — 곡선이 생겼으면 이 스크립트를 갱신하라.`);
      }
      command = token;
      i++;
      if (command === "Z" || command === "z") {
        cursor = { ...start };
        continue;
      }
    }

    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M": {
        const x = num();
        const y = num();
        cursor = relative ? { x: cursor.x + x, y: cursor.y + y } : { x, y };
        start = { ...cursor };
        // 이어지는 좌표쌍은 암묵적으로 L 로 취급된다(SVG 명세).
        command = relative ? "l" : "L";
        break;
      }
      case "L": {
        const x = num();
        const y = num();
        cursor = relative ? { x: cursor.x + x, y: cursor.y + y } : { x, y };
        break;
      }
      case "H": {
        const x = num();
        cursor = { x: relative ? cursor.x + x : x, y: cursor.y };
        break;
      }
      case "V": {
        const y = num();
        cursor = { x: cursor.x, y: relative ? cursor.y + y : y };
        break;
      }
      default:
        throw new Error(`처리하지 못한 명령: ${command}`);
    }
    points.push({ ...cursor });
  }

  if (points.length < 3) throw new Error("폴리곤 정점이 3개 미만이다.");
  return points;
}

// --- 기하 판정 ---------------------------------------------------------------

/** 둥근 사각형 내부 판정. 베지어 근사가 아니라 정확한 원 판정을 쓴다. */
function insideRoundedRect(x, y, width, height, rx) {
  if (x < 0 || y < 0 || x > width || y > height) return false;
  const cx = x < rx ? rx : x > width - rx ? width - rx : x;
  const cy = y < rx ? rx : y > height - rx ? height - rx : y;
  if (cx === x || cy === y) return true; // 모서리 원 영역 밖 = 직선 변 영역
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rx * rx;
}

/** 짝수-홀수 규칙 점-폴리곤 판정. */
function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// --- 래스터화 ----------------------------------------------------------------

/**
 * @param {object} icon parseIcon 결과
 * @param {number} size 출력 한 변 픽셀
 * @param {boolean} fullBleed true 면 모서리 둥글기를 무시하고 배경을 꽉 채운다.
 *   maskable 아이콘과 apple-touch-icon 이 이 형태여야 한다 — OS 가 자기 마스크를
 *   덧씌우므로, 이미 둥근 이미지를 주면 모서리가 두 번 깎여 이음매가 보인다.
 */
function rasterize(icon, size, fullBleed) {
  const scale = icon.size / size;
  const step = 1 / SUPERSAMPLE;
  const offset = step / 2;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const ux = (px + offset + sx * step) * scale;
          const uy = (py + offset + sy * step) * scale;

          const onBackground =
            fullBleed || insideRoundedRect(ux, uy, icon.rect.width, icon.rect.height, icon.rect.rx);
          if (!onBackground) continue;

          const color = insidePolygon(ux, uy, icon.polygon) ? icon.fill : icon.rect.fill;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 255;
        }
      }

      const index = (py * size + px) * 4;
      if (a === 0) continue; // 완전 투명 — 0 으로 남긴다
      // 커버리지로 나눈다(알파가 아니라). 이래야 반투명 가장자리의 색이
      // 배경 쪽으로 흐려지지 않고 도형 본래 색을 유지한다(비프리멀티플라이).
      const covered = a / 255;
      pixels[index] = Math.round(r / covered);
      pixels[index + 1] = Math.round(g / covered);
      pixels[index + 2] = Math.round(b / covered);
      pixels[index + 3] = Math.round(a / samples);
    }
  }

  return pixels;
}

// --- PNG 인코딩 (node:zlib 만 사용) ------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // non-interlaced

  // 각 스캔라인 앞에 필터 바이트 0(None)을 붙인다.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- 진입점 ------------------------------------------------------------------

const TARGETS = [
  // iOS 홈 화면. 알파를 지원하지 않아 투명 모서리가 검게 합성되므로 full-bleed.
  { file: "apple-touch-icon.png", size: 180, fullBleed: true },
  { file: "icon-192.png", size: 192, fullBleed: false },
  { file: "icon-512.png", size: 512, fullBleed: false },
  // maskable: OS 가 자기 마스크를 씌우므로 배경이 정사각형을 꽉 채워야 한다.
  { file: "icon-maskable-512.png", size: 512, fullBleed: true },
];

const icon = parseIcon(readFileSync(SVG_PATH, "utf8"));
for (const target of TARGETS) {
  const png = encodePng(rasterize(icon, target.size, target.fullBleed), target.size);
  writeFileSync(join(ROOT, "public", target.file), png);
  console.log(`[icons] ${target.file} — ${target.size}x${target.size}, ${png.length} bytes`);
}
