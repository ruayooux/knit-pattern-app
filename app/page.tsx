"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Matrix = number[][];
type Palette = Record<number, string>;
type StartMode = "image" | "grid";

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
  xlsx: { writeBuffer: () => Promise<ArrayBuffer> };
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
  0: "#F5E6C8",
  1: "#8B2E12",
  2: "#B87333",
  3: "#5B7C99",
  4: "#6B8F4E",
  5: "#7C4D9E",
};

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

function buildIncreaseSteps(startStitches: number, endStitches: number, endRow: number): IncreaseStep[] {
  const safeEndRow = Math.max(1, endRow);
  const totalChange = endStitches - startStitches;
  const direction = totalChange >= 0 ? 1 : -1;
  const totalEvents = Math.abs(totalChange);

  const steps: IncreaseStep[] = [{ row: 1, stitches: 0, occurrence: 0 }];
  if (safeEndRow === 1 || totalEvents === 0) return steps;

  const totalRowsForDistribution = safeEndRow - 1;
  const baseInterval = Math.floor(totalRowsForDistribution / totalEvents);
  const remainder = totalRowsForDistribution % totalEvents;

  const intervals: number[] = [];
  for (let i = 0; i < remainder; i += 1) intervals.push(baseInterval + 1);
  for (let i = 0; i < totalEvents - remainder; i += 1) intervals.push(baseInterval);

  let currentRow = 1;
  let occurrence = 0;
  for (const gap of intervals) {
    currentRow += gap;
    occurrence += 1;
    steps.push({ row: currentRow, stitches: direction, occurrence });
  }

  return steps;
}

