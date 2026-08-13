/**
 * F-56 드롭된 파일 분류 (이슈 #83).
 *
 * 드롭 한 번에 이미지와 마크다운이 섞여 올 수 있다. **분류 규칙을 여기 한 곳에
 * 모아 두는 이유**는 `editorDrop.ts` 가 이미 이미지 경로를 갖고 있어서, 분기가
 * 그 안에 흩어지면 "이 파일은 어느 쪽인가" 라는 질문의 답이 여러 곳에 생기기
 * 때문이다.
 *
 * ## MIME 타입만 믿지 않는다
 *
 * `.md` 의 MIME 타입은 브라우저·OS 마다 다르다 — `text/markdown` 일 때도,
 * `text/plain` 일 때도, **빈 문자열일 때도** 있다(맥에서 흔하다). 그래서
 * **확장자를 1순위**로 보고 타입은 보조로만 쓴다.
 *
 * 반대로 이미지는 타입을 믿는다. 업로드 검증(`imageUpload.ts`)이 이미 타입
 * 기준이고, 확장자를 고쳐 붙인 파일을 통과시키면 안 되기 때문이다.
 *
 * DOM 을 만지지 않는 순수 모듈이다.
 */

/** 텍스트로 열 확장자. 소문자로 비교한다. */
export const DOCUMENT_EXTENSIONS = [
  ".md",
  ".markdown",
  ".mdown",
  ".mkd",
  ".txt",
] as const;

/** 파일 이름의 확장자(소문자, 점 포함). 없으면 "". */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return ""; // ".gitignore" 는 확장자가 아니라 이름이다
  return name.slice(dot).toLowerCase();
}

export interface DroppedFileLike {
  name: string;
  type: string;
}

/** 이미지인가 — 타입 기준(확장자를 고쳐 붙인 파일을 통과시키지 않는다). */
export function isImageFile(file: DroppedFileLike): boolean {
  return file.type.startsWith("image/");
}

/**
 * 텍스트 문서로 열 파일인가.
 *
 * 확장자가 1순위다. 확장자가 없을 때만 `text/` 타입을 인정한다 — 이름 없는
 * 텍스트 조각도 열 수 있어야 하지만, `report.pdf` 가 어쩌다 `text/plain` 으로
 * 오는 경우까지 열어 주면 안 된다.
 */
export function isDocumentFile(file: DroppedFileLike): boolean {
  if (isImageFile(file)) return false;
  const ext = extensionOf(file.name);
  if (ext) return (DOCUMENT_EXTENSIONS as readonly string[]).includes(ext);
  return file.type.startsWith("text/");
}

export interface Classified<T extends DroppedFileLike> {
  images: T[];
  documents: T[];
  /** 어느 쪽도 아닌 파일. 사용자에게 이유를 알려야 한다. */
  rejected: T[];
}

export function classifyDropped<T extends DroppedFileLike>(files: T[]): Classified<T> {
  const images: T[] = [];
  const documents: T[] = [];
  const rejected: T[] = [];

  for (const file of files) {
    if (isImageFile(file)) images.push(file);
    else if (isDocumentFile(file)) documents.push(file);
    else rejected.push(file);
  }

  return { images, documents, rejected };
}

/** 거절된 파일을 알리는 문구. 무엇이 왜 안 되는지 이름까지 밝힌다. */
export function rejectionMessage(files: DroppedFileLike[]): string {
  const names = files.map((f) => f.name).join(", ");
  return `열 수 없는 형식입니다: ${names} (마크다운·텍스트·이미지만 됩니다)`;
}
