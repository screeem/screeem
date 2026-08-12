import { snapshotFormDefinition } from "./definition.js"
import type { FormDefinition } from "./model.js"

export interface BuilderState {
  readonly past: readonly FormDefinition[]
  readonly definition: FormDefinition
  readonly future: readonly FormDefinition[]
  readonly selectedFieldId: string | null
  readonly baseRevision: number
  readonly dirty: boolean
}

export function createBuilderState(definition: FormDefinition, baseRevision = 0): BuilderState {
  return freezeState({
    past: [],
    definition: snapshotFormDefinition(definition),
    future: [],
    selectedFieldId: null,
    baseRevision,
    dirty: false,
  })
}

export function applyBuilderDefinition(
  state: BuilderState,
  definition: FormDefinition,
  selectedFieldId = state.selectedFieldId,
): BuilderState {
  const next = snapshotFormDefinition(definition)
  const nextSelectedFieldId = fieldExists(next, selectedFieldId) ? selectedFieldId : null
  if (definitionsEqual(next, state.definition)) {
    return selectBuilderField(state, nextSelectedFieldId)
  }
  return freezeState({
    past: [...state.past, state.definition],
    definition: next,
    future: [],
    selectedFieldId: nextSelectedFieldId,
    baseRevision: state.baseRevision,
    dirty: true,
  })
}

function definitionsEqual(left: FormDefinition, right: FormDefinition): boolean {
  // Both values have already passed through snapshotFormDefinition, which
  // canonicalizes their property order and rejects non-data properties.
  return JSON.stringify(left) === JSON.stringify(right)
}

export function selectBuilderField(state: BuilderState, fieldId: string | null): BuilderState {
  const selectedFieldId = fieldExists(state.definition, fieldId) ? fieldId : null
  if (selectedFieldId === state.selectedFieldId) return state
  return freezeState({ ...state, selectedFieldId })
}

export function undoBuilder(state: BuilderState): BuilderState {
  const previous = state.past.at(-1)
  if (!previous) return state
  return freezeState({
    past: state.past.slice(0, -1),
    definition: previous,
    future: [state.definition, ...state.future],
    selectedFieldId: fieldExists(previous, state.selectedFieldId) ? state.selectedFieldId : null,
    baseRevision: state.baseRevision,
    dirty: true,
  })
}

export function redoBuilder(state: BuilderState): BuilderState {
  const [next, ...future] = state.future
  if (!next) return state
  return freezeState({
    past: [...state.past, state.definition],
    definition: next,
    future,
    selectedFieldId: fieldExists(next, state.selectedFieldId) ? state.selectedFieldId : null,
    baseRevision: state.baseRevision,
    dirty: true,
  })
}

export function markBuilderSaved(state: BuilderState, revision: number): BuilderState {
  return freezeState({
    past: [],
    definition: state.definition,
    future: [],
    selectedFieldId: state.selectedFieldId,
    baseRevision: revision,
    dirty: false,
  })
}

function fieldExists(definition: FormDefinition, fieldId: string | null): boolean {
  return fieldId !== null && definition.fields.some((field) => field.id === fieldId)
}

function freezeState(state: BuilderState): BuilderState {
  return Object.freeze({
    ...state,
    past: Object.freeze([...state.past]),
    future: Object.freeze([...state.future]),
  })
}
