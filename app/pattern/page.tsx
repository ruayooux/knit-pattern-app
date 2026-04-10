"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, FileSpreadsheet, FileText, FileType2, Redo2, Undo2 } from "lucide-react";

type Matrix = number[][];
type OverlayMatrix = (number | null)[][];
type Palette = Record<number, string>;

type WorksheetLike = {
  pageSetup: Record<string, unknown>;
  addConditionalFormatting?: (config: unknown) => void;
  getCell: (row: number, col: number) => any;
  getColumn: (col: number) => { width: number };
  getRow: (row: number) => { height: number };
};

type WorkbookLike = {
  creator?: string;
  created?: Date;
  addWorksheet: (name: string) => WorksheetLike;
  getWorksheet?: (indexOrName: number | string) => any;
  xlsx: { writeBuffer: () => Promise<ArrayBuffer> };
  csv?: { read: (input: Blob | Buffer | NodeJS.ReadableStream | ArrayBuffer | Uint8Array | string) => Promise<any> };
};

type ExcelJsLike = {
  Workbook: new () => WorkbookLike;
};

type IncreaseStep = {
  row: number;
  stitches: number;
  occurrence: number;
};

type PaletteOption = {
  value: number;
  color: string;
};

const CM_TO_PX = 37.7952755906;
const CM_TO_PT = 28.3464567;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const A4_MARGIN_MM = 10;
const MAX_VALUE = 5;

const defaultPalette: Palette = {
  0: "#E5E7EB",
  1: "#8B2E12",
  2: "#B87333",
  3: "#5B7C99",
  4: "#6B8F4E",
  5: "#7C4D9E",
};

const HISTORY_LIMIT = 100;

function getContrastColor(hex: string) {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance >= 160 ? "#111827" : "#ffffff";
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function quantizeGray(gray: number, maxColorValue: number) {
  const normalized = 255 - gray;
  const stepped = Math.round((normalized / 255) * maxColorValue);
  return clamp(stepped, 0, maxColorValue);
}

function matrixToCsv(matrix: Matrix) {
  return matrix.map((r) => r.join(",")).join("\n");
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function cloneMatrix(matrix: Matrix) {
  return matrix.map((row) => [...row]);
}

function matricesEqual(a: Matrix, b: Matrix) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j += 1) {
      if (a[i][j] !== b[i][j]) return false;
    }
  }
  return true;
}

function createEmptyOverlay(rows: number, cols: number): OverlayMatrix {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

function tileOverlayMatrix(source: OverlayMatrix, repeatX: number, repeatY: number): OverlayMatrix {
  if (!source.length) return [];
  const rows = source.length;
  const cols = source[0].length;
  return Array.from({ length: rows * repeatY }, (_, r) =>
    Array.from({ length: cols * repeatX }, (_, c) => source[r % rows][c % cols])
  );
}

function composeMatrices(base: Matrix, overlay: OverlayMatrix): Matrix {
  if (!base.length) return [];
  return base.map((row, r) =>
    row.map((cell, c) => (overlay[r]?.[c] ?? cell))
  );
}

function parseDelimitedMatrix(text: string): Matrix {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) =>
      line
        .split(/[,\t;]/)
        .map((part) => Number(part.trim()))
        .map((value) => (Number.isFinite(value) ? value : 0))
    );
}

function tileMatrix(source: Matrix, repeatX: number, repeatY: number): Matrix {
  if (!source.length) return [];
  const rows = source.length;
  const cols = source[0].length;
  return Array.from({ length: rows * repeatY }, (_, r) =>
    Array.from({ length: cols * repeatX }, (_, c) => source[r % rows][c % cols])
  );
}

function adjustRows(source: Matrix, newRows: number, fillValue = 0): Matrix {
  if (!source.length) return [];
  const cols = source[0].length;
  if (newRows === source.length) return source;
  if (newRows < source.length) return source.slice(0, newRows);
  const extra = Array.from({ length: newRows - source.length }, () =>
    Array.from({ length: cols }, () => fillValue)
  );
  return [...source, ...extra];
}

function createCenteredRow(cols: number, stitches: number, fillValue: number, bgValue: number) {
  const safeStitches = clamp(stitches, 0, cols);
  const row = Array.from({ length: cols }, () => bgValue);
  const leftPad = Math.floor((cols - safeStitches) / 2);
  for (let i = 0; i < safeStitches; i += 1) {
    row[leftPad + i] = fillValue;
  }
  return row;
}

function buildIncreaseSteps(startRow: number, startStitches: number, endStitches: number, endRow: number): IncreaseStep[] {
  const safeStartRow = Math.max(1, startRow);
  const safeEndRow = Math.max(safeStartRow, endRow);
  const totalChange = endStitches - startStitches;
  const direction = totalChange >= 0 ? 1 : -1;
  const totalEvents = Math.abs(totalChange);

  const steps: IncreaseStep[] = [{ row: safeStartRow, stitches: 0, occurrence: 0 }];
  if (safeEndRow === safeStartRow || totalEvents === 0) return steps;

  const totalRowsForDistribution = safeEndRow - safeStartRow + 1;
  const baseInterval = Math.floor(totalRowsForDistribution / totalEvents);
  const remainder = totalRowsForDistribution % totalEvents;

  const intervals: number[] = [];
  if (baseInterval <= 0) {
    for (let i = 0; i < totalEvents; i += 1) intervals.push(1);
  } else if (remainder === 0) {
    for (let i = 0; i < totalEvents; i += 1) intervals.push(baseInterval);
  } else {
    for (let i = 0; i < totalEvents - remainder; i += 1) intervals.push(baseInterval);
    for (let i = 0; i < remainder; i += 1) intervals.push(baseInterval + 1);
  }

  let currentRow = safeStartRow - 1;
  let occurrence = 0;
  for (const gap of intervals) {
    currentRow += gap;
    occurrence += 1;
    steps.push({ row: currentRow, stitches: direction, occurrence });
  }

  return steps;
}

function getPaletteCountLabel(maxColorValue: number) {
  return Math.max(1, maxColorValue);
}

function generateShapedMatrix(
  cols: number,
  rows: number,
  startRow: number,
  startStitches: number,
  endStitches: number,
  endRow: number,
  fillValue: number,
  bgValue: number
): Matrix {
  const safeRows = Math.max(1, rows);
  const safeStartRow = clamp(startRow, 1, safeRows);
  const safeEndRow = clamp(endRow, safeStartRow, safeRows);
  const steps = buildIncreaseSteps(safeStartRow, startStitches, endStitches, safeEndRow);

  let currentStitches = clamp(startStitches, 0, cols);
  let stepIndex = 1;

  return Array.from({ length: safeRows }, (_, index) => {
    const rowNumber = index + 1;

    while (stepIndex < steps.length && steps[stepIndex].row === rowNumber) {
      currentStitches = clamp(currentStitches + steps[stepIndex].stitches, 0, cols);
      stepIndex += 1;
    }

    const stitchesForRow = rowNumber < safeStartRow
      ? clamp(startStitches, 0, cols)
      : rowNumber <= safeEndRow
        ? currentStitches
        : clamp(endStitches, 0, cols);
    return createCenteredRow(cols, stitchesForRow, fillValue, bgValue);
  });
}

