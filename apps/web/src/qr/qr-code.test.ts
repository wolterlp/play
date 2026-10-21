import { describe, it, expect } from "vitest";
import { generateQrMatrix, qrToSvg } from "./qr-code.js";

describe("generador QR", () => {
  it("genera una matriz cuadrada con los patrones de posición", () => {
    const { size, modules } = generateQrMatrix("http://localhost:5173/join/abc123");
    expect(size).toBeGreaterThanOrEqual(21);
    expect(size % 4).toBe(1);
    expect(modules).toHaveLength(size);
    // Esquina superior izquierda: patrón de posición (borde oscuro).
    expect(modules[0]![0]).toBe(true);
    expect(modules[1]![1]).toBe(false);
    expect(modules[3]![3]).toBe(true);
  });

  it("produce SVG con módulos oscuros", () => {
    const svg = qrToSvg("http://localhost:5173/join/abc123");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<rect");
  });

  it("crece de versión con textos largos", () => {
    const corto = generateQrMatrix("a".repeat(10));
    const largo = generateQrMatrix("a".repeat(120));
    expect(largo.size).toBeGreaterThan(corto.size);
  });

  it("lanza error si el texto es demasiado largo", () => {
    expect(() => generateQrMatrix("a".repeat(5000))).toThrow();
  });
});
