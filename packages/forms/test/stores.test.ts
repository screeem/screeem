import { describe, it } from "vitest"

import { MemoryFormDefinitionStore, MemoryFormSubmissionStore } from "../src/stores.js"
import {
  formDefinitionStoreContractCases,
  formSubmissionStoreContractCases,
} from "../src/testing.js"

describe("MemoryFormDefinitionStore", () => {
  for (const testCase of formDefinitionStoreContractCases(() => ({
    store: new MemoryFormDefinitionStore(),
  }))) {
    it(testCase.name, testCase.run)
  }
})

describe("MemoryFormSubmissionStore", () => {
  for (const testCase of formSubmissionStoreContractCases(() => ({
    store: new MemoryFormSubmissionStore(),
  }))) {
    it(testCase.name, testCase.run)
  }
})
