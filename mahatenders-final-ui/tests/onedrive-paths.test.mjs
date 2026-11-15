import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_FOLDER } from "../lib/projects/model.ts";
import { BOQ_FOLDER } from "../lib/boq/model.ts";
import { WORK_ORDERS_FOLDER } from "../lib/work-orders/model.ts";
import { PAYMENTS_FOLDER } from "../lib/payments/model.ts";

const rootFolder = "Arch Design Studio";

test("business workbook paths match the existing OneDrive folder structure", () => {
  assert.equal(`${rootFolder}/${PROJECT_FOLDER}`, "Arch Design Studio/Project Tracking");
  assert.equal(`${rootFolder}/${BOQ_FOLDER}`, "Arch Design Studio/BOQ");
  assert.equal(`${rootFolder}/${WORK_ORDERS_FOLDER}`, "Arch Design Studio/Project Management/Work Orders");
  assert.equal(`${rootFolder}/${PAYMENTS_FOLDER}`, "Arch Design Studio/Financial Management/Payments and Expenses");
});

test("business folder constants remain relative to the configured OneDrive root", () => {
  const configuredRoot = "Company Files/Arch Design Studio";
  assert.equal(`${configuredRoot}/${PROJECT_FOLDER}`, "Company Files/Arch Design Studio/Project Tracking");
  assert.equal(`${configuredRoot}/${BOQ_FOLDER}`, "Company Files/Arch Design Studio/BOQ");
  assert.equal(`${configuredRoot}/${WORK_ORDERS_FOLDER}`, "Company Files/Arch Design Studio/Project Management/Work Orders");
  assert.equal(`${configuredRoot}/${PAYMENTS_FOLDER}`, "Company Files/Arch Design Studio/Financial Management/Payments and Expenses");
});
