/**
 * Generador de códigos QR mínimo, sin dependencias externas.
 *
 * Implementa el modo byte (8 bits) con nivel de corrección M, versión
 * automática (1–10) y máscara 0. Es suficiente para URL cortas de invitación
 * y evita enviar el token a servicios de terceros.
 *
 * Referencia: ISO/IEC 18004 (QR Code).
 */

// --- Aritmética de GF(256) -------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

// --- Polinomios de corrección de errores -----------------------------------

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ gfMul(poly[j]!, EXP[i]!);
      next[j + 1] = next[j + 1]! ^ poly[j]!;
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecCount: number): number[] {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Array<number>(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0]!;
    res.shift();
    res.push(0);
    for (let i = 0; i < ecCount; i++) {
      res[i] = res[i]! ^ gfMul(gen[i + 1]!, factor);
    }
  }
  return res;
}

// --- Tablas de capacidades (versión, nivel M) ------------------------------

interface EcInfo {
  ecPerBlock: number;
  blocks: number[];
}

// Datos por versión (nivel M): total de codewords de datos y reparto por bloque.
const EC_M: Record<number, EcInfo> = {
  1: { ecPerBlock: 10, blocks: [16] },
  2: { ecPerBlock: 16, blocks: [28] },
  3: { ecPerBlock: 26, blocks: [44] },
  4: { ecPerBlock: 18, blocks: [32, 32] },
  5: { ecPerBlock: 24, blocks: [43, 43] },
  6: { ecPerBlock: 16, blocks: [27, 27, 27, 27] },
  7: { ecPerBlock: 18, blocks: [31, 31, 31, 31] },
  8: { ecPerBlock: 22, blocks: [38, 38, 38, 38] },
  9: { ecPerBlock: 22, blocks: [36, 36, 36, 36, 36] },
  10: { ecPerBlock: 26, blocks: [43, 43, 43, 43, 43] },
};

// Posiciones de los patrones de alineación por versión.
const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// --- Modo byte -------------------------------------------------------------

function toUtf8Bytes(text: string): number[] {
  const encoded = new TextEncoder().encode(text);
  return Array.from(encoded);
}

function buildDataCodewords(bytes: number[], version: number): number[] {
  const info = EC_M[version]!;
  const totalData = info.blocks.reduce((a, b) => a + b, 0);

  const bits: number[] = [];
  const pushBits = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  pushBits(0b0100, 4); // modo byte
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  const capacityBits = totalData * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminator; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    codewords.push(byte);
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (codewords.length < totalData) codewords.push(pads[p++ % 2]!);
  return codewords;
}

// --- Intercalado de bloques ------------------------------------------------

function interleave(data: number[], version: number): number[] {
  const info = EC_M[version]!;
  const blockCount = info.blocks.length;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];

  let offset = 0;
  for (let i = 0; i < blockCount; i++) {
    const size = info.blocks[i]!;
    const block = data.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, info.ecPerBlock));
  }

  const result: number[] = [];
  const maxData = Math.max(...info.blocks);
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]!);
    }
  }
  for (let i = 0; i < info.ecPerBlock; i++) {
    for (const block of ecBlocks) {
      result.push(block[i]!);
    }
  }
  return result;
}

// --- Construcción de la matriz ---------------------------------------------

interface Matrix {
  size: number;
  modules: boolean[][];
  reserved: boolean[][];
}

function placeFinder(m: Matrix, row: number, col: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.size || cc >= m.size) continue;
      const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m.modules[rr]![cc] = isBorder || isCore;
      m.reserved[rr]![cc] = true;
    }
  }
}

function placeAlignment(m: Matrix, version: number): void {
  const positions = ALIGNMENT[version]!;
  for (const row of positions) {
    for (const col of positions) {
      if (m.reserved[row]![col]) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const rr = row + r;
          const cc = col + c;
          const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
          const isCenter = r === 0 && c === 0;
          m.modules[rr]![cc] = isBorder || isCenter;
          m.reserved[rr]![cc] = true;
        }
      }
    }
  }
}

function placeTiming(m: Matrix): void {
  for (let i = 8; i < m.size - 8; i++) {
    if (!m.reserved[6]![i]) {
      m.modules[6]![i] = i % 2 === 0;
      m.reserved[6]![i] = true;
    }
    if (!m.reserved[i]![6]) {
      m.modules[i]![6] = i % 2 === 0;
      m.reserved[i]![6] = true;
    }
  }
}