function thinBorder() {
  return {
    top: { style: "thin", color: { argb: "FFD4D4D8" } },
    left: { style: "thin", color: { argb: "FFD4D4D8" } },
    bottom: { style: "thin", color: { argb: "FFD4D4D8" } },
    right: { style: "thin", color: { argb: "FFD4D4D8" } },
  } as const;
}

function hexToArgb(hex: string) {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Self-test failed: ${message}`);
  }
}

function runSelfTests() {
  assert(clamp(5, 0, 3) === 3, "clamp upper bound");
  assert(clamp(-1, 0, 3) === 0, "clamp lower bound");
  assert(quantizeGray(255, 5) === 0, "white maps to 0");
  assert(quantizeGray(0, 5) === 5, "black maps to max");
  assert(matrixToCsv([[0, 1], [2, 3]]) === "0,1\n2,3", "csv conversion");
  assert(tileMatrix([[1, 2]], 2, 2).length === 2, "tile row count");
  assert(tileMatrix([[1, 2]], 2, 2)[0].join(",") === "1,2,1,2", "tile content");
  assert(adjustRows([[1, 2]], 2).length === 2, "adjust rows expand");
  assert(adjustRows([[1, 2], [3, 4]], 1).length === 1, "adjust rows shrink");
  const shaped = generateShapedMatrix(10, 6, 1, 4, 8, 6, 1, 0);
  assert(shaped.length === 6, "shaped row count");
  assert(shaped[0].filter((v) => v === 1).length === 4, "first row stitches");
  assert(shaped[1].filter((v) => v === 1).length === 5, "first increase row stitches");
  assert(shaped[5].filter((v) => v === 1).length === 8, "end shaping row stitches");
  assert(shaped[5].filter((v) => v === 1).length === 8, "post shaping rows keep end stitches");
  const steps = buildIncreaseSteps(1, 8, 18, 28);
  assert(steps[0].row === 1 && steps[0].occurrence === 0, "baseline step exists");
  assert(steps[1].row === 2, "first increase row");
  assert(steps[2].row === 4, "short interval sequence");
  assert(steps[steps.length - 1].row === 28, "last increase row");
  assert(steps[steps.length - 1].occurrence === 10, "occurrence count");
}

if (process.env.NODE_ENV === "test") {
  runSelfTests();
}

async function loadExcelJS(): Promise<ExcelJsLike> {
  const mod: any = await import("exceljs");
  if (mod?.Workbook && typeof mod.Workbook === "function") return mod as ExcelJsLike;
  if (mod?.default?.Workbook && typeof mod.default.Workbook === "function") return mod.default as ExcelJsLike;
  throw new Error("ExcelJS Workbook constructor를 찾지 못했습니다.");
}

export default function Page() {
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const [gridColsInput, setGridColsInput] = useState("");
  const [gridRowsInput, setGridRowsInput] = useState("");
  const [noGauge, setNoGauge] = useState(false);
  const [gridStepComplete, setGridStepComplete] = useState(false);

  const [seedMatrix, setSeedMatrix] = useState<Matrix>([]);
  const [overlayMatrix, setOverlayMatrix] = useState<OverlayMatrix>([]);
  const [historyPast, setHistoryPast] = useState<Matrix[]>([]);
  const [historyFuture, setHistoryFuture] = useState<Matrix[]>([]);

  const [maxColorValue, setMaxColorValue] = useState(1);
  const [activeValue, setActiveValue] = useState(1);
  const [palette, setPalette] = useState<Palette>(defaultPalette);

  const [repeatXInput, setRepeatXInput] = useState("");
  const [repeatYInput, setRepeatYInput] = useState("");

  const [isPainting, setIsPainting] = useState(false);
  const [paintMode, setPaintMode] = useState<"draw" | "erase">("draw");
  const [hasGeneratedPattern, setHasGeneratedPattern] = useState(false);

  const [stitchesPer10cmInput, setStitchesPer10cmInput] = useState("");
  const [rowsPer10cmInput, setRowsPer10cmInput] = useState("");

  const [shapeStartRowInput, setShapeStartRowInput] = useState("1");
  const [shapeStartStitchesInput, setShapeStartStitchesInput] = useState("");
  const [totalIncreaseStitchesInput, setTotalIncreaseStitchesInput] = useState("");
  const [shapeEndRowInput, setShapeEndRowInput] = useState("");
  const [shapeFillValue, setShapeFillValue] = useState(1);
  const [shapeBgValue, setShapeBgValue] = useState(0);
  const [disableYokeAutoPattern, setDisableYokeAutoPattern] = useState(false);
  const [useMainColorPreset, setUseMainColorPreset] = useState(false);

  const pdfRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const seedMatrixRef = useRef<Matrix>([]);
  const overlayMatrixRef = useRef<OverlayMatrix>([]);
  const yokeMaskRef = useRef<Matrix>([]);
  const paintStartMatrixRef = useRef<Matrix | null>(null);
  const paintChangedRef = useRef(false);
  const gridCols = Math.max(1, Number(gridColsInput) || 24);
  const gridRows = Math.max(1, Number(gridRowsInput) || 24);
  const repeatX = Math.max(1, Number(repeatXInput) || 1);
  const repeatY = Math.max(1, Number(repeatYInput) || 1);
  const shapeStartRow = clamp(Number(shapeStartRowInput) || 1, 1, gridRows);
  const shapeStartStitches = clamp(Number(shapeStartStitchesInput) || 12, 0, gridCols);
  const totalIncreaseStitches = Math.max(0, Number(totalIncreaseStitchesInput) || 6);
  const shapeEndRow = clamp(Number(shapeEndRowInput) || 24, shapeStartRow, gridRows);
  const shapeEndStitches = shapeStartStitches + totalIncreaseStitches;
  const hasYokeInputs =
    shapeStartRowInput.trim() !== "" &&
    shapeEndRowInput.trim() !== "" &&
    totalIncreaseStitchesInput.trim() !== "";
  const hasGaugeInputs =
    noGauge ||
    stitchesPer10cmInput.trim() !== "" ||
    rowsPer10cmInput.trim() !== "";

  const stitchesPer10cm = Math.max(0.1, Number(stitchesPer10cmInput) || 25);
  const rowsPer10cm = Math.max(0.1, Number(rowsPer10cmInput) || 33);
  const stitchesPerCm = stitchesPer10cm / 10;
  const rowsPerCm = rowsPer10cm / 10;
  const cellWidthCm = noGauge ? 1.5 : 1 / stitchesPerCm;
  const cellHeightCm = noGauge ? 1 : 1 / rowsPerCm;
  const cellWidthPx = Math.max(12, cellWidthCm * CM_TO_PX);
  const cellHeightPx = Math.max(10, cellHeightCm * CM_TO_PX);

  const baseOutputMatrix = useMemo(() => {
    if (!seedMatrix.length) return [];
    return tileMatrix(seedMatrix, repeatX, repeatY);
  }, [seedMatrix, repeatX, repeatY]);
  const outputOverlayMatrix = useMemo(() => {
    if (!overlayMatrix.length) return [];
    return tileOverlayMatrix(overlayMatrix, repeatX, repeatY);
  }, [overlayMatrix, repeatX, repeatY]);
  const outputMatrix = useMemo(() => {
    if (!baseOutputMatrix.length) return [];
    if (!outputOverlayMatrix.length) return baseOutputMatrix;
    return composeMatrices(baseOutputMatrix, outputOverlayMatrix);
  }, [baseOutputMatrix, outputOverlayMatrix]);
  const displaySeedMatrix = useMemo(() => {
    if (!seedMatrix.length) return [];
    if (!overlayMatrix.length) return seedMatrix;
    return composeMatrices(seedMatrix, overlayMatrix);
  }, [seedMatrix, overlayMatrix]);

  const increaseSteps = useMemo(
    () => buildIncreaseSteps(shapeStartRow, shapeStartStitches, shapeEndStitches, shapeEndRow),
    [shapeStartRow, shapeStartStitches, shapeEndStitches, shapeEndRow]
  );
  const visibleIncreaseSteps = useMemo(
    () => increaseSteps.filter((step) => step.stitches !== 0),
    [increaseSteps]
  );
  const increaseSummaryText = useMemo(() => {
    if (!visibleIncreaseSteps.length) return "";

    const summary = new Map<string, { gap: number; stitches: number; count: number }>();
    let previousRow = shapeStartRow - 1;

    for (const step of visibleIncreaseSteps) {
      const gap = step.row - previousRow;
      const stitches = Math.abs(step.stitches);
      const key = `${gap}-${stitches}`;
      const current = summary.get(key);

      if (current) {
        current.count += 1;
      } else {
        summary.set(key, { gap, stitches, count: 1 });
      }

      previousRow = step.row;
    }

    return Array.from(summary.values())
      .sort((a, b) => a.gap - b.gap)
      .map((item) => `${item.gap}-${item.stitches}-${item.count}회`)
      .join("  ");
  }, [shapeStartRow, visibleIncreaseSteps]);
  const paletteOptions = useMemo<PaletteOption[]>(
    () => Array.from({ length: maxColorValue }, (_, i) => ({ value: i + 1, color: palette[i + 1] })),
    [maxColorValue, palette]
  );
  const totalChange = totalIncreaseStitches;

  const patternWidthMm = outputMatrix[0]?.length ? outputMatrix[0].length * cellWidthCm * 10 : 0;
  const patternHeightMm = outputMatrix.length ? outputMatrix.length * cellHeightCm * 10 : 0;
  const contentWidthMm = A4_WIDTH_MM - A4_MARGIN_MM * 2;
  const contentHeightMm = A4_HEIGHT_MM - A4_MARGIN_MM * 2;
  const pdfScale = patternWidthMm && patternHeightMm
    ? Math.min(contentWidthMm / patternWidthMm, contentHeightMm / patternHeightMm, 1)
    : 1;

  useEffect(() => {
    seedMatrixRef.current = seedMatrix;
  }, [seedMatrix]);

  useEffect(() => {
    overlayMatrixRef.current = overlayMatrix;
  }, [overlayMatrix]);

  useEffect(() => {
    const up = () => {
      setIsPainting(false);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  useEffect(() => {
    if (isPainting) return;
    if (!paintStartMatrixRef.current || !paintChangedRef.current) {
      paintStartMatrixRef.current = null;
      paintChangedRef.current = false;
      return;
    }

    const before = paintStartMatrixRef.current;
    const after = seedMatrixRef.current;
    if (!matricesEqual(before, after)) {
      setHistoryPast((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), cloneMatrix(before)]);
      setHistoryFuture([]);
    }

    paintStartMatrixRef.current = null;
    paintChangedRef.current = false;
  }, [isPainting]);

  useEffect(() => {
    if (shapeStartRowInput) {
      setShapeStartRowInput(String(clamp(Number(shapeStartRowInput) || 1, 1, gridRows)));
    }
    if (shapeEndRowInput) {
      setShapeEndRowInput(String(clamp(Number(shapeEndRowInput) || shapeStartRow, shapeStartRow, gridRows)));
    }
  }, [gridRows]);

  useEffect(() => {
    setActiveValue((prev) => clamp(prev, 0, maxColorValue));
    setShapeFillValue((prev) => clamp(prev, 0, maxColorValue));
    setShapeBgValue((prev) => clamp(prev, 0, maxColorValue));
  }, [maxColorValue]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod) return;

      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        if (!historyPast.length) return;
        const previous = historyPast[historyPast.length - 1];
        setHistoryPast((prev) => prev.slice(0, -1));
        setHistoryFuture((prev) => [cloneMatrix(seedMatrixRef.current), ...prev]);
        setSeedMatrix(cloneMatrix(previous));
        return;
      }

      if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        if (!historyFuture.length) return;
        const [next, ...rest] = historyFuture;
        setHistoryFuture(rest);
        setHistoryPast((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), cloneMatrix(seedMatrixRef.current)]);
        setSeedMatrix(cloneMatrix(next));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [historyFuture, historyPast]);

  const replaceSeedMatrix = (nextMatrix: Matrix, options?: { recordHistory?: boolean }) => {
    const recordHistory = options?.recordHistory ?? true;
    const current = seedMatrixRef.current;
    if (matricesEqual(current, nextMatrix)) return;
    if (recordHistory) {
      setHistoryPast((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), cloneMatrix(current)]);
      setHistoryFuture([]);
    }
    setSeedMatrix(cloneMatrix(nextMatrix));
  };

  const undo = () => {
    if (!historyPast.length) return;
    const previous = historyPast[historyPast.length - 1];
    setHistoryPast((prev) => prev.slice(0, -1));
    setHistoryFuture((prev) => [cloneMatrix(seedMatrixRef.current), ...prev]);
    setSeedMatrix(cloneMatrix(previous));
  };

  const redo = () => {
    if (!historyFuture.length) return;
    const [next, ...rest] = historyFuture;
    setHistoryFuture(rest);
    setHistoryPast((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), cloneMatrix(seedMatrixRef.current)]);
    setSeedMatrix(cloneMatrix(next));
  };

  const processImage = (src: string, cols: number, rows: number) => {
    const img = new Image();

    img.onload = () => {
      const safeRows = Math.max(1, rows);
      const fittedRows = Math.max(1, Math.round((img.height / img.width) * cols));
      const sampledRows = Math.min(safeRows, fittedRows);
      const maskMatrix =
        yokeMaskRef.current.length === safeRows && yokeMaskRef.current[0]?.length === cols
          ? yokeMaskRef.current
          : seedMatrixRef.current.length === safeRows && seedMatrixRef.current[0]?.length === cols
            ? seedMatrixRef.current
            : Array.from({ length: safeRows }, () => Array.from({ length: cols }, () => 0));

      const canvas = document.createElement("canvas");
      canvas.width = cols;
      canvas.height = sampledRows;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setStatus("이미지 처리 실패");
        return;
      }

      ctx.drawImage(img, 0, 0, cols, sampledRows);
      const { data } = ctx.getImageData(0, 0, cols, sampledRows);

      const next = createEmptyOverlay(safeRows, cols);
      for (let y = 0; y < sampledRows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          if (maskMatrix[y]?.[x] !== 1) continue;
          const i = (y * cols + x) * 4;
          const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
          next[y][x] = quantizeGray(gray, maxColorValue);
        }
      }

      setOverlayMatrix(next);
      setRepeatXInput("1");
      setRepeatYInput("1");
      setHasGeneratedPattern(true);
      setStatus(
        fittedRows > safeRows
          ? "메인 실색(1)을 유지한 채 이미지 색을 잘라서 추가했습니다."
          : "메인 실색(1)을 유지한 채 이미지 색을 추가했습니다."
      );
    };

    img.onerror = () => setStatus("이미지를 불러오지 못했습니다.");
    img.src = src;
  };

  const applyImportedMatrix = (sourceMatrix: Matrix, sourceLabel: string) => {
    const safeRows = Math.max(1, gridRows);
    const safeCols = Math.max(1, gridCols);
    const maskMatrix =
      yokeMaskRef.current.length === safeRows && yokeMaskRef.current[0]?.length === safeCols
        ? yokeMaskRef.current
        : seedMatrixRef.current.length === safeRows && seedMatrixRef.current[0]?.length === safeCols
          ? seedMatrixRef.current
          : Array.from({ length: safeRows }, () => Array.from({ length: safeCols }, () => 0));

    const next = createEmptyOverlay(safeRows, safeCols);
    const sourceRows = sourceMatrix.length;
    const sourceCols = sourceMatrix[0]?.length ?? 0;
    const appliedRows = Math.min(sourceRows, safeRows);
    const appliedCols = Math.min(sourceCols, safeCols);

    for (let y = 0; y < appliedRows; y += 1) {
      for (let x = 0; x < appliedCols; x += 1) {
        if (maskMatrix[y]?.[x] !== 1) continue;
        next[y][x] = clamp(Math.round(sourceMatrix[y][x] ?? 0), 0, maxColorValue);
      }
    }

    setOverlayMatrix(next);
    setRepeatXInput("1");
    setRepeatYInput("1");
    setHasGeneratedPattern(true);
    setStatus(
      sourceRows > safeRows || sourceCols > safeCols
        ? `${sourceLabel} 값을 현재 그리드에 맞춰 잘라서 추가했습니다.`
        : `${sourceLabel} 값을 현재 그리드에 추가했습니다.`
    );
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const matrix = parseDelimitedMatrix(text);
    if (!matrix.length || !matrix[0]?.length) {
      setStatus("CSV에서 읽을 값이 없습니다.");
      return;
    }
    applyImportedMatrix(matrix, "CSV");
  };

  const importXlsx = async (file: File) => {
    try {
      const ExcelJS = await loadExcelJS();
      const workbook: any = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.getWorksheet?.(1);
      if (!worksheet) {
        setStatus("XLSX 시트를 찾지 못했습니다.");
        return;
      }

      const rowCount = worksheet.actualRowCount ?? worksheet.rowCount ?? 0;
      const colCount = worksheet.actualColumnCount ?? worksheet.columnCount ?? 0;
      const matrix: Matrix = Array.from({ length: rowCount }, (_, rowIndex) =>
        Array.from({ length: colCount }, (_, colIndex) => {
          const cell = worksheet.getRow(rowIndex + 1).getCell(colIndex + 1);
          const rawValue =
            typeof cell.value === "object" && cell.value && "result" in cell.value
              ? cell.value.result
              : cell.value;
          const numericValue = Number(rawValue);
          return Number.isFinite(numericValue) ? numericValue : 0;
        })
      );

      if (!matrix.length || !matrix[0]?.length) {
        setStatus("XLSX에서 읽을 값이 없습니다.");
        return;
      }

      applyImportedMatrix(matrix, "XLSX");
    } catch (error) {
      console.error(error);
      setStatus("XLSX를 불러오지 못했습니다.");
    }
  };

  const handleImportFile = async (file?: File) => {
    if (!file) return;

    try {
      const name = file.name.toLowerCase();
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          const src = String(reader.result);
          setImage(src);
          processImage(src, Math.max(1, gridCols), Math.max(1, gridRows));
          if (importInputRef.current) {
            importInputRef.current.value = "";
          }
        };
        reader.readAsDataURL(file);
        return;
      }

      if (name.endsWith(".csv")) {
        await importCsv(file);
      } else if (name.endsWith(".xlsx")) {
        await importXlsx(file);
      } else {
        setStatus("이미지, CSV, XLSX 파일만 불러올 수 있습니다.");
      }
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  };

  useEffect(() => {
    if (!image) return;
    processImage(image, Math.max(1, gridCols), Math.max(1, gridRows));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridCols, gridRows, maxColorValue]);

  const handleRowsChange = (raw: string) => {
    setGridRowsInput(raw);
    const nextRows = Math.max(1, Number(raw) || 1);
    setGridStepComplete(false);
    if (seedMatrixRef.current.length) {
      replaceSeedMatrix(adjustRows(seedMatrixRef.current, nextRows, shapeBgValue));
    }
    if (overlayMatrixRef.current.length) {
      setOverlayMatrix((prev) => {
        if (!prev.length) return prev;
        const cols = prev[0].length;
        if (nextRows === prev.length) return prev;
        if (nextRows < prev.length) return prev.slice(0, nextRows);
        const extra = Array.from({ length: nextRows - prev.length }, () => Array.from({ length: cols }, () => null));
        return [...prev, ...extra];
      });
    }
  };

  const paint = (r: number, c: number, val: number) => {
    setSeedMatrix((prev) => {
      const next = prev.map((row, i) => row.map((cell, j) => (i === r && j === c ? val : cell)));
      paintChangedRef.current = paintChangedRef.current || !matricesEqual(prev, next);
      seedMatrixRef.current = next;
      return next;
    });
  };

  const beginPaint = (r: number, c: number, button: number) => {
    const nextMode = button === 2 ? "erase" : "draw";
    setPaintMode(nextMode);
    paintStartMatrixRef.current = cloneMatrix(seedMatrixRef.current);
    paintChangedRef.current = false;
    setIsPainting(true);
    paint(r, c, nextMode === "erase" ? shapeBgValue : activeValue);
  };

  const continuePaint = (r: number, c: number) => {
    if (!isPainting) return;
    paint(r, c, paintMode === "erase" ? shapeBgValue : activeValue);
  };

  const clearPattern = () => {
    if (!seedMatrix.length) return;
    replaceSeedMatrix(seedMatrix.map((row) => row.map(() => shapeBgValue)));
    setOverlayMatrix(createEmptyOverlay(seedMatrix.length, seedMatrix[0]?.length ?? 0));
    setStatus("패턴을 비웠습니다.");
  };

  const buildGridPattern = () => {
    if (disableYokeAutoPattern) {
      const next = Array.from({ length: Math.max(1, gridRows) }, () =>
        Array.from({ length: Math.max(1, gridCols) }, () => 0)
      );
      replaceSeedMatrix(next);
      setOverlayMatrix(createEmptyOverlay(Math.max(1, gridRows), Math.max(1, gridCols)));
      setRepeatXInput("1");
      setRepeatYInput("1");
      setHasGeneratedPattern(true);
      setStatus("빈 그리드를 생성했습니다.");
      return;
    }

    const next = generateShapedMatrix(
      Math.max(1, gridCols),
      Math.max(1, gridRows),
      shapeStartRow,
      shapeStartStitches,
      shapeEndStitches,
      shapeEndRow,
      clamp(useMainColorPreset ? 1 : shapeFillValue, 0, maxColorValue),
      clamp(shapeBgValue, 0, maxColorValue)
    );
    yokeMaskRef.current = cloneMatrix(next);
    replaceSeedMatrix(next);
    setOverlayMatrix(createEmptyOverlay(next.length, next[0]?.length ?? 0));
    setRepeatXInput("1");
    setRepeatYInput("1");
    setHasGeneratedPattern(true);
    setStatus("그리드 시작 패턴을 생성했습니다.");
  };

  const setPaletteCount = (nextCount: number) => {
    const clampedCount = clamp(nextCount, 1, MAX_VALUE);
    setMaxColorValue(clampedCount);
  };

  const deleteSelectedPaletteColor = () => {
    if (maxColorValue <= 1) return;

    setPalette((prev) => {
      const next: Palette = { ...prev, 0: prev[0] };
      let target = 1;

      for (let source = 1; source <= maxColorValue; source += 1) {
        if (source === activeValue) continue;
        next[target] = prev[source];
        target += 1;
      }

      for (let value = target; value <= MAX_VALUE; value += 1) {
        if (!(value in defaultPalette)) continue;
        next[value] = defaultPalette[value];
      }

      return next;
    });

    setMaxColorValue((prev) => Math.max(1, prev - 1));
    setActiveValue((prev) => clamp(prev > activeValue ? prev - 1 : prev, 1, Math.max(1, maxColorValue - 1)));
  };

  const openPreviewWindow = () => {
    if (!outputMatrix.length) return;
    const previewWindow = window.open("", "_blank", "noopener,noreferrer,width=1200,height=900");
    if (!previewWindow) {
      setStatus("미리보기 창을 열지 못했습니다.");
      return;
    }

    const gridTemplateColumns = `repeat(${outputMatrix[0].length}, ${Math.round(cellWidthPx)}px)`;
    const cells = outputMatrix.flatMap((row) =>
      row.map((cell) => {
        const bg = palette[cell];
        const fg = getContrastColor(bg);
        return `<div class="cell" style="background:${bg};color:${fg};width:${cellWidthPx}px;height:${cellHeightPx}px;">${cell}</div>`;
      })
    ).join("");

    previewWindow.document.write(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>패턴 미리보기</title>
    <style>
      body { margin: 0; padding: 24px; background: #f8fafc; color: #111827; font-family: Arial, Helvetica, sans-serif; }
      .page { display: grid; gap: 16px; }
      .meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 14px; color: #4b5563; }
      .frame { overflow: auto; padding: 16px; border-radius: 16px; border: 1px solid #e5e7eb; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
      .grid { display: grid; grid-template-columns: ${gridTemplateColumns}; gap: 1px; width: max-content; background: #d4d4d8; }
      .cell { display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; box-sizing: border-box; border: 1px solid rgba(0,0,0,0.06); }
    </style>
  </head>
  <body>
    <div class="page">
      <h1 style="margin:0;font-size:28px;">패턴 미리보기</h1>
      <div class="meta">
        <span>전체 코수: ${outputMatrix[0].length}</span>
        <span>전체 단수: ${outputMatrix.length}</span>
        <span>셀 크기: ${cellWidthPx.toFixed(1)}px × ${cellHeightPx.toFixed(1)}px</span>
      </div>
      <div class="frame">
        <div class="grid">${cells}</div>
      </div>
    </div>
  </body>
</html>`);
    previewWindow.document.close();
  };

  const downloadCsv = () => {
    if (!outputMatrix.length) return;
    downloadBlob(
      `pattern-${Date.now()}.csv`,
      new Blob([matrixToCsv(outputMatrix)], { type: "text/csv;charset=utf-8" })
    );
  };

  const downloadXlsx = async () => {
    if (!outputMatrix.length) return;
    try {
      const ExcelJS = await loadExcelJS();
      const workbook = new ExcelJS.Workbook();
      const valuesSheet = workbook.addWorksheet("Values");
      const patternSheet = workbook.addWorksheet("Pattern");

      const rows = outputMatrix.length;
      const cols = outputMatrix[0].length;
      const excelColWidth = Math.max(2, cellWidthCm * 4.2);
      const excelRowHeight = Math.max(8, cellHeightCm * CM_TO_PT);

      valuesSheet.pageSetup = {
        paperSize: 9,
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
      };
      patternSheet.pageSetup = {
        paperSize: 9,
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
      };

      for (let c = 1; c <= cols; c += 1) {
        valuesSheet.getColumn(c).width = excelColWidth;
        patternSheet.getColumn(c).width = excelColWidth;
      }
      for (let r = 1; r <= rows; r += 1) {
        valuesSheet.getRow(r).height = excelRowHeight;
        patternSheet.getRow(r).height = excelRowHeight;
      }

      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const value = outputMatrix[r][c];
          const valuesCell = valuesSheet.getCell(r + 1, c + 1);
          valuesCell.value = value;
          valuesCell.alignment = { horizontal: "center", vertical: "middle" };
          valuesCell.border = thinBorder();

          const patternCell = patternSheet.getCell(r + 1, c + 1);
          patternCell.value = { formula: `Values!${valuesCell.address}`, result: value };
          patternCell.alignment = { horizontal: "center", vertical: "middle" };
          patternCell.border = thinBorder();
        }
      }

      const rules = Array.from({ length: maxColorValue + 1 }, (_, value) => ({
        type: "cellIs",
        operator: "equal",
        formulae: [String(value)],
        style: {
          fill: {
            type: "pattern",
            pattern: "solid",
            bgColor: { argb: hexToArgb(palette[value]) },
            fgColor: { argb: hexToArgb(palette[value]) },
          },
          font: { color: { argb: value === 0 ? "FF111111" : "FFFFFFFF" } },
        },
      }));

      const lastCell = patternSheet.getCell(rows, cols).address;
      patternSheet.addConditionalFormatting?.({ ref: `A1:${lastCell}`, rules });

      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        `pattern-${Date.now()}.xlsx`,
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      );
      setStatus("XLSX 저장 완료");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? `XLSX 저장 실패: ${error.message}` : "XLSX 저장 실패");
    }
  };

  const downloadPdf = async () => {
    if (!outputMatrix.length || !pdfRef.current) return;
    try {
      const html2canvas = (await import("html2canvas")).default;
      const jspdfModule: any = await import("jspdf/dist/jspdf.umd.min.js");
const { jsPDF } = jspdfModule;
      const canvas = await html2canvas(pdfRef.current, { scale: 2, backgroundColor: "#ffffff" });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const imgData = canvas.toDataURL("image/png");
      const renderWidth = patternWidthMm * pdfScale;
      const renderHeight = patternHeightMm * pdfScale;
      const x = A4_MARGIN_MM + (contentWidthMm - renderWidth) / 2;
      const y = A4_MARGIN_MM + (contentHeightMm - renderHeight) / 2;
      pdf.addImage(imgData, "PNG", x, y, renderWidth, renderHeight);
      pdf.save(`pattern-${Date.now()}.pdf`);
      setStatus("PDF 저장 완료");
    } catch (error) {
      console.error(error);
      setStatus("PDF 저장 실패");
    }
  };

  return (
    <div style={styles.page} onContextMenu={(e) => e.preventDefault()}>
      <div style={styles.container}>
        <header>
          <Link href="/" style={styles.homeLink}>
            ← 메인으로
          </Link>
          <h1 style={styles.h1}>뜨개 패턴 생성기</h1>
          <p style={styles.subtext}>게이지와 그리드를 먼저 정하고, 필요하면 이미지를 현재 셀 위에 덮어써서 패턴을 만들 수 있습니다.</p>
          {status ? <p style={styles.status}>{status}</p> : null}
        </header>

        <div style={styles.layout}>
          <aside style={styles.sidebar}>
            <Panel title="게이지">
              <label style={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={noGauge}
                  onChange={(e) => {
                    setNoGauge(e.target.checked);
                    setGridStepComplete(false);
                  }}
                />
                아직 게이지 없음
              </label>
              <LabelRow label="10cm당 코">
                <input
                  type="number"
                  step="0.1"
                  placeholder=""
                  disabled={noGauge}
                  value={stitchesPer10cmInput}
                  onChange={(e) => {
                    setStitchesPer10cmInput(e.target.value);
                    setGridStepComplete(false);
                  }}
                  style={{
                    ...styles.input,
                    background: noGauge ? "#f3f4f6" : "#fff",
                    color: noGauge ? "#9ca3af" : "#111827",
                    cursor: noGauge ? "not-allowed" : "text",
                  }}
                />
              </LabelRow>
              <LabelRow label="10cm당 단">
                <input
                  type="number"
                  step="0.1"
                  placeholder=""
                  disabled={noGauge}
                  value={rowsPer10cmInput}
                  onChange={(e) => {
                    setRowsPer10cmInput(e.target.value);
                    setGridStepComplete(false);
                  }}
                  style={{
                    ...styles.input,
                    background: noGauge ? "#f3f4f6" : "#fff",
                    color: noGauge ? "#9ca3af" : "#111827",
                    cursor: noGauge ? "not-allowed" : "text",
                  }}
                />
              </LabelRow>
              {hasGaugeInputs ? (
                <div style={styles.noteBox}>
                  {noGauge ? <div>자동 게이지: 가로 1.5 / 세로 1 비율</div> : null}
                  <div>셀 가로: {cellWidthCm.toFixed(3)}cm</div>
                  <div>셀 세로: {cellHeightCm.toFixed(3)}cm</div>
                  <div>미리보기 셀: {cellWidthPx.toFixed(1)}px × {cellHeightPx.toFixed(1)}px</div>
                </div>
              ) : null}
            </Panel>

            <Panel title="그리드 셀 수">
              <LabelRow label="전체 코수">
                <input
                  type="number"
                  min={1}
                  placeholder=""
                  value={gridColsInput}
                  onChange={(e) => {
                    setGridColsInput(e.target.value);
                    setGridStepComplete(false);
                  }}
                  style={styles.input}
                />
              </LabelRow>
              <LabelRow label="시작 코수">
                <input
                  type="number"
                  min={0}
                  max={gridCols}
                  placeholder=""
                  value={shapeStartStitchesInput}
                  onChange={(e) => setShapeStartStitchesInput(e.target.value)}
                  style={styles.input}
                />
              </LabelRow>
              <LabelRow label="전체 단수">
                <input
                  type="number"
                  min={1}
                  placeholder=""
                  value={gridRowsInput}
                  onChange={(e) => handleRowsChange(e.target.value)}
                  style={styles.input}
                />
              </LabelRow>
              <div style={styles.helperText}>
                전체 코수와 전체 단수는 셀 색(0) 그리드 크기이고, 시작 코수는 메인 실 색(1) 셀의 시작 가로 폭입니다.
              </div>
              <button onClick={() => setGridStepComplete(true)} style={styles.primaryButton}>
                다음 설정 보기
              </button>
            </Panel>

            {gridStepComplete ? (
              <>
                <Panel title="요크 패턴 줄임 설정">
                  <label style={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={disableYokeAutoPattern}
                      onChange={(e) => setDisableYokeAutoPattern(e.target.checked)}
                    />
                    요크 자동 패턴 설정 안함
                  </label>
                  {!disableYokeAutoPattern ? (
                    <>
                      <LabelRow label="시작단">
                        <input
                      type="number"
                      min={1}
                      max={gridRows}
                      placeholder="1"
                      value={shapeStartRowInput}
                          onChange={(e) => {
                            setShapeStartRowInput(e.target.value);
                          }}
                          style={styles.input}
                        />
                      </LabelRow>
                      <LabelRow label="늘림 마지막 단">
                        <input
                          type="number"
                          min={1}
                          max={gridRows}
                          placeholder=""
                          value={shapeEndRowInput}
                          onChange={(e) => setShapeEndRowInput(e.target.value)}
                          style={styles.input}
                        />
                      </LabelRow>
                      <LabelRow label="총 늘림코">
                        <input
                          type="number"
                          min={0}
                          placeholder=""
                          value={totalIncreaseStitchesInput}
                          onChange={(e) => setTotalIncreaseStitchesInput(e.target.value)}
                          style={styles.input}
                        />
                      </LabelRow>
                      <label style={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={useMainColorPreset}
                          onChange={(e) => setUseMainColorPreset(e.target.checked)}
                    />
                    메인 실 색 미리 지정하기
                  </label>
                  {useMainColorPreset ? (
                    <div style={styles.presetPaletteRow}>
                      <div style={styles.presetPaletteItem}>
                        <span style={styles.presetPaletteLabel}>셀 색(0)</span>
                        <input
                          type="color"
                          value={palette[0]}
                          onChange={(e) => setPalette((prev) => ({ ...prev, 0: e.target.value }))}
                          style={styles.presetColorInput}
                          title="셀 색(0) 변경"
                        />
                      </div>
                      <div style={styles.palettePipe}>|</div>
                      <div style={styles.presetPaletteItem}>
                        <span style={styles.presetPaletteLabel}>메인 실 색(1)</span>
                        <input
                          type="color"
                          value={palette[1]}
                          onChange={(e) => setPalette((prev) => ({ ...prev, 1: e.target.value }))}
                          style={styles.presetColorInput}
                          title="메인 실 색(1) 변경"
                        />
                      </div>
                    </div>
                      ) : null}
                      {hasYokeInputs ? (
                        <>
                          <div style={styles.noteBox}>
                            <div>시작단: {shapeStartRow}단</div>
                            <div>늘림 마지막 단: {shapeEndRow}단</div>
                            <div>총 늘림코: {Math.abs(totalChange)}코</div>
                            {increaseSummaryText ? <div>요약: {increaseSummaryText}</div> : null}
                          </div>
                          <div style={styles.tableWrap}>
                            {visibleIncreaseSteps.length ? (
                              <table style={styles.table}>
                                <thead>
                                  <tr>
                                    <th style={styles.tableHead}>단</th>
                                    <th style={styles.tableHead}>코</th>
                                    <th style={styles.tableHead}>회</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {visibleIncreaseSteps.map((step) => (
                                    <tr key={`${step.row}-${step.occurrence}`}>
                                      <td style={styles.tableCell}>{step.row}단</td>
                                      <td style={styles.tableCell}>{Math.abs(step.stitches)}코</td>
                                      <td style={styles.tableCell}>{step.occurrence}회</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <div style={styles.scheduleEmpty}>늘림 구간이 없습니다.</div>
                            )}
                          </div>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <div style={styles.tableWrap}>
                      <div style={styles.scheduleEmpty}>요크 자동 패턴 설정이 꺼져 있습니다.</div>
                    </div>
                  )}
                  <button onClick={buildGridPattern} style={styles.primaryButton}>그리드 생성</button>
                </Panel>

                {hasGeneratedPattern ? (
                  <Panel title="반복 패턴">
                    <LabelRow label="반복 X">
                      <input
                        type="number"
                        min={1}
                        placeholder=""
                        value={repeatXInput}
                        onChange={(e) => setRepeatXInput(e.target.value)}
                        style={styles.input}
                      />
                    </LabelRow>
                    <LabelRow label="반복 Y">
                      <input
                        type="number"
                        min={1}
                        placeholder=""
                        value={repeatYInput}
                        onChange={(e) => setRepeatYInput(e.target.value)}
                        style={styles.input}
                      />
                    </LabelRow>
                    <button onClick={clearPattern} style={styles.secondaryButton}>원본 패턴 비우기</button>
                  </Panel>
                ) : null}
              </>
            ) : null}
          </aside>

          <main style={styles.main}>
            <Panel title="원본 패턴 편집 영역">
              {!seedMatrix.length ? (
                <div style={styles.empty}>이미지를 올리거나 그리드 패턴을 생성하면 여기에 편집 패턴이 생성됩니다.</div>
              ) : (
                <>
                  <div style={styles.editorTopBar}>
                    <div style={styles.editorTopBarLeft}>
                      <span style={styles.editorTopBarTitle}>색상 설정</span>
                    </div>
                    <div style={styles.editorTopBarRight}>
                      <input
                        ref={importInputRef}
                        type="file"
                        accept="image/*,.csv,.xlsx"
                        onChange={(e) => {
                          void handleImportFile(e.target.files?.[0]);
                        }}
                        style={styles.hiddenFileInput}
                      />
                      <IconActionButton
                        label="파일 불러오기"
                        onClick={() => importInputRef.current?.click()}
                        disabled={!gridStepComplete}
                        icon={<ImagePlusIcon />}
                      />
                      <IconActionButton
                        label="실행 취소"
                        onClick={undo}
                        disabled={!historyPast.length}
                        icon={<Undo2 size={18} strokeWidth={2} />}
                      />
                      <IconActionButton
                        label="다시 실행"
                        onClick={redo}
                        disabled={!historyFuture.length}
                        icon={<Redo2 size={18} strokeWidth={2} />}
                      />
                      <IconActionButton
                        label="CSV 다운로드"
                        onClick={downloadCsv}
                        disabled={!outputMatrix.length}
                        icon={<FileText size={18} strokeWidth={2} />}
                      />
                      <IconActionButton
                        label="XLSX 다운로드"
                        onClick={downloadXlsx}
                        disabled={!outputMatrix.length}
                        icon={<FileSpreadsheet size={18} strokeWidth={2} />}
                      />
                      <IconActionButton
                        label="PDF 다운로드"
                        onClick={downloadPdf}
                        disabled={!outputMatrix.length}
                        icon={<FileType2 size={18} strokeWidth={2} />}
                      />
                      <IconActionButton
                        label="미리보기 열기"
                        onClick={openPreviewWindow}
                        disabled={!outputMatrix.length}
                        icon={<Eye size={18} strokeWidth={2} />}
                      />
                    </div>
                  </div>
                  <div style={styles.paletteManager}>
                    <div style={styles.paletteManagerHeader}>
                      <div style={styles.paletteHeaderMeta}>
                        <LabelRow label="색 개수">
                          <input
                            type="number"
                            min={1}
                            max={MAX_VALUE}
                            placeholder=""
                            value={String(getPaletteCountLabel(maxColorValue))}
                            onChange={(e) => {
                              if (e.target.value === "") return;
                              setPaletteCount(Number(e.target.value) || 1);
                            }}
                            style={styles.paletteCountInput}
                          />
                        </LabelRow>
                        <div style={styles.mainColorBadge}>메인 실 색(1)</div>
                      </div>
                      <div style={styles.paletteManagerActions}>
                        <button
                          type="button"
                          onClick={deleteSelectedPaletteColor}
                          disabled={maxColorValue <= 1}
                          style={styles.secondaryButton}
                        >
                          색 삭제
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaletteCount(maxColorValue + 1)}
                          disabled={maxColorValue >= MAX_VALUE}
                          style={styles.secondaryButton}
                        >
                          색 추가
                        </button>
                      </div>
                    </div>
                    <div style={styles.paletteChipGrid}>
                      <div style={styles.fixedBackgroundChip}>
                        <span style={styles.fixedChipLabel}>셀 색(0)</span>
                        <span style={{ ...styles.paletteChipSwatch, background: palette[0] }} />
                      </div>
                      <div style={styles.palettePipe}>|</div>
                      {paletteOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setActiveValue(option.value)}
                          style={{
                            ...styles.paletteChip,
                            border: activeValue === option.value ? "2px solid #111827" : "1px solid #d1d5db",
                          }}
                          title={`색 ${option.value}`}
                        >
                          <span style={styles.paletteChipNumber}>{option.value}</span>
                          <span style={{ ...styles.paletteChipSwatch, background: option.color }} />
                          <input
                            type="color"
                            value={option.color}
                            onChange={(e) => setPalette((prev) => ({ ...prev, [option.value]: e.target.value }))}
                            onClick={(e) => e.stopPropagation()}
                            style={styles.colorToolInput}
                            title={`색 ${option.value} 수정`}
                          />
                          {option.value === 1 ? <span style={styles.mainChipTag}>메인</span> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={styles.gridScroll}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${seedMatrix[0].length}, ${cellWidthPx}px)`,
                        gap: 1,
                        background: "#d4d4d8",
                        width: "max-content",
                      }}
                    >
                      {seedMatrix.flatMap((row, r) =>
                        row.map((cell, c) => {
                          const displayCell = overlayMatrix[r]?.[c] ?? cell;
                          return (
                          <div
                            key={`${r}-${c}`}
                            onMouseDown={(e) => beginPaint(r, c, e.button)}
                            onMouseUp={() => setIsPainting(false)}
                            onMouseEnter={() => continuePaint(r, c)}
                            style={{
                              width: cellWidthPx,
                              height: cellHeightPx,
                              background: palette[displayCell],
                              cursor: "crosshair",
                              boxSizing: "border-box",
                              border: "1px solid rgba(0,0,0,0.06)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "transparent",
                              fontSize: 11,
                              userSelect: "none",
                              textShadow: "none",
                            }}
                          >
                            {displayCell}
                          </div>
                        );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}
            </Panel>
          </main>
        </div>
      </div>
      <div style={styles.hiddenPdfMount}>
        <div ref={pdfRef} style={styles.a4Page}>
          <div
            style={{
              width: `${patternWidthMm}mm`,
              height: `${patternHeightMm}mm`,
              transform: `scale(${pdfScale})`,
              transformOrigin: "top left",
              display: "grid",
              gridTemplateColumns: outputMatrix[0]?.length
                ? `repeat(${outputMatrix[0].length}, ${cellWidthCm}cm)`
                : undefined,
              gap: 0,
            }}
          >
            {outputMatrix.flatMap((row, r) =>
              row.map((cell, c) => (
                <div
                  key={`pdf-${r}-${c}`}
                  style={{
                    width: `${cellWidthCm}cm`,
                    height: `${cellHeightCm}cm`,
                    background: palette[cell],
                    border: "0.2mm solid rgba(0,0,0,0.12)",
                    boxSizing: "border-box",
                  }}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IconActionButton({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        ...styles.iconButton,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {icon}
    </button>
  );
}

function ImagePlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m3 15 4-4a2 2 0 0 1 2.828 0L14 15" />
      <path d="m14 14 1-1a2 2 0 0 1 2.828 0L21 16" />
      <path d="M14 3h7" />
      <path d="M17.5 6.5v-7" />
      <circle cx="9" cy="9" r="2" />
    </svg>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={styles.panel}>
      <h2 style={styles.panelTitle}>{title}</h2>
      <div style={styles.panelBody}>{children}</div>
    </section>
  );
}

function LabelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={styles.labelRow}>
      <div style={styles.labelText}>{label}</div>
      <div style={styles.labelControl}>{children}</div>
    </label>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8fafc", color: "#111827", fontFamily: "Arial, sans-serif", padding: 24 },
  container: { maxWidth: 1400, margin: "0 auto", display: "grid", gap: 20 },
  homeLink: { display: "inline-flex", alignItems: "center", marginBottom: 10, color: "#2563eb", textDecoration: "none", fontSize: 14, fontWeight: 600 },
  h1: { margin: 0, fontSize: 32, fontWeight: 700 },
  subtext: { marginTop: 8, color: "#4b5563" },
  status: { marginTop: 8, color: "#2563eb", fontSize: 14 },
  layout: { display: "grid", gridTemplateColumns: "400px 1fr", gap: 20, alignItems: "start" },
  sidebar: { display: "grid", gap: 16 },
  main: { display: "grid", gap: 16 },
  panel: { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" },
  panelTitle: { margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 700 },
  panelBody: { display: "grid", gap: 12 },
  previewImage: { maxWidth: "100%", borderRadius: 12, border: "1px solid #d1d5db" },
  input: { width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box" },
  labelRow: { display: "grid", gridTemplateColumns: "140px minmax(0, 1fr)", alignItems: "center", gap: 10 },
  labelText: { fontSize: 13, color: "#374151", whiteSpace: "nowrap" },
  labelControl: { minWidth: 0 },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14 },
  helperText: { fontSize: 12, color: "#6b7280", lineHeight: 1.6 },
  paletteGrid: { display: "grid", gap: 8 },
  noteBox: { background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 1.7, color: "#374151" },
  tableWrap: { maxHeight: 240, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 12, background: "#fafafa" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, color: "#374151" },
  tableHead: { position: "sticky", top: 0, background: "#f3f4f6", textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e5e7eb", fontWeight: 700 },
  tableCell: { padding: "10px 12px", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" },
  scheduleBox: { maxHeight: 240, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 12, padding: 8, background: "#fafafa" },
  scheduleRow: { fontSize: 13, lineHeight: 1.7, color: "#374151", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" },
  scheduleEmpty: { fontSize: 13, color: "#6b7280", padding: "6px 8px" },
  editorTopBar: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  editorTopBarLeft: { display: "flex", alignItems: "center", gap: 8 },
  editorTopBarTitle: { fontSize: 13, fontWeight: 700, color: "#374151" },
  editorTopBarRight: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  paletteManager: { display: "grid", gap: 12, marginBottom: 12 },
  paletteHeaderMeta: { display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap" },
  paletteManagerHeader: { display: "flex", alignItems: "end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  paletteManagerActions: { display: "flex", gap: 8, flexWrap: "wrap" },
  paletteCountInput: { width: 110, padding: "8px 10px", borderRadius: 10, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box" },
  mainColorBadge: { height: 40, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 999, background: "#eef2ff", color: "#3730a3", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" },
  paletteChipGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))", gap: 10 },
  fixedBackgroundChip: { display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: 10, borderRadius: 14, background: "#f9fafb", border: "1px solid #d1d5db", padding: "10px 12px" },
  fixedChipLabel: { fontSize: 12, fontWeight: 700, color: "#111827", whiteSpace: "nowrap" },
  palettePipe: { display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#9ca3af", fontWeight: 600 },
  presetPaletteRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  presetPaletteItem: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 12, border: "1px solid #d1d5db", background: "#fff" },
  presetPaletteLabel: { fontSize: 12, fontWeight: 700, color: "#111827", whiteSpace: "nowrap" },
  presetColorInput: { width: 36, height: 36, padding: 0, border: "none", background: "transparent", cursor: "pointer" },
  paletteChip: { position: "relative", display: "grid", gridTemplateColumns: "24px 1fr 28px", alignItems: "center", gap: 10, borderRadius: 14, background: "#ffffff", padding: "10px 12px", cursor: "pointer" },
  paletteChipNumber: { fontSize: 12, fontWeight: 700, color: "#111827", textAlign: "center" },
  paletteChipSwatch: { width: "100%", height: 28, borderRadius: 999, border: "1px solid rgba(0,0,0,0.08)" },
  mainChipTag: { position: "absolute", top: -8, right: 8, padding: "2px 8px", borderRadius: 999, background: "#111827", color: "#ffffff", fontSize: 10, fontWeight: 700, lineHeight: 1.4 },
  colorToolButton: { display: "flex", alignItems: "center", gap: 6, borderRadius: 999, background: "#ffffff", padding: "4px 8px", cursor: "pointer" },
  colorToolSwatch: { width: 18, height: 18, borderRadius: 999, border: "1px solid rgba(0,0,0,0.08)" },
  colorToolValue: { fontSize: 12, fontWeight: 700, color: "#111827", minWidth: 10, textAlign: "center" },
  colorToolInput: { width: 24, height: 24, padding: 0, border: "none", background: "transparent", cursor: "pointer" },
  buttonColumn: { display: "grid", gap: 8 },
  primaryButton: { padding: "11px 14px", borderRadius: 10, border: "1px solid #111827", background: "#111827", color: "#ffffff", fontSize: 14, cursor: "pointer" },
  secondaryButton: { padding: "11px 14px", borderRadius: 10, border: "1px solid #d1d5db", background: "#ffffff", color: "#111827", fontSize: 14, cursor: "pointer" },
  iconButton: { width: 38, height: 38, borderRadius: 10, border: "1px solid #d1d5db", background: "#ffffff", color: "#111827", display: "inline-flex", alignItems: "center", justifyContent: "center" },
  hiddenFileInput: { display: "none" },
  empty: { minHeight: 220, border: "1px dashed #d1d5db", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" },
  gridScroll: { overflow: "auto" },
  textarea: { width: "100%", height: 220, borderRadius: 12, border: "1px solid #d1d5db", padding: 12, fontFamily: "monospace", fontSize: 12, resize: "vertical", boxSizing: "border-box" },
  a4Outer: { overflow: "auto", background: "#f3f4f6", borderRadius: 12, padding: 16, display: "flex", justifyContent: "center" },
  a4Page: { width: `${A4_WIDTH_MM}mm`, minHeight: `${A4_HEIGHT_MM}mm`, background: "#ffffff", padding: `${A4_MARGIN_MM}mm`, boxSizing: "border-box", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" },
  hiddenPdfMount: { position: "fixed", left: -99999, top: 0, opacity: 0, pointerEvents: "none" },
};
