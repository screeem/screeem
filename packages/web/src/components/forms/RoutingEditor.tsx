"use client"

import {
  createRoutingCondition,
  createRoutingSample,
  fallbackSubmissionRouting,
  matchedSubmissionRouting,
  maximumRoutingAuthoringRules,
  maximumRoutingActionsPerRule,
  maximumRoutingConditionValueLength,
  maximumRoutingConditionsPerRule,
  routingOperatorsForField,
  snapshotFormActionTestContext,
  snapshotFormActionTestResult,
  snapshotFormActionTesters,
  testFormRouting,
  snapshotIntegrationActionCatalog,
  type FormActionTester,
  type FormDefinition,
  type FormFieldDefinition,
  type FormRoutingAuthoring,
  type FormRoutingAuthoringIssue,
  type FormRoutingAuthoringRule,
  type FormRoutingAuthoringAction,
  type FormRoutingCondition,
  type FormRoutingOperator,
  type IntegrationActionDefinition,
} from "@screeem/forms"
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { DraggableRule } from "./DraggableRule"

const actionTesterFunctionIds = new WeakMap<FormActionTester["test"], number>()
let nextActionTesterFunctionId = 1

export interface RoutingEditorProps {
  readonly definition: FormDefinition
  readonly draft: FormRoutingAuthoring
  readonly issues: readonly FormRoutingAuthoringIssue[]
  readonly disabled?: boolean
  readonly actionTesters?: readonly FormActionTester[]
  readonly integrationActions?: readonly IntegrationActionDefinition[]
  readonly onAddRule: () => void
  readonly onUpdateRule: (ruleId: string, update: Partial<FormRoutingAuthoringRule>) => void
  readonly onRemoveRule: (ruleId: string) => void
  readonly onReorderRule: (ruleId: string, targetIndex: number) => void
  readonly onAddCondition: (ruleId: string) => void
  readonly onUpdateCondition: (
    ruleId: string,
    conditionId: string,
    update: Partial<FormRoutingCondition>,
  ) => void
  readonly onRemoveCondition: (ruleId: string, conditionId: string) => void
  readonly onFallbackChange: (fallback: string) => void
  readonly onRemoveRouting?: () => void
}