function generateShapedMatrix(
  cols: number,
  rows: number,
  startStitches: number,
  endStitches: number,
  endRow: number,
  fillValue: number,
  bgValue: number
): Matrix {
  const safeRows = Math.max(1, rows);
  const safeEndRow = clamp(endRow, 1, safeRows);
  const steps = buildIncreaseSteps(startStitches, endStitches, safeEndRow);

  let currentStitches = clamp(startStitches, 0, cols);
  let stepIndex = 1;

  return Array.from({ length: safeRows }, (_, index) => {
    const rowNumber = index + 1;

    while (stepIndex < steps.length && steps[stepIndex].row === rowNumber) {
      currentStitches = clamp(currentStitches + steps[stepIndex].stitches, 0, cols);
      stepIndex += 1;
    }

    const stitchesForRow = rowNumber <= safeEndRow ? currentStitches : clamp(endStitches, 0, cols);
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
  const shaped = generateShapedMatrix(10, 6, 4, 8, 4, 1, 0);
  assert(shaped.length === 6, "shaped row count");
  assert(shaped[0].filter((v) => v === 1).length === 4, "first row stitches");
  assert(shaped[3].filter((v) => v === 1).length === 8, "end shaping row stitches");
  assert(shaped[5].filter((v) => v === 1).length === 8, "post shaping rows keep end stitches");
  const steps = buildIncreaseSteps(4, 8, 4);
  assert(steps[0].row === 1 && steps[0].occurrence === 0, "baseline step exists");
  assert(steps[steps.length - 1].occurrence === 4, "occurrence count");
}

runSelfTests();

async function loadExcelJS(): Promise<ExcelJsLike> {
  const mod: any = await import("exceljs");
  if (mod?.Workbook && typeof mod.Workbook === "function") return mod as ExcelJsLike;
  if (mod?.default?.Workbook && typeof mod.default.Workbook === "function") return mod.default as ExcelJsLike;
  throw new Error("ExcelJS Workbook constructor를 찾지 못했습니다.");
}

export default function Page() {
  const [startMode, setStartMode] = useState<StartMode>("image");
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const [gridCols, setGridCols] = useState(24);
  const [gridRows, setGridRows] = useState(24);
  const [manualRows, setManualRows] = useState(false);

  const [seedMatrix, setSeedMatrix] = useState<Matrix>([]);

  const [maxColorValue, setMaxColorValue] = useState(1);
  const [activeValue, setActiveValue] = useState(1);
  const [palette, setPalette] = useState<Palette>(defaultPalette);

  const [repeatX, setRepeatX] = useState(1);
  const [repeatY, setRepeatY] = useState(1);

  const [isPainting, setIsPainting] = useState(false);
  const [paintMode, setPaintMode] = useState<"draw" | "erase">("draw");
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  const [stitchesPer10cm, setStitchesPer10cm] = useState(25);
  const [rowsPer10cm, setRowsPer10cm] = useState(33);

  const [shapeStartStitches, setShapeStartStitches] = useState(12);
  const [shapeEndStitches, setShapeEndStitches] = useState(18);
  const [shapeEndRow, setShapeEndRow] = useState(24);
  const [shapeFillValue, setShapeFillValue] = useState(1);
  const [shapeBgValue, setShapeBgValue] = useState(0);

  const pdfRef = useRef<HTMLDivElement | null>(null);

  const stitchesPerCm = stitchesPer10cm / 10;
  const rowsPerCm = rowsPer10cm / 10;
  const cellWidthCm = 1 / stitchesPerCm;
  const cellHeightCm = 1 / rowsPerCm;
  const cellWidthPx = Math.max(12, cellWidthCm * CM_TO_PX);
  const cellHeightPx = Math.max(10, cellHeightCm * CM_TO_PX);

  const outputMatrix = useMemo(() => {
    if (!seedMatrix.length) return [];
    return tileMatrix(seedMatrix, repeatX, repeatY);
  }, [seedMatrix, repeatX, repeatY]);

  const csvOutput = useMemo(() => (outputMatrix.length ? matrixToCsv(outputMatrix) : ""), [outputMatrix]);
  const increaseSteps = useMemo(
    () => buildIncreaseSteps(shapeStartStitches, shapeEndStitches, shapeEndRow),
    [shapeStartStitches, shapeEndStitches, shapeEndRow]
  );
  const visibleIncreaseSteps = useMemo(
    () => increaseSteps.filter((step) => step.stitches !== 0),
    [increaseSteps]
  );
  const paletteOptions = useMemo<PaletteOption[]>(
    () => Array.from({ length: maxColorValue + 1 }, (_, i) => ({ value: i, color: palette[i] })),
    [maxColorValue, palette]
  );
  const totalChange = shapeEndStitches - shapeStartStitches;

  const patternWidthMm = outputMatrix[0]?.length ? outputMatrix[0].length * cellWidthCm * 10 : 0;
  const patternHeightMm = outputMatrix.length ? outputMatrix.length * cellHeightCm * 10 : 0;
  const contentWidthMm = A4_WIDTH_MM - A4_MARGIN_MM * 2;
  const contentHeightMm = A4_HEIGHT_MM - A4_MARGIN_MM * 2;
  const pdfScale = patternWidthMm && patternHeightMm
    ? Math.min(contentWidthMm / patternWidthMm, contentHeightMm / patternHeightMm, 1)
    : 1;

  useEffect(() => {
    const up = () => setIsPainting(false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  useEffect(() => {
    setShapeEndRow((prev) => clamp(prev, 1, gridRows));
  }, [gridRows]);

  const processImage = (src: string, cols: number) => {
    const img = new Image();

    img.onload = () => {
      const ratio = img.height / img.width;
      const rows = manualRows ? Math.max(1, gridRows) : Math.max(1, Math.round(cols * ratio));
      if (!manualRows) setGridRows(rows);

      const canvas = document.createElement("canvas");
      canvas.width = cols;
      canvas.height = rows;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setStatus("이미지 처리 실패");
        return;
      }

      ctx.drawImage(img, 0, 0, cols, rows);
      const { data } = ctx.getImageData(0, 0, cols, rows);

      const next: Matrix = [];
      for (let y = 0; y < rows; y += 1) {
        const row: number[] = [];
        for (let x = 0; x < cols; x += 1) {
          const i = (y * cols + x) * 4;
          const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
          row.push(quantizeGray(gray, maxColorValue));
        }
        next.push(row);
      }

      setSeedMatrix(next);
      setRepeatX(1);
      setRepeatY(1);
      setStatus("이미지 변환 완료");
    };

    img.onerror = () => setStatus("이미지를 불러오지 못했습니다.");
    img.src = src;
  };

  const handleFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      setImage(src);
      processImage(src, gridCols);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (startMode !== "image") return;
    if (!image) return;
    processImage(image, gridCols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridCols, maxColorValue]);

  const handleRowsChange = (raw: string) => {
    const nextRows = Math.max(1, Number(raw) || 1);
    setGridRows(nextRows);
    if (startMode === "image" && manualRows) {
      setSeedMatrix((prev) => (prev.length ? adjustRows(prev, nextRows) : prev));
      return;
    }
    if (startMode === "grid") {
      setSeedMatrix((prev) => (prev.length ? adjustRows(prev, nextRows, shapeBgValue) : prev));
    }
  };

  const paint = (r: number, c: number, val: number) => {
    setSeedMatrix((prev) =>
      prev.map((row, i) => row.map((cell, j) => (i === r && j === c ? val : cell)))
    );
  };

  const beginPaint = (r: number, c: number, button: number) => {
    const nextMode = button === 2 ? "erase" : "draw";
    setPaintMode(nextMode);
    setIsPainting(true);
    paint(r, c, nextMode === "erase" ? shapeBgValue : activeValue);
  };

  const continuePaint = (r: number, c: number) => {
    if (!isPainting) return;
    paint(r, c, paintMode === "erase" ? shapeBgValue : activeValue);
  };

  const clearPattern = () => {
    if (!seedMatrix.length) return;
    setSeedMatrix(seedMatrix.map((row) => row.map(() => shapeBgValue)));
    setStatus("패턴을 비웠습니다.");
  };

  const buildGridPattern = () => {
    const next = generateShapedMatrix(
      Math.max(1, gridCols),
      Math.max(1, gridRows),
      shapeStartStitches,
      shapeEndStitches,
      shapeEndRow,
      clamp(shapeFillValue, 0, maxColorValue),
      clamp(shapeBgValue, 0, maxColorValue)
    );
    setSeedMatrix(next);
    setRepeatX(1);
    setRepeatY(1);
    setStatus("그리드 시작 패턴을 생성했습니다.");
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
          <h1 style={styles.h1}>뜨개 패턴 생성기</h1>
          <p style={styles.subtext}>이미지 업로드 또는 그리드로 시작해서 패턴을 만들 수 있습니다.</p>
          {status ? <p style={styles.status}>{status}</p> : null}
        </header>

        <div style={styles.layout}>
          <aside style={styles.sidebar}>
            <Panel title="1. 시작 방식 선택">
              <div style={styles.modeTabs}>
                <button
                  onClick={() => setStartMode("image")}
                  style={startMode === "image" ? styles.modeButtonActive : styles.modeButton}
                >
                  이미지 업로드
                </button>
                <button
                  onClick={() => setStartMode("grid")}
                  style={startMode === "grid" ? styles.modeButtonActive : styles.modeButton}
                >
                  그리드로 시작
                </button>
              </div>
            </Panel>

            {startMode === "image" ? (
              <Panel title="2. 이미지 입력 / 인식">
                <input type="file" accept="image/*" onChange={(e) => handleFile(e.target.files?.[0])} />
                {image ? <img src={image} alt="uploaded" style={styles.previewImage} /> : null}
              </Panel>
            ) : (
              <>
                <Panel title="2. 그리드 기본 설정">
                  <LabelRow label="가로 셀 수">
                    <input
                      type="number"
                      min={1}
                      value={gridCols}
                      onChange={(e) => setGridCols(Math.max(1, Number(e.target.value) || 1))}
                      style={styles.input}
                    />
                  </LabelRow>
                  <LabelRow label="전체 단 수">
                    <input
                      type="number"
                      min={1}
                      value={gridRows}
                      onChange={(e) => handleRowsChange(e.target.value)}
                      style={styles.input}
                    />
                  </LabelRow>
                </Panel>

                <Panel title="3. 시작 / 마무리 코 설정">
                  <LabelRow label="첫 번째 줄 시작 코 수">
                    <input
                      type="number"
                      min={0}
                      max={gridCols}
                      value={shapeStartStitches}
                      onChange={(e) => setShapeStartStitches(clamp(Number(e.target.value) || 0, 0, gridCols))}
                      style={styles.input}
                    />
                  </LabelRow>
                  <LabelRow label="끝 단에서의 마무리 코 수">
                    <input
                      type="number"
                      min={0}
                      max={gridCols}
                      value={shapeEndStitches}
                      onChange={(e) => setShapeEndStitches(clamp(Number(e.target.value) || 0, 0, gridCols))}
                      style={styles.input}
                    />
                  </LabelRow>
                  <LabelRow label="늘림단 마지막 단 (시작 단은 1로 고정)">
                    <input
                      type="number"
                      min={1}
                      max={gridRows}
                      value={shapeEndRow}
                      onChange={(e) => setShapeEndRow(clamp(Number(e.target.value) || 1, 1, gridRows))}
                      style={styles.input}
                    />
                  </LabelRow>
                </Panel>

                <Panel title="4. 값 / 생성 설정">
                  <LabelRow label="바탕값">
                    <select
                      value={shapeBgValue}
                      onChange={(e) => setShapeBgValue(clamp(Number(e.target.value), 0, maxColorValue))}
                      style={styles.input}
                    >
                      {Array.from({ length: maxColorValue + 1 }, (_, i) => i).map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </LabelRow>
                  <LabelRow label="채울값">
                    <select
                      value={shapeFillValue}
                      onChange={(e) => setShapeFillValue(clamp(Number(e.target.value), 0, maxColorValue))}
                      style={styles.input}
                    >
                      {Array.from({ length: maxColorValue + 1 }, (_, i) => i).map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </LabelRow>
                  <div style={styles.helperText}>
                    2~4 단계 입력 후 생성하면, 1단은 고정하고 사용자가 지정한 늘림단 마지막 단까지 코 수를 분배해 자동으로 패턴을 만듭니다.
                  </div>
                  <button onClick={buildGridPattern} style={styles.primaryButton}>그리드 패턴 생성</button>
                </Panel>

                <Panel title="세로 나눗셈 계산값">
                  <div style={styles.noteBox}>
                    <div>시작 단: 1단</div>
                    <div>늘림단 마지막 단: {shapeEndRow}단</div>
                    <div>총 코 변화: {Math.abs(totalChange)}코 {totalChange >= 0 ? "늘림" : "줄임"}</div>
                    <div>n(단)-n(코)-n(회)</div>
                    <div>n(단)-n(코)-n(회)</div>
                  </div>
                  <div style={styles.scheduleBox}>
                    {visibleIncreaseSteps.length ? (
                      visibleIncreaseSteps.map((step, index) => {
                        const side = step.stitches > 0 ? "늘림" : "줄임";
                        const left = Math.abs(step.stitches);
                        const right = Math.abs(step.stitches);
                        const totalRight = step.occurrence;

                        return (
                          <div key={`${step.row}-${step.occurrence}-${index}`} style={styles.scheduleRow}>
                            {step.row}단에서 {left}코 {side}(왼쪽) +{right}(오른쪽) / 총 +{totalRight}(오른쪽)
                          </div>
                        );
                      })
                    ) : (
                      <div style={styles.scheduleEmpty}>늘림 구간이 없습니다.</div>
                    )}
                  </div>
                </Panel>
              </>
            )}

            <Panel title="5. 게이지 설정 (중요)">
              <LabelRow label="10cm당 코">
                <input
                  type="number"
                  step="0.1"
                  value={stitchesPer10cm}
                  onChange={(e) => setStitchesPer10cm(Math.max(0.1, Number(e.target.value) || 0.1))}
                  style={styles.input}
                />
              </LabelRow>
              <LabelRow label="10cm당 단">
                <input
                  type="number"
                  step="0.1"
                  value={rowsPer10cm}
                  onChange={(e) => setRowsPer10cm(Math.max(0.1, Number(e.target.value) || 0.1))}
                  style={styles.input}
                />
              </LabelRow>
              <div style={styles.noteBox}>
                <div>셀 가로: {cellWidthCm.toFixed(3)}cm</div>
                <div>셀 세로: {cellHeightCm.toFixed(3)}cm</div>
                <div>미리보기 셀: {cellWidthPx.toFixed(1)}px × {cellHeightPx.toFixed(1)}px</div>
              </div>
            </Panel>

            {startMode === "image" ? (
              <Panel title="6. 이미지 인식 설정">
                <LabelRow label="가로 셀 수">
                  <input
                    type="number"
                    min={1}
                    value={gridCols}
                    onChange={(e) => setGridCols(Math.max(1, Number(e.target.value) || 1))}
                    style={styles.input}
                  />
                </LabelRow>
                <label style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={manualRows}
                    onChange={(e) => setManualRows(e.target.checked)}
                  />
                  세로 직접 지정
                </label>
                <LabelRow label="세로 셀 수">
                  <input
                    type="number"
                    min={1}
                    value={gridRows}
                    onChange={(e) => handleRowsChange(e.target.value)}
                    style={{ ...styles.input, background: manualRows ? "#fff" : "#f3f4f6" }}
                  />
                </LabelRow>
                <div style={styles.helperText}>
                  체크 OFF면 이미지 비율로 자동 계산, 체크 ON이면 입력한 세로값으로 강제 리샘플링합니다.
                </div>
              </Panel>
            ) : null}

            <Panel title="7. 브러시 설정">
              <LabelRow label="색 단계">
                <select value={maxColorValue} onChange={(e) => setMaxColorValue(Number(e.target.value))} style={styles.input}>
                  <option value={1}>1색 (0~1)</option>
                  <option value={2}>2색 (0~2)</option>
                  <option value={3}>3색 (0~3)</option>
                  <option value={4}>4색 (0~4)</option>
                  <option value={5}>5색 (0~5)</option>
                </select>
              </LabelRow>
              <LabelRow label="브러시 값">
                <select value={activeValue} onChange={(e) => setActiveValue(Number(e.target.value))} style={styles.input}>
                  {Array.from({ length: maxColorValue + 1 }, (_, i) => i).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </LabelRow>
              <div style={styles.helperText}>
                상단 오른쪽 색상 팔레트에서 값을 선택하면 현재 브러시 값이 바뀌고, 색상도 바로 수정할 수 있습니다.
              </div>
            </Panel>

            <Panel title="8. 반복 패턴">
              <LabelRow label="반복 X">
                <input
                  type="number"
                  min={1}
                  value={repeatX}
                  onChange={(e) => setRepeatX(Math.max(1, Number(e.target.value) || 1))}
                  style={styles.input}
                />
              </LabelRow>
              <LabelRow label="반복 Y">
                <input
                  type="number"
                  min={1}
                  value={repeatY}
                  onChange={(e) => setRepeatY(Math.max(1, Number(e.target.value) || 1))}
                  style={styles.input}
                />
              </LabelRow>
              <button onClick={clearPattern} style={styles.secondaryButton}>원본 패턴 비우기</button>
            </Panel>

            <Panel title="9. 출력">
              <div style={styles.buttonColumn}>
                <button onClick={downloadCsv} disabled={!outputMatrix.length} style={styles.primaryButton}>CSV 다운로드</button>
                <button onClick={downloadXlsx} disabled={!outputMatrix.length} style={styles.primaryButton}>XLSX 다운로드</button>
                <button
                  onClick={() => setShowPdfPreview((v) => !v)}
                  disabled={!outputMatrix.length}
                  style={styles.secondaryButton}
                >
                  {showPdfPreview ? "PDF 미리보기 닫기" : "PDF 미리보기 열기"}
                </button>
                <button onClick={downloadPdf} disabled={!outputMatrix.length} style={styles.primaryButton}>PDF 다운로드</button>
              </div>
            </Panel>
          </aside>

          <main style={styles.main}>
            <Panel title="원본 패턴 편집 영역">
              {!seedMatrix.length ? (
                <div style={styles.empty}>이미지를 올리거나 그리드 패턴을 생성하면 여기에 편집 패턴이 생성됩니다.</div>
              ) : (
                <>
                  <div style={styles.editorTopBar}>
                    <div style={styles.editorTopBarLeft}>
                      <span style={styles.editorTopBarTitle}>수정 가능한 색</span>
                    </div>
                    <div style={styles.editorTopBarRight}>
                      {paletteOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setActiveValue(option.value)}
                          style={{
                            ...styles.colorToolButton,
                            border: activeValue === option.value ? "2px solid #111827" : "1px solid #d1d5db",
                          }}
                          title={`값 ${option.value}`}
                        >
                          <span style={{ ...styles.colorToolSwatch, background: option.color }} />
                          <span style={styles.colorToolValue}>{option.value}</span>
                          <input
                            type="color"
                            value={option.color}
                            onChange={(e) => setPalette((prev) => ({ ...prev, [option.value]: e.target.value }))}
                            onClick={(e) => e.stopPropagation()}
                            style={styles.colorToolInput}
                            title={`값 ${option.value} 색상 수정`}
                          />
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
                        row.map((cell, c) => (
                          <div
                            key={`${r}-${c}`}
                            onMouseDown={(e) => beginPaint(r, c, e.button)}
                            onMouseEnter={() => continuePaint(r, c)}
                            style={{
                              width: cellWidthPx,
                              height: cellHeightPx,
                              background: palette[cell],
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
                            {cell}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </Panel>

            <Panel title="반복 결과 미리보기">
              {!outputMatrix.length ? (
                <div style={styles.empty}>반복 결과가 여기에 표시됩니다.</div>
              ) : (
                <div style={styles.gridScroll}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${outputMatrix[0].length}, ${cellWidthPx}px)`,
                      gap: 1,
                      background: "#d4d4d8",
                      width: "max-content",
                    }}
                  >
                    {outputMatrix.flatMap((row, r) =>
                      row.map((cell, c) => (
                        <div
                          key={`out-${r}-${c}`}
                          style={{
                            width: cellWidthPx,
                            height: cellHeightPx,
                            background: palette[cell],
                            border: "1px solid rgba(0,0,0,0.06)",
                            boxSizing: "border-box",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "transparent",
                            fontSize: 10,
                          }}
                        >
                          {cell}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </Panel>

            {showPdfPreview ? (
              <Panel title="PDF 미리보기">
                <div style={styles.a4Outer}>
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
              </Panel>
            ) : null}

            <Panel title="CSV 출력">
              <textarea readOnly value={csvOutput} style={styles.textarea} />
            </Panel>
          </main>
        </div>
      </div>
    </div>
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
      {children}
    </label>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8fafc", color: "#111827", fontFamily: "Arial, sans-serif", padding: 24 },
  container: { maxWidth: 1400, margin: "0 auto", display: "grid", gap: 20 },
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
  labelRow: { display: "grid", gap: 6 },
  labelText: { fontSize: 13, color: "#374151" },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14 },
  helperText: { fontSize: 12, color: "#6b7280", lineHeight: 1.6 },
  paletteGrid: { display: "grid", gap: 8 },
  noteBox: { background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 1.7, color: "#374151" },
  scheduleBox: { maxHeight: 240, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 12, padding: 8, background: "#fafafa" },
  scheduleRow: { fontSize: 13, lineHeight: 1.7, color: "#374151", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" },
  scheduleEmpty: { fontSize: 13, color: "#6b7280", padding: "6px 8px" },
  editorTopBar: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  editorTopBarLeft: { display: "flex", alignItems: "center", gap: 8 },
  editorTopBarTitle: { fontSize: 13, fontWeight: 700, color: "#374151" },
  editorTopBarRight: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  colorToolButton: { display: "flex", alignItems: "center", gap: 6, borderRadius: 999, background: "#ffffff", padding: "4px 8px", cursor: "pointer" },
  colorToolSwatch: { width: 18, height: 18, borderRadius: 999, border: "1px solid rgba(0,0,0,0.08)" },
  colorToolValue: { fontSize: 12, fontWeight: 700, color: "#111827", minWidth: 10, textAlign: "center" },
  colorToolInput: { width: 24, height: 24, padding: 0, border: "none", background: "transparent", cursor: "pointer" },
  buttonColumn: { display: "grid", gap: 8 },
  modeTabs: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  modeButton: { padding: "10px 12px", borderRadius: 10, border: "1px solid #d1d5db", background: "#ffffff", color: "#111827", fontSize: 14, cursor: "pointer" },
  modeButtonActive: { padding: "10px 12px", borderRadius: 10, border: "1px solid #111827", background: "#111827", color: "#ffffff", fontSize: 14, cursor: "pointer" },
  primaryButton: { padding: "11px 14px", borderRadius: 10, border: "1px solid #111827", background: "#111827", color: "#ffffff", fontSize: 14, cursor: "pointer" },
  secondaryButton: { padding: "11px 14px", borderRadius: 10, border: "1px solid #d1d5db", background: "#ffffff", color: "#111827", fontSize: 14, cursor: "pointer" },
  empty: { minHeight: 220, border: "1px dashed #d1d5db", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" },
  gridScroll: { overflow: "auto" },
  textarea: { width: "100%", height: 220, borderRadius: 12, border: "1px solid #d1d5db", padding: 12, fontFamily: "monospace", fontSize: 12, resize: "vertical", boxSizing: "border-box" },
  a4Outer: { overflow: "auto", background: "#f3f4f6", borderRadius: 12, padding: 16, display: "flex", justifyContent: "center" },
  a4Page: { width: `${A4_WIDTH_MM}mm`, minHeight: `${A4_HEIGHT_MM}mm`, background: "#ffffff", padding: `${A4_MARGIN_MM}mm`, boxSizing: "border-box", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" },
};
