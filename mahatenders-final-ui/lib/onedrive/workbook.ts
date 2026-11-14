import "server-only";

import { Workbook, type CellValue, type Table, type Worksheet } from "exceljs";

export type WorkbookRecord = Record<string, CellValue>;

export async function openWorkbook(contents: Buffer): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(contents as unknown as ArrayBuffer);
  return workbook;
}

export async function serializeWorkbook(workbook: Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function readWorksheetRows(workbook: Workbook, worksheetName: string): WorkbookRecord[] {
  const worksheet = workbook.getWorksheet(worksheetName);
  if (!worksheet) throw new Error(`Worksheet '${worksheetName}' was not found.`);

  const headerRow = worksheet.getRow(1);
  const headers = Array.from({ length: headerRow.cellCount }, (_, index) => String(headerRow.getCell(index + 1).value ?? "").trim());
  if (!headers.some(Boolean)) return [];
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new Error(`Worksheet '${worksheetName}' must have unique, non-empty column headers in row 1.`);
  }

  const records: WorkbookRecord[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const record: WorkbookRecord = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      const value = row.getCell(index + 1).value as CellValue;
      record[header] = value;
      if (value !== null && value !== undefined && value !== "") hasValue = true;
    });
    if (hasValue) records.push(record);
  }
  return records;
}

export function createWorksheet(workbook: Workbook, name: string, headers: string[] = []): Worksheet {
  if (!name.trim() || workbook.getWorksheet(name)) throw new Error("Worksheet name is empty or already exists.");
  const worksheet = workbook.addWorksheet(name);
  if (headers.length) {
    validateHeaders(headers);
    worksheet.addRow(headers);
  }
  return worksheet;
}

function validateHeaders(headers: string[]): void {
  const normalized = headers.map((header) => header.trim());
  if (!normalized.length || normalized.some((header) => !header) || new Set(normalized).size !== normalized.length) {
    throw new Error("Excel table headers must be unique and non-empty.");
  }
}

function tableOnWorksheet(worksheet: Worksheet, tableName: string): Table {
  const table = worksheet.getTable(tableName);
  if (!table) throw new Error(`Excel table '${tableName}' was not found.`);
  // Tables parsed from an .xlsx file are instantiated without their worksheet.
  // ExcelJS mutation methods need this reference when committing table changes.
  if (!(table as Table & { worksheet?: Worksheet }).worksheet) {
    (table as Table & { worksheet?: Worksheet }).worksheet = worksheet;
  }
  return table;
}

type MutableTableModel = {
  ref?: string;
  tableRef?: string;
  headerRow?: boolean;
  totalsRow?: boolean;
  rows?: CellValue[][];
  columns: Array<{ name: string }>;
};

function tableModel(table: Table): MutableTableModel {
  return (table as Table & { model: MutableTableModel }).model;
}

function tableColumns(table: Table): Array<{ name: string }> {
  return tableModel(table).columns;
}

function parseCellAddress(address: string): { row: number; column: number } {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(address);
  if (!match) throw new Error("The Excel table has an invalid cell reference.");
  const column = [...match[1].toUpperCase()].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
  return { row: Number(match[2]), column };
}

function hydrateTableRows(worksheet: Worksheet, table: Table): { startRow: number; startColumn: number; endRow: number } {
  const model = tableModel(table);
  const range = model.tableRef?.split(":") ?? [table.ref];
  const anchor = parseCellAddress(model.ref || range[0]);
  const worksheetHasTableHeaders = tableColumns(table).every((column, index) =>
    worksheet.getCell(anchor.row, anchor.column + index).value === column.name,
  );
  // Excel's default is a header row and no totals row. ExcelJS applies these
  // defaults when creating tables, but may parse an omitted headerRowCount as
  // false for tables imported from Excel. Our structured tables also require
  // their declared column names in the first row, so detect that case directly.
  if (model.headerRow === undefined || (!model.headerRow && worksheetHasTableHeaders)) model.headerRow = true;
  if (model.totalsRow === undefined) model.totalsRow = false;
  // ExcelJS restores tableRef and tl from downloaded workbooks, but may omit
  // the ref field used by its mutation helpers. Restore the anchor before any
  // add/remove operation so commit() can update the table range safely.
  if (!model.ref) model.ref = range[0];
  const start = anchor;
  const end = parseCellAddress(range[range.length - 1]);
  const firstDataRow = start.row + (table.headerRow ? 1 : 0);
  const lastDataRow = end.row - (table.totalsRow ? 1 : 0);
  const rows: CellValue[][] = [];
  for (let rowNumber = firstDataRow; rowNumber <= lastDataRow; rowNumber++) {
    rows.push(tableColumns(table).map((_, index) => worksheet.getCell(rowNumber, start.column + index).value as CellValue));
  }
  model.rows = rows;
  return { startRow: firstDataRow, startColumn: start.column, endRow: end.row };
}