function reserveFormatAndVersion(m: Matrix, version: number): void {
  for (let i = 0; i < 9; i++) {
    m.reserved[8]![i] = true;
    m.reserved[i]![8] = true;
  }
  for (let i = 0; i < 8; i++) {
    m.reserved[8]![m.size - 1 - i] = true;
    m.reserved[m.size - 1 - i]![8] = true;
  }
  m.reserved[m.size - 8]![8] = true;

  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        m.reserved[m.size - 11 + j]![i] = true;
        m.reserved[i]![m.size - 11 + j] = true;
      }
    }
  }
}

function placeData(m: Matrix, codewords: number[]): void {
  const bits: number[] = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  }

  let bitIndex = 0;
  let upward = true;
  for (let col = m.size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // saltar columna de sincronización
    for (let i = 0; i < m.size; i++) {
      const row = upward ? m.size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (m.reserved[row]![cc]) continue;
        const bit = bitIndex < bits.length ? bits[bitIndex]! : 0;
        bitIndex++;
        m.modules[row]![cc] = bit === 1;
      }
    }
    upward = !upward;
  }
}

// --- Máscara y formato -----------------------------------------------------

const MASK_FN = (row: number, col: number): boolean => (row + col) % 2 === 0;

function applyMask(m: Matrix): void {
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.reserved[r]![c]) continue;
      if (MASK_FN(r, c)) m.modules[r]![c] = !m.modules[r]![c];
    }
  }
}

function placeFormat(m: Matrix, maskId: number): void {
  // Nivel M = 0b00; bits de formato = nivel(2) + máscara(3).
  const data = (0b00 << 3) | maskId;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  const format = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) m.modules[8]![i] = ((format >> i) & 1) === 1;
  m.modules[8]![7] = ((format >> 6) & 1) === 1;
  m.modules[8]![8] = ((format >> 7) & 1) === 1;
  m.modules[7]![8] = ((format >> 8) & 1) === 1;
  for (let i = 9; i <= 14; i++) m.modules[14 - i]![8] = ((format >> i) & 1) === 1;

  for (let i = 0; i <= 7; i++) m.modules[m.size - 1 - i]![8] = ((format >> i) & 1) === 1;
  for (let i = 8; i <= 14; i++) m.modules[8]![m.size - 15 + i] = ((format >> i) & 1) === 1;
  m.modules[m.size - 8]![8] = true; // módulo oscuro fijo
}

// --- API pública -----------------------------------------------------------

export interface QrResult {
  size: number;
  modules: boolean[][];
}

/** Genera la matriz de módulos de un QR para el texto dado. */
export function generateQrMatrix(text: string): QrResult {
  const bytes = toUtf8Bytes(text);

  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const info = EC_M[v]!;
    const totalData = info.blocks.reduce((a, b) => a + b, 0);
    const charCountBits = v <= 9 ? 8 : 16;
    const neededBits = 4 + charCountBits + bytes.length * 8;
    if (neededBits <= totalData * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    throw new Error("Texto demasiado largo para el generador QR (máx. versión 10).");
  }

  const maskId = 0;
  const data = buildDataCodewords(bytes, version);
  const codewords = interleave(data, version);

  const size = version * 4 + 17;
  const m: Matrix = {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };

  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);
  placeAlignment(m, version);
  placeTiming(m);
  reserveFormatAndVersion(m, version);
  placeData(m, codewords);
  applyMask(m);
  placeFormat(m, maskId);

  return { size, modules: m.modules };
}

/**
 * Renderiza un SVG del QR (string) listo para incrustar. El `quietZone`
 * añade el margen blanco requerido por el estándar.
 */
export function qrToSvg(text: string, moduleSize = 4, quietZone = 4): string {
  const { size, modules } = generateQrMatrix(text);
  const dim = (size + quietZone * 2) * moduleSize;
  const rects: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules[r]![c]) continue;
      const x = (c + quietZone) * moduleSize;
      const y = (r + quietZone) * moduleSize;
      rects.push(`<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}"/>`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" ` +
    `viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="#ffffff"/>` +
    `<g fill="#000000">${rects.join("")}</g></svg>`
  );
}

/** Data URL de un SVG del QR, para usar en `<img src>`. */
export function qrToDataUrl(text: string, moduleSize = 4, quietZone = 4): string {
  const svg = qrToSvg(text, moduleSize, quietZone);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