export function RoutingEditor(props: RoutingEditorProps) {
  const testRequest = useRef(0)
  const ruleLimitReached = props.draft.rules.length >= maximumRoutingAuthoringRules
  const fieldSignature = JSON.stringify(props.definition.fields)
  const testSignature = `${JSON.stringify(props.definition)}:${JSON.stringify(props.draft)}`
  const actionTesters = useMemo(
    () => snapshotFormActionTesters(props.actionTesters ?? []),
    [props.actionTesters],
  )
  const integrationActions = useMemo(
    () => snapshotIntegrationActionCatalog(props.integrationActions ?? []),
    [props.integrationActions],
  )
  const actionTestersSignature = actionTesters
    .map((tester) =>
      JSON.stringify([
        tester.actionName,
        tester.label,
        tester.description ?? null,
        tester.timeoutMs ?? null,
        actionTesterFunctionId(tester.test),
      ]),
    )
    .join(":")
  const [sampleState, setSampleState] = useState<{
    readonly signature: string
    readonly values: Readonly<Record<string, string | number | boolean>>
  }>(() => ({
    signature: fieldSignature,
    values: createRoutingSample(props.definition),
  }))
  const [testState, setTestState] = useState<{
    readonly signature: string
    readonly status: "idle" | "running" | "complete" | "error"
    readonly route?: string
    readonly matchedRule?: string | null
    readonly message?: string
  }>({ signature: "", status: "idle" })
  const sample =
    sampleState.signature === fieldSignature
      ? sampleState.values
      : createRoutingSample(props.definition)
  const evaluationSignature = `${testSignature}:${JSON.stringify(sample)}`
  const currentTest =
    testState.signature === evaluationSignature
      ? testState
      : { signature: evaluationSignature, status: "idle" as const }
  const routeSuggestions = Array.from(
    new Set([...props.draft.rules.map((rule) => rule.route), props.draft.fallback].filter(Boolean)),
  )

  function updateSample(field: FormFieldDefinition, value: string | number | boolean | undefined) {
    testRequest.current += 1
    const next = { ...sample }
    if (value === undefined) delete next[field.name]
    else next[field.name] = value
    setSampleState({ signature: fieldSignature, values: next })
    setTestState({ signature: "", status: "idle" })
  }

  async function runTest() {
    const request = ++testRequest.current
    const submittedSignature = evaluationSignature
    setTestState({ signature: submittedSignature, status: "running" })
    try {
      const result = await testFormRouting(
        props.definition,
        props.draft,
        sample,
        integrationActions,
      )
      if (request !== testRequest.current) return
      setTestState({
        signature: submittedSignature,
        status: "complete",
        route: result.route,
        matchedRule: result.matchedRule,
      })
    } catch (error) {
      if (request !== testRequest.current) return
      setTestState({
        signature: submittedSignature,
        status: "error",
        message: error instanceof Error ? error.message : "The sample could not be evaluated.",
      })
    }
  }

  return (
    <section
      aria-label="Routing rules"
      aria-busy={props.disabled}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <fieldset disabled={props.disabled} className="min-w-0 border-0 p-0 disabled:opacity-70">
        <div className="grid min-h-[680px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="bg-background px-4 py-5 sm:px-7 sm:py-7">
          <div className="mx-auto max-w-4xl">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/80 pb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Routing rules
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                  Send each response to the right destination
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Rules run from top to bottom. The first matching rule wins.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {props.onRemoveRouting ? (
                  <button
                    type="button"
                    onClick={props.onRemoveRouting}
                    className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-card hover:text-error-text"
                  >
                    Remove routing
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={props.onAddRule}
                  disabled={ruleLimitReached}
                  title={ruleLimitReached ? "Routing supports up to 100 rules" : undefined}
                  className="rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
                >
                  {ruleLimitReached ? "100 rule limit" : "Add rule"}
                </button>
              </div>
            </div>

            {props.issues.length > 0 ? (
              <div role="alert" className="mt-5 border-l-2 border-warning bg-warning-subtle px-4 py-3">
                <p className="text-sm font-semibold text-warning-text">
                  {props.issues.length} routing {props.issues.length === 1 ? "issue" : "issues"}
                </p>
                <p className="mt-1 text-xs leading-5 text-warning-text">
                  {props.issues[0]?.message} Fix highlighted conditions before publishing.
                </p>
              </div>
            ) : null}

            <div className="mt-5 space-y-4">
              {props.draft.rules.map((rule, index) => (
                <DraggableRule
                  key={rule.id}
                  ruleId={rule.id}
                  index={index}
                  disabled={props.disabled}
                  onReorder={props.onReorderRule}
                >
                  {({ dragHandleRef }) => (
                    <RoutingRuleEditor
                      definition={props.definition}
                      rule={rule}
                      index={index}
                      issues={props.issues.filter((issue) => issue.ruleId === rule.id)}
                      matched={
                        currentTest.status === "complete" && currentTest.matchedRule === rule.id
                      }
                      canMoveDown={index < props.draft.rules.length - 1}
                      dragHandleRef={dragHandleRef}
                      routeSuggestions={routeSuggestions}
                      integrationActions={integrationActions}
                      onUpdate={(update) => props.onUpdateRule(rule.id, update)}
                      onRemove={() => props.onRemoveRule(rule.id)}
                      onMove={(offset) => props.onReorderRule(rule.id, index + offset)}
                      onAddCondition={() => props.onAddCondition(rule.id)}
                      onUpdateCondition={(conditionId, update) =>
                        props.onUpdateCondition(rule.id, conditionId, update)
                      }
                      onRemoveCondition={(conditionId) =>
                        props.onRemoveCondition(rule.id, conditionId)
                      }
                    />
                  )}
                </DraggableRule>
              ))}
            </div>

            {props.draft.rules.length === 0 ? (
              <div className="mt-5 border-y border-dashed border-border py-12 text-center">
                <p className="text-sm font-medium text-foreground">No routing rules yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Every response will use the fallback destination.</p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center">
              <div className="w-8 text-center text-xs font-semibold text-muted-foreground">ELSE</div>
              <div className="min-w-0 flex-1">
                <label className="block text-xs font-medium text-muted-foreground" htmlFor="routing-fallback">
                  If no rule matches, send to
                </label>
                <input
                  id="routing-fallback"
                  list="routing-destinations"
                  maxLength={256}
                  value={props.draft.fallback}
                  onChange={(event) => props.onFallbackChange(event.target.value)}
                  className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
              </div>
            </div>
            <datalist id="routing-destinations">
              {routeSuggestions.map((route) => <option key={route} value={route} />)}
            </datalist>
          </div>
        </div>

        <RoutingTestPanel
          definition={props.definition}
          sample={sample}
          testState={currentTest}
          rules={props.draft.rules}
          actionTesters={actionTesters}
          actionTestersSignature={actionTestersSignature}
          evaluationSignature={evaluationSignature}
          onChange={updateSample}
          onRun={() => void runTest()}
        />
        </div>
      </fieldset>
    </section>
  )
}

function RoutingRuleEditor({
  definition,
  rule,
  index,
  issues,
  matched,
  canMoveDown,
  dragHandleRef,
  routeSuggestions,
  integrationActions,
  onUpdate,
  onRemove,
  onMove,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
}: {
  readonly definition: FormDefinition
  readonly rule: FormRoutingAuthoringRule
  readonly index: number
  readonly issues: readonly FormRoutingAuthoringIssue[]
  readonly matched: boolean
  readonly canMoveDown: boolean
  readonly dragHandleRef: RefObject<HTMLButtonElement | null>
  readonly routeSuggestions: readonly string[]
  readonly integrationActions: readonly IntegrationActionDefinition[]
  readonly onUpdate: (update: Partial<FormRoutingAuthoringRule>) => void
  readonly onRemove: () => void
  readonly onMove: (offset: number) => void
  readonly onAddCondition: () => void
  readonly onUpdateCondition: (conditionId: string, update: Partial<FormRoutingCondition>) => void
  readonly onRemoveCondition: (conditionId: string) => void
}) {
  return (
    <article
      className={`overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow] ${
        matched
          ? "border-primary shadow-[0_0_0_3px_rgba(13,148,136,0.14)]"
          : issues.length > 0
            ? "border-warning"
            : "border-border shadow-[0_8px_24px_rgba(15,23,42,0.05)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-3 sm:px-4">
        <button
          ref={dragHandleRef}
          type="button"
          aria-label={`Drag rule ${index + 1} to reorder`}
          title="Drag to reorder"
          className="cursor-grab rounded px-1.5 py-1 text-lg leading-none text-muted-foreground hover:bg-accent hover:text-primary active:cursor-grabbing"
        >
          ⠿
        </button>
        <div className="flex items-center" aria-label={`Rule ${index + 1} position controls`}>
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label={`Move rule ${index + 1} up`}
            className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-25"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
            aria-label={`Move rule ${index + 1} down`}
            className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-25"
          >
            ↓
          </button>
        </div>
        <span className="rounded bg-muted px-2 py-1 text-[11px] font-bold tabular-nums text-muted-foreground">
          {String(index + 1).padStart(2, "0")}
        </span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Match
          <select
            value={rule.combinator}
            onChange={(event) => onUpdate({ combinator: event.target.value as "all" | "any" })}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-xs font-semibold text-foreground outline-none focus:border-primary"
          >
            <option value="all">all conditions</option>
            <option value="any">any condition</option>
          </select>
        </label>
        <div className="ml-auto flex min-w-[220px] flex-1 items-center justify-end gap-2 sm:flex-none">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`route-${rule.id}`}>
            Send to
          </label>
          <input
            id={`route-${rule.id}`}
            list="routing-destinations"
            maxLength={256}
            value={rule.route}
            onChange={(event) => onUpdate({ route: event.target.value })}
            className="min-w-0 flex-1 rounded-md border border-border px-2.5 py-1.5 text-sm font-semibold text-foreground outline-none focus:border-primary sm:w-40"
          />
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove rule ${index + 1}`}
            className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-error-subtle hover:text-error-text"
          >
            ×
          </button>
        </div>
        {routeSuggestions.length === 0 ? null : (
          <span className="sr-only">Known destinations available</span>
        )}
      </div>

      <div className="space-y-2 px-3 py-4 sm:px-4">
        {rule.conditions.map((condition, conditionIndex) => (
          <RoutingConditionEditor
            key={condition.id}
            definition={definition}
            condition={condition}
            connector={conditionIndex === 0 ? "IF" : rule.combinator === "all" ? "AND" : "OR"}
            issue={issues.find((issue) => issue.conditionId === condition.id)}
            canRemove={rule.conditions.length > 1}
            onUpdate={(update) => onUpdateCondition(condition.id, update)}
            onRemove={() => onRemoveCondition(condition.id)}
          />
        ))}
        <button
          type="button"
          onClick={onAddCondition}
          disabled={rule.conditions.length >= maximumRoutingConditionsPerRule}
          title={
            rule.conditions.length >= maximumRoutingConditionsPerRule
              ? "A rule supports up to 20 conditions"
              : undefined
          }
          className="ml-10 rounded px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary-subtle disabled:text-muted-foreground"
        >
          {rule.conditions.length >= maximumRoutingConditionsPerRule
            ? "20 condition limit"
            : "+ Add condition"}
        </button>
      </div>
      <RoutingActionEditor
        definition={definition}
        actions={rule.actions ?? []}
        catalog={integrationActions}
        issues={issues}
        onChange={(actions) => onUpdate({ actions })}
      />
    </article>
  )
}

function RoutingActionEditor({
  definition,
  actions,
  catalog,
  issues,
  onChange,
}: {
  readonly definition: FormDefinition
  readonly actions: readonly FormRoutingAuthoringAction[]
  readonly catalog: readonly IntegrationActionDefinition[]
  readonly issues: readonly FormRoutingAuthoringIssue[]
  readonly onChange: (actions: readonly FormRoutingAuthoringAction[]) => void
}) {
  const [selectedUse, setSelectedUse] = useState(catalog[0]?.use ?? "")
  const selected = catalog.find((action) => action.use === selectedUse) ?? catalog[0]

  function addAction() {
    if (!selected || actions.length >= maximumRoutingActionsPerRule) return
    const inputs = selected.inputs.flatMap((input) => {
      const field = suggestedField(definition, input)
      if (!field) return []
      return [Object.freeze({
        input: input.name,
        fieldId: field.id,
      })]
    })
    let suffix = 1
    while (actions.some((action) => action.id === `action-${suffix}`)) suffix += 1
    onChange(Object.freeze([
      ...actions,
      Object.freeze({ id: `action-${suffix}`, use: selected.use, inputs: Object.freeze(inputs) }),
    ]))
  }

  function updateAction(actionId: string, update: FormRoutingAuthoringAction) {
    onChange(Object.freeze(actions.map((action) => action.id === actionId ? update : action)))
  }

  function moveAction(index: number, offset: number) {
    const target = index + offset
    if (target < 0 || target >= actions.length) return
    const next = [...actions]
    const [action] = next.splice(index, 1)
    if (!action) return
    next.splice(target, 0, action)
    onChange(Object.freeze(next))
  }

  const canAdd = Boolean(selected) &&
    actions.length < maximumRoutingActionsPerRule &&
    selected!.inputs
      .filter((input) => input.required)
      .every((input) => suggestedField(definition, input))

  return (
    <div className="border-t border-border px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Actions</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Run durable integration actions after this rule matches.
          </p>
        </div>
        {catalog.length > 0 ? (
          <div className="flex items-center gap-2">
            <select
              aria-label="Integration action"
              value={selected?.use ?? ""}
              onChange={(event) => setSelectedUse(event.target.value)}
              className="rounded-md border border-border bg-card px-2.5 py-2 text-sm text-foreground"
            >
              {catalog.map((action) => (
                <option key={action.use} value={action.use}>{action.label}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!canAdd}
              onClick={addAction}
              title={!canAdd ? "Add compatible required form fields first" : undefined}
              className="rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-subtle disabled:text-muted-foreground"
            >
              + Add action
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-3 space-y-3">
        {actions.map((action, index) => {
          const actionDefinition = catalog.find((candidate) => candidate.use === action.use)
          const actionIssues = issues.filter((issue) => issue.actionId === action.id)
          return (
            <div key={action.id} className={`rounded-lg border p-3 ${
              actionIssues.length > 0 ? "border-warning bg-warning-subtle" : "border-border bg-muted"
            }`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {actionDefinition?.label ?? action.use}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {actionDefinition?.description ?? "This action is not available in the current catalog."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => moveAction(index, -1)}
                  aria-label={`Move ${actionDefinition?.label ?? action.use} up`}
                  className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-card disabled:opacity-25"
                >↑</button>
                <button
                  type="button"
                  disabled={index === actions.length - 1}
                  onClick={() => moveAction(index, 1)}
                  aria-label={`Move ${actionDefinition?.label ?? action.use} down`}
                  className="rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-card disabled:opacity-25"
                >↓</button>
                <button
                  type="button"
                  onClick={() => onChange(Object.freeze(actions.filter((candidate) => candidate.id !== action.id)))}
                  aria-label={`Remove ${actionDefinition?.label ?? action.use}`}
                  className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-error-subtle hover:text-error-text"
                >×</button>
              </div>
              {actionDefinition ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {actionDefinition.inputs.map((input) => {
                    const mapping = action.inputs.find((candidate) => candidate.input === input.name)
                    const currentFieldId = mapping?.fieldId ?? ""
                    const compatible = compatibleFields(definition, input)
                    return (
                      <label key={input.name} className="text-xs font-medium text-muted-foreground">
                        {input.label}
                        <select
                          value={currentFieldId}
                          onChange={(event) => {
                            const nextMapping = Object.freeze({
                              input: input.name,
                              fieldId: event.target.value,
                            })
                            updateAction(action.id, Object.freeze({
                              ...action,
                              inputs: Object.freeze(mapping
                                ? action.inputs.map((candidate) =>
                                    candidate.input === input.name ? nextMapping : candidate,
                                  )
                                : [...action.inputs, nextMapping]),
                            }))
                          }}
                          className="mt-1 w-full rounded-md border border-border bg-card px-2.5 py-2 text-sm text-foreground"
                        >
                          {!compatible.some((field) => field.id === currentFieldId) ? (
                            <option value="">Choose a field</option>
                          ) : null}
                          {compatible.map((field) => (
                            <option key={field.id} value={field.id}>{field.label}</option>
                          ))}
                        </select>
                      </label>
                    )
                  })}
                </div>
              ) : null}
              {actionIssues[0] ? (
                <p className="mt-2 text-xs font-medium text-warning-text">{actionIssues[0].message}</p>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function compatibleFields(
  definition: FormDefinition,
  input: IntegrationActionDefinition["inputs"][number],
) {
  return definition.fields.filter((field) =>
    input.fieldTypes.includes(field.type) &&
    (!input.fieldControls || input.fieldControls.includes(field.control)) &&
    (!input.required || field.required),
  )
}

function suggestedField(
  definition: FormDefinition,
  input: IntegrationActionDefinition["inputs"][number],
) {
  const fields = compatibleFields(definition, input)
  return fields.find((field) =>
    input.suggestedFieldNames.some((name) => normalizeName(name) === normalizeName(field.name)),
  ) ?? fields[0]
}

function normalizeName(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function RoutingConditionEditor({
  definition,
  condition,
  connector,
  issue,
  canRemove,
  onUpdate,
  onRemove,
}: {
  readonly definition: FormDefinition
  readonly condition: FormRoutingCondition
  readonly connector: "IF" | "AND" | "OR"
  readonly issue?: FormRoutingAuthoringIssue
  readonly canRemove: boolean
  readonly onUpdate: (update: Partial<FormRoutingCondition>) => void
  readonly onRemove: () => void
}) {
  const field = definition.fields.find((candidate) => candidate.id === condition.fieldId)
  const operators = field ? routingOperatorsForField(field) : []
  const selectedOperator = operators.find((operator) => operator.value === condition.operator)

  function selectField(fieldId: string) {
    const nextField = definition.fields.find((candidate) => candidate.id === fieldId)
    if (!nextField) return
    const next = createRoutingCondition(nextField, condition.id)
    onUpdate({ fieldId: next.fieldId, operator: next.operator, value: next.value })
  }

  function selectOperator(operator: FormRoutingOperator) {
    const option = operators.find((candidate) => candidate.value === operator)
    if (!option) return
    onUpdate({
      operator,
      value: option.needsValue
        ? condition.value ?? createRoutingCondition(field!, condition.id).value
        : undefined,
    })
  }

  return (
    <div>
      <div
        className={`grid items-center gap-2 rounded-lg p-2 sm:grid-cols-[32px_minmax(150px,1fr)_minmax(140px,0.9fr)_minmax(130px,0.9fr)_32px] ${
          issue ? "bg-warning-subtle" : "bg-muted/80"
        }`}
      >
        <span className="text-center text-[10px] font-bold tracking-wider text-muted-foreground">
          {connector}
        </span>
        <select
          aria-label={`${connector} field`}
          value={condition.fieldId}
          onChange={(event) => selectField(event.target.value)}
          className={`min-w-0 rounded-md border bg-card px-2.5 py-2 text-sm outline-none focus:border-primary ${
            field ? "border-border text-foreground" : "border-warning text-warning-text"
          }`}
        >
          {!field ? <option value={condition.fieldId}>Removed field</option> : null}
          {definition.fields.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
        <select
          aria-label={`${connector} operator`}
          value={condition.operator}
          disabled={!field}
          onChange={(event) => selectOperator(event.target.value as FormRoutingOperator)}
          className="min-w-0 rounded-md border border-border bg-card px-2.5 py-2 text-sm text-foreground outline-none focus:border-primary disabled:bg-muted"
        >
          {!selectedOperator ? (
            <option value={condition.operator}>Unsupported operator</option>
          ) : null}
          {operators.map((operator) => (
            <option key={operator.value} value={operator.value}>
              {operator.label}
            </option>
          ))}
        </select>
        {field && selectedOperator?.needsValue ? (
          <RoutingConditionValue
            field={field}
            value={condition.value}
            onChange={(value) => onUpdate({ value })}
          />
        ) : (
          <span className="hidden text-xs text-muted-foreground sm:block">No value needed</span>
        )}
        <button
          type="button"
          disabled={!canRemove}
          onClick={onRemove}
          aria-label="Remove condition"
          className="rounded p-1 text-muted-foreground hover:bg-error-subtle hover:text-error-text disabled:invisible"
        >
          ×
        </button>
      </div>
      {issue ? (
        <p className="ml-10 mt-1 text-xs font-medium text-warning-text">{issue.message}</p>
      ) : null}
    </div>
  )
}

function RoutingConditionValue({
  field,
  value,
  onChange,
}: {
  readonly field: FormFieldDefinition
  readonly value: FormRoutingCondition["value"]
  readonly onChange: (value: string | number | boolean | undefined) => void
}) {
  const className = "min-w-0 rounded-md border border-border bg-card px-2.5 py-2 text-sm text-foreground outline-none focus:border-primary"
  switch (field.type) {
    case "boolean":
      return (
        <select
          value={String(value ?? true)}
          onChange={(event) => onChange(event.target.value === "true")}
          className={className}
          aria-label={`${field.label} value`}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      )
    case "enum":
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className={className}
          aria-label={`${field.label} value`}
        >
          {field.values.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )
    case "number":
      return (
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : event.target.valueAsNumber)
          }
          className={className}
          aria-label={`${field.label} value`}
        />
      )
    case "string":
      return (
        <input
          type={field.control === "email" ? "email" : "text"}
          maxLength={maximumRoutingConditionValueLength}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className={className}
          aria-label={`${field.label} value`}
        />
      )
  }
}

function RoutingTestPanel({
  definition,
  sample,
  testState,
  rules,
  actionTesters,
  actionTestersSignature,
  evaluationSignature,
  onChange,
  onRun,
}: {
  readonly definition: FormDefinition
  readonly sample: Readonly<Record<string, string | number | boolean>>
  readonly testState: {
    readonly status: "idle" | "running" | "complete" | "error"
    readonly route?: string
    readonly matchedRule?: string | null
    readonly message?: string
  }
  readonly rules: readonly FormRoutingAuthoringRule[]
  readonly actionTesters: readonly FormActionTester[]
  readonly actionTestersSignature: string
  readonly evaluationSignature: string
  readonly onChange: (field: FormFieldDefinition, value: string | number | boolean | undefined) => void
  readonly onRun: () => void
}) {
  const matchedRuleIndex = rules.findIndex((rule) => rule.id === testState.matchedRule)
  const matchedActions = matchedRuleIndex < 0 ? [] : rules[matchedRuleIndex]?.actions ?? []
  const previews = matchedActions.flatMap((action) =>
    actionTesters
      .filter((tester) => tester.actionName === action.use)
      .map((tester) => ({ action, tester })),
  )

  return (
    <aside className="border-t border-border bg-card px-5 py-6 xl:border-l xl:border-t-0">
      <div className="sticky top-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Test routing</p>
        <h2 className="mt-2 text-lg font-semibold text-foreground">Try a sample response</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Routing is evaluated in this browser against the current draft.
        </p>

        <div className="mt-5 max-h-[420px] space-y-3 overflow-y-auto pr-1">
          {definition.fields.map((field) => (
            <SampleRoutingInput
              key={field.id}
              field={field}
              included={Object.prototype.hasOwnProperty.call(sample, field.name)}
              value={sample[field.name]}
              onChange={(value) => onChange(field, value)}
            />
          ))}
        </div>

        <button
          type="button"
          disabled={testState.status === "running"}
          onClick={onRun}
          className="mt-5 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {testState.status === "running" ? "Testing…" : "Test this response"}
        </button>

        {testState.status === "complete" ? (
          <div role="status" className="mt-4 border-l-2 border-primary bg-primary-subtle px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-text">Destination</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{testState.route}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {matchedRuleIndex >= 0
                ? `Matched rule ${String(matchedRuleIndex + 1).padStart(2, "0")}`
                : "No rule matched · fallback used"}
            </p>
          </div>
        ) : null}
        {testState.status === "complete" && previews.length > 0 ? (
          <ActionTestPanel
            key={`${evaluationSignature}:${actionTestersSignature}`}
            definition={definition}
            sample={sample}
            route={testState.route!}
            matchedRule={testState.matchedRule ?? null}
            previews={previews}
          />
        ) : null}
        {testState.status === "error" ? (
          <p
            role="alert"
            className="mt-4 border-l-2 border-error bg-error-subtle px-3 py-2 text-xs leading-5 text-error-text"
          >
            {testState.message}
          </p>
        ) : null}
      </div>
    </aside>
  )
}

function ActionTestPanel({
  definition,
  sample,
  route,
  matchedRule,
  previews,
}: {
  readonly definition: FormDefinition
  readonly sample: Readonly<Record<string, string | number | boolean>>
  readonly route: string
  readonly matchedRule: string | null
  readonly previews: readonly ActionPreview[]
}) {
  const request = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const [state, setState] = useState<{
    readonly actionId: string
    readonly tester?: FormActionTester["test"]
    readonly status: "idle" | "running" | "complete" | "error"
    readonly summary?: string
    readonly resultStatus?: "success" | "warning"
    readonly details?: readonly { readonly label: string; readonly value: string }[]
  }>({ actionId: "", status: "idle" })
  const currentState =
    state.tester === undefined ||
    previews.some(
      ({ action, tester }) => action.id === state.actionId && tester.test === state.tester,
    )
      ? state
      : { actionId: "", status: "idle" as const }

  useEffect(
    () => () => {
      request.current += 1
      controller.current?.abort()
    },
    [],
  )

  async function testAction({ action, tester }: ActionPreview) {
    const currentRequest = ++request.current
    controller.current?.abort()
    const currentController = new AbortController()
    controller.current = currentController
    setState({ actionId: action.id, tester: tester.test, status: "running" })
    try {
      const routing = matchedRule
        ? matchedSubmissionRouting(route, matchedRule)
        : fallbackSubmissionRouting(route)
      const context = snapshotFormActionTestContext(
        {
          definition,
          submission: sample,
          routing,
          action: {
            id: action.id,
            use: action.use,
            inputs: action.inputs,
          },
        },
        currentController.signal,
      )
      const result = snapshotFormActionTestResult(
        await runActionTester(tester, context, currentController),
      )
      if (currentRequest !== request.current) return
      setState({
        actionId: action.id,
        tester: tester.test,
        status: "complete",
        summary: result.summary,
        resultStatus: result.status,
        details: result.details,
      })
    } catch (error) {
      if (currentRequest !== request.current) return
      setState({
        actionId: action.id,
        tester: tester.test,
        status: "error",
        summary: error instanceof Error ? error.message : "The action test could not be completed.",
      })
    } finally {
      if (controller.current === currentController) controller.current = null
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Action previews
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Preview actions configured on the matched rule. Nothing is created or queued. A remote
        preview may receive the mapped sample values.
      </p>
      <div className="mt-2 space-y-2">
        {previews.map((preview) => {
          const { action, tester } = preview
          const running =
            currentState.status === "running" && currentState.actionId === action.id
          return (
            <button
              key={action.id}
              type="button"
              disabled={currentState.status === "running"}
              onClick={() => void testAction(preview)}
              className="w-full rounded-md border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-primary-subtle disabled:opacity-50"
            >
              <span className="block text-sm font-semibold text-foreground">
                {running ? `Previewing ${tester.label}…` : `Preview ${tester.label}`}
              </span>
              {tester.description ? (
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {tester.description}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      {currentState.status === "complete" ? (
        <div
          role="status"
          className={`mt-3 border-l-2 px-3 py-2.5 ${
            currentState.resultStatus === "warning"
              ? "border-warning bg-warning-subtle"
              : "border-primary bg-primary-subtle"
          }`}
        >
          <p className="text-sm font-semibold text-foreground">{currentState.summary}</p>
          {currentState.details?.length ? (
            <dl className="mt-2 space-y-1 text-xs">
              {currentState.details.map((detail, index) => (
                <div
                  key={`${detail.label}:${index}`}
                  className="grid grid-cols-[88px_minmax(0,1fr)] gap-2"
                >
                  <dt className="text-muted-foreground">{detail.label}</dt>
                  <dd className="break-words font-medium text-foreground">{detail.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
      {currentState.status === "error" ? (
        <p
          role="alert"
          className="mt-3 border-l-2 border-error bg-error-subtle px-3 py-2 text-xs leading-5 text-error-text"
        >
          {currentState.summary}
        </p>
      ) : null}
    </div>
  )
}

interface ActionPreview {
  readonly action: FormRoutingAuthoringAction
  readonly tester: FormActionTester
}

function actionTesterFunctionId(test: FormActionTester["test"]): number {
  const existing = actionTesterFunctionIds.get(test)
  if (existing !== undefined) return existing
  const id = nextActionTesterFunctionId++
  actionTesterFunctionIds.set(test, id)
  return id
}

async function runActionTester(
  tester: FormActionTester,
  context: Parameters<FormActionTester["test"]>[0],
  controller: AbortController,
) {
  const timeoutMs = tester.timeoutMs ?? 5_000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let rejectAbort: ((reason: Error) => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => rejectAbort?.(new Error("Action preview was cancelled or timed out."))
  controller.signal.addEventListener("abort", onAbort, { once: true })
  try {
    return await Promise.race([tester.test(context), aborted])
  } finally {
    clearTimeout(timeout)
    controller.signal.removeEventListener("abort", onAbort)
  }
}

function SampleRoutingInput({
  field,
  included,
  value,
  onChange,
}: {
  readonly field: FormFieldDefinition
  readonly included: boolean
  readonly value?: string | number | boolean
  readonly onChange: (value: string | number | boolean | undefined) => void
}) {
  const inputClass = "mt-1.5 w-full rounded-md border border-border bg-card px-2.5 py-2 text-sm text-foreground outline-none focus:border-primary"
  const defaultValue = createRoutingSample({
    formatVersion: 1,
    title: "Sample",
    submitLabel: "Submit",
    successMessage: "Thanks",
    fields: [field],
  })[field.name]

  return (
    <div className="rounded-lg bg-muted px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-foreground" htmlFor={`sample-${field.id}`}>
          {field.label}
        </label>
        {!field.required ? (
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={included}
              onChange={(event) =>
                onChange(event.target.checked ? defaultValue : undefined)
              }
              className="accent-primary"
            />
            Include
          </label>
        ) : null}
      </div>
      {included ? (
        field.type === "boolean" ? (
          <select
            id={`sample-${field.id}`}
            value={String(value ?? false)}
            onChange={(event) => onChange(event.target.value === "true")}
            className={inputClass}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : field.type === "enum" ? (
          <select
            id={`sample-${field.id}`}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
            className={inputClass}
          >
            {field.values.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`sample-${field.id}`}
            type={field.type === "number" ? "number" : field.control === "email" ? "email" : "text"}
            value={value === undefined ? "" : String(value)}
            onChange={(event) =>
              onChange(
                field.type === "number"
                  ? event.target.value === ""
                    ? ""
                    : event.target.valueAsNumber
                  : event.target.value,
              )
            }
            className={inputClass}
          />
        )
      ) : (
        <p className="mt-1.5 text-xs italic text-muted-foreground">Not included in sample</p>
      )}
    </div>
  )
}