function tableRecord(table: Table, row: CellValue[]): WorkbookRecord {
  return Object.fromEntries(tableColumns(table).map((column, index) => [column.name, row[index] as CellValue]));
}

export function structuredTableColumnNames(worksheet: Worksheet, tableName: string): string[] | null {
  const table = worksheet.getTable(tableName);
  return table ? tableColumns(table).map((column) => column.name) : null;
}

export function createStructuredTable(
  worksheet: Worksheet,
  tableName: string,
  headers: string[],
  records: WorkbookRecord[] = [],
): Table {
  validateHeaders(headers);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) throw new Error("Excel table name must start with a letter or underscore and contain only letters, numbers, and underscores.");
  if (worksheet.getTable(tableName)) throw new Error(`Excel table '${tableName}' already exists on this worksheet.`);
  if (worksheet.actualRowCount > 0) {
    const existingHeaders = Array.from({ length: worksheet.getRow(1).cellCount }, (_, index) => String(worksheet.getCell(1, index + 1).value ?? "").trim());
    if (worksheet.actualRowCount !== 1 || existingHeaders.length !== headers.length || existingHeaders.some((header, index) => header !== headers[index].trim())) {
      throw new Error("A structured table can only be created on an empty worksheet or over its matching header row.");
    }
  }
  return worksheet.addTable({
    name: tableName,
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    columns: headers.map((name) => ({ name, filterButton: true })),
    rows: records.map((record) => headers.map((header) => record[header] ?? null)),
  });
}

export function readTableRecords(worksheet: Worksheet, tableName: string): WorkbookRecord[] {
  const table = tableOnWorksheet(worksheet, tableName);
  hydrateTableRows(worksheet, table);
  const rows = tableModel(table).rows ?? [];
  return rows.map((row) => tableRecord(table, row));
}

export function addTableRecord(worksheet: Worksheet, tableName: string, record: WorkbookRecord): void {
  const table = tableOnWorksheet(worksheet, tableName);
  const { endRow, startColumn } = hydrateTableRows(worksheet, table);
  const appendRowNumber = endRow + (table.totalsRow ? 0 : 1);
  const columns = tableColumns(table);
  if (!table.totalsRow && columns.some((_, index) => worksheet.getCell(appendRowNumber, startColumn + index).value !== null && worksheet.getCell(appendRowNumber, startColumn + index).value !== undefined)) {
    throw new Error(`Cannot append to '${tableName}' because cells immediately below the table already contain data.`);
  }
  table.addRow(columns.map((column) => record[column.name] ?? null));
  table.commit();
}

export function updateTableRecord(
  worksheet: Worksheet,
  tableName: string,
  keyColumn: string,
  keyValue: CellValue,
  changes: WorkbookRecord,
): boolean {
  const table = tableOnWorksheet(worksheet, tableName);
  const bounds = hydrateTableRows(worksheet, table);
  const rows = tableModel(table).rows ?? [];
  const columnNames = tableColumns(table).map((column) => column.name);
  const keyIndex = columnNames.indexOf(keyColumn);
  if (keyIndex < 0) throw new Error(`Key column '${keyColumn}' is not in table '${tableName}'.`);
  const rowIndex = rows.findIndex((row) => Object.is(row[keyIndex], keyValue));
  if (rowIndex < 0) return false;
  const updated = columnNames.map((column, index) => changes[column] === undefined ? rows[rowIndex][index] : changes[column]);
  updated.forEach((value, index) => worksheet.getCell(bounds.startRow + rowIndex, bounds.startColumn + index).value = value);
  return true;
}

export function deleteTableRecord(
  worksheet: Worksheet,
  tableName: string,
  keyColumn: string,
  keyValue: CellValue,
): boolean {
  const table = tableOnWorksheet(worksheet, tableName);
  hydrateTableRows(worksheet, table);
  const rows = tableModel(table).rows ?? [];
  const keyIndex = tableColumns(table).findIndex((column) => column.name === keyColumn);
  if (keyIndex < 0) throw new Error(`Key column '${keyColumn}' is not in table '${tableName}'.`);
  const rowIndex = rows.findIndex((row) => Object.is(row[keyIndex], keyValue));
  if (rowIndex < 0) return false;
  const oldCount = rows.length;
  table.removeRows(rowIndex, 1);
  table.commit();
  if ((tableModel(table).rows ?? []).length !== oldCount - 1) {
    throw new Error("The Excel table row deletion could not be confirmed.");
  }
  return true;
}
