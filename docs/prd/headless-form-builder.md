# PRD: Headless Form Builder and Runtime

## Problem Statement

Screeem can create form collection endpoints and store arbitrary submission payloads, but it does not yet let a business user define the fields in a form. The current form UI only captures a name, allowed origin, and success URL. It then shows a hard-coded HTML example containing an email field. The system does not persist a form definition, render a hosted form from that definition, or validate incoming submissions against it.

The routing package now accepts a plain form definition and can safely compile business rules against its fields. This creates a gap between what routing can consume and what a business user can produce. A developer can write the definition by hand, but a non-technical user cannot visually create fields such as name, age, employee count, or country and then use those fields as the basis for routing.

Adopting an existing visual builder would introduce a second schema format, styling framework, and adapter layer. The supported initial field set is deliberately small, so that integration cost could be greater than building the product-specific experience. At the same time, the builder must not be tied to Screeem's React UI, Supabase, or any single storage technology. Developers need to use the form model with their own interfaces and provide a store backed by PostgreSQL, DynamoDB, an HTTP service, memory, or another system.

The team also needs to review the form-building experience before it is placed in the product. The established Yul approach is to put realistic, interactive UI directions in a development-only playground, compare them using mock data, choose a direction, and only then integrate the chosen components into the production surface.

## Solution

Build a small, schema-first form platform with a public headless core, pluggable persistence, a React integration, a business-user builder, and a respondent runtime.

The canonical form definition will be plain, serializable data. It will describe field identity, submission keys, field value types, controls, labels, required state, validation, and basic presentation metadata. The same definition will drive:

- the business-user form builder;
- the hosted respondent form;
- server-side submission parsing and validation;
- immutable published versions;
- historical submission interpretation; and
- routing compilation through `schemaFromForm`.

The headless core will contain form-definition types, validation, pure editing operations, publishing rules, store contracts, an in-memory store, and reusable adapter contract tests. It will not depend on React, TanStack Form, Supabase, a browser, or a network. A separate React integration will use TanStack Form to manage respondent state and validation while allowing the host application to supply its own components and visual design.

Form authors will edit a draft and explicitly publish it. Publishing will atomically create an immutable numbered version. The previously published version will continue serving respondents until publishing succeeds. Every accepted submission will record the published definition version used to parse and validate it.

Before production integration, a development-only playground shows multiple fully interactive builder directions with realistic mock forms, an in-memory store, live respondent previews, and definition inspection. Playground submissions are inert and do not write to application APIs or databases. The Canvas direction was selected and productionised using the same headless modules and React components; the rejected alternatives remain labelled in the playground.

### MVP success criteria

- A business user can create, configure, reorder, preview, save, and publish a form without writing code.
- The initial builder supports text, email, textarea, number, checkbox, and single-select controls.
- Every control maps to the existing routing types: string, number, boolean, or enum.
- A respondent can open a hosted form, submit valid values, and receive accessible validation feedback for invalid values.
- The public submission endpoint rejects values that do not conform to the currently published definition.
- A published definition can be passed directly to `schemaFromForm` without a second canonical schema or a lossy conversion.
- A developer can use the headless package with the included in-memory stores or provide custom store implementations.
- Custom stores can be checked with reusable public contract tests.
- Most core and application behavior can be tested without starting Supabase, a database, or a web server.
- Existing unstructured form endpoints remain functional until their owners create and publish a definition.
- The form-builder playground is available in development and absent from the production user experience.

## User Stories

### Form authors

1. As a business user, I want to create a form from the dashboard, so that I can collect structured information without asking a developer to write HTML.
2. As a business user, I want to start from a blank draft, so that an unfinished form is not exposed to respondents.
3. As a business user, I want to give the form a title and description, so that respondents understand what information is requested.
4. As a business user, I want to add a text field, so that I can collect short values such as a person's name or company.
5. As a business user, I want to add an email field, so that respondents receive email-specific input and validation behavior.
6. As a business user, I want to add a textarea, so that I can collect longer free-form answers.
7. As a business user, I want to add a number field, so that values such as age, revenue, or employee count remain numeric for validation and routing.
8. As a business user, I want to add a checkbox, so that I can collect a true-or-false answer.
9. As a business user, I want to add a single-select field, so that respondents choose one value from a controlled list.
10. As a business user, I want to edit a field's label and help text, so that the form uses language respondents understand.
11. As a business user, I want the system to suggest a safe submission key from a label, so that I do not need to understand identifier rules.
12. As an advanced form author, I want to edit a field's submission key before publication, so that it can align with an external business vocabulary.
13. As a business user, I want to mark a field as required or optional, so that the form collects only information that is genuinely necessary.
14. As a business user, I want to set minimum and maximum text lengths, so that obviously incomplete or excessive answers are rejected.
15. As a business user, I want email values checked for basic email shape, so that common input mistakes are caught.
16. As a business user, I want to set minimum and maximum numeric values, so that impossible or irrelevant values are rejected.
17. As a business user, I want to add, rename, remove, and reorder select options, so that controlled choices match the business process.
18. As a business user, I want to reorder fields using a pointer or keyboard, so that I can control the form sequence accessibly.
19. As a business user, I want to duplicate a field, so that similar questions can be created efficiently without re-entering every setting.
20. As a business user, I want to remove a field with clear confirmation or undo behavior, so that accidental edits are recoverable.
21. As a business user, I want undo and redo while editing, so that I can explore changes safely.
22. As a business user, I want to see definition errors beside the relevant field, so that I know exactly what prevents saving or publishing.
23. As a business user, I want a live respondent preview, so that I can judge the form without publishing it.
24. As a business user, I want to test the preview with sample values, so that I can see validation and completion behavior.
25. As a business user, I want to save an incomplete but structurally valid draft, so that I can return to it later.
26. As a business user, I want a clear distinction between draft and published state, so that I know what respondents currently see.
27. As a business user, I want to publish a draft explicitly, so that changes do not affect respondents by surprise.
28. As a business user, I want publishing conflicts explained when somebody else saved a newer draft, so that their work is not silently overwritten.
29. As a business user, I want to pause and resume a published form, so that I can temporarily stop collection without deleting its definition or submissions.
30. As a business user, I want to copy the hosted form link and submission endpoint, so that I can distribute or integrate the form.

### Respondents and operations users

31. As a respondent, I want the hosted form to work on mobile and desktop, so that I can submit it from my available device.
32. As a respondent using assistive technology, I want every input, description, required state, and error to be correctly associated, so that I can complete the form independently.
33. As a respondent, I want invalid values explained without losing my other answers, so that I can correct the submission efficiently.
34. As a respondent, I want a clear success state or configured redirect, so that I know the submission was received.
35. As an operations user, I want every submission associated with the definition version that accepted it, so that I can interpret old answers after a form changes.
36. As an operations user, I want submission values stored in normalized types, so that numbers and booleans do not become ambiguous strings.
37. As an operations user, I want malformed, unknown, or unsafe values rejected before storage, so that downstream routing receives trustworthy input shapes.
38. As an operations user, I want existing legacy collection endpoints to keep working during adoption, so that the release does not interrupt current forms.

### Developers and integrators

39. As a developer, I want a headless form-definition API, so that I can use the model without adopting Screeem's UI.
40. As a developer, I want form definitions to be plain serializable data, so that I can store and transmit them using ordinary infrastructure.
41. As a developer, I want pure add, update, remove, duplicate, reorder, and validation operations, so that form editing can be tested deterministically.
42. As a developer, I want storage accessed through public interfaces, so that my application can use its existing persistence technology.
43. As a developer, I want an included in-memory store, so that I can prototype and test without starting external services.
44. As a store-adapter author, I want reusable contract tests, so that I can prove my implementation preserves revisions, publication atomicity, immutability, and retrieval semantics.
45. As a developer, I want clocks and identifier generation supplied at system boundaries, so that tests do not depend on real time or random values.
46. As a developer, I want store methods to return plain snapshots rather than database clients or mutable references, so that infrastructure details cannot leak into domain code.
47. As a developer, I want a React integration that is separate from the headless core, so that non-React consumers do not install React or TanStack Form.
48. As a developer, I want to provide my own React field components, so that the respondent form matches my design system.
49. As a developer, I want server-side parsing and validation to use the same definition as the client renderer, so that browser and API behavior cannot drift.
50. As a developer, I want a published form definition to work directly with `schemaFromForm`, so that routing rules use the exact fields respondents submit.
51. As a developer, I want publication to expose the new immutable version, so that routing definitions and caches can be recompiled or invalidated safely.
52. As a developer, I want structured domain errors for invalid definitions, revision conflicts, missing forms, unavailable published versions, and invalid submissions, so that hosts can present appropriate responses.
53. As a developer, I want legacy unstructured forms to be identifiable, so that migration can be deliberate rather than silently changing their submission contract.

### Product and design reviewers

54. As a product reviewer, I want several interactive builder directions in a development playground, so that I can choose the experience before it is integrated.
55. As a design reviewer, I want every playground direction to use the same realistic fixtures and capabilities, so that comparisons are about interaction and layout rather than missing functionality.
56. As a product reviewer, I want to switch between builder, respondent preview, and definition views, so that I can assess the whole author-to-submission loop.
57. As a developer, I want playground interactions to use in-memory state and inert submissions, so that design review cannot mutate production-like data.
58. As a maintainer, I want the chosen and rejected directions labelled after selection, so that future changes preserve the reasoning behind the decision.
59. As a security reviewer, I want development playground routes unavailable in production, so that experimental surfaces cannot be discovered or used by customers.

## Implementation Decisions

### Canonical form model

- The canonical definition is a closed, plain-data structure with an explicit format version. It contains form-level presentation metadata and an ordered list of field definitions.
- Every field has an immutable internal identifier and a submission key. The internal identifier supports editing and history; the submission key is the stable path used in payloads and routing expressions.
- Field keys must be unique, safe own-property names and compatible with the routing package's field-name restrictions. Prototype-related names and other unsafe identifiers are rejected.
- The initial value types are string, number, boolean, and string enum. Controls are presentation metadata over those types: text, email, and textarea map to string; number maps to number; checkbox maps to boolean; single-select maps to enum.
- The initial field metadata includes label, optional description, required state, placeholder where applicable, and control-specific validation.
- Initial validation supports required state, string minimum and maximum length, basic email shape, finite numeric minimum and maximum values, and enum membership.
- Definitions are validated and defensively copied at every untrusted boundary. Callers cannot mutate saved drafts, published definitions, or values returned from stores by retaining an object reference.
- Format version and publication version are separate concepts. Format version describes how to decode the definition shape; publication version identifies an immutable form release.
- Unknown definition properties are rejected at the persistence boundary unless explicitly designated as supported metadata. This prevents accidental schema drift while allowing future format versions to add fields deliberately.

### Headless modules and public packages

- A public headless package owns the canonical types, validation, editing operations, publishing semantics, store contracts, in-memory stores, structured errors, and adapter contract-test utilities.
- The headless package has no dependency on React, TanStack Form, Supabase, browser globals, HTTP, or a specific database.
- Editing operations are pure and return a new definition or a structured error. They never mutate the supplied definition.
- A headless builder controller manages selection, undo, redo, and dirty state as deterministic state transitions. Pointer behavior and visual layout remain outside it.
- Identifier generation and time are injected or provided by the caller at operation boundaries. The core never requires ambient randomness or the system clock.
- A separate React integration depends on React and TanStack Form. It provides reusable respondent-form behavior and bindings without choosing the host application's permanent visual theme.
- An optional Effect entry point exposes submission validation and store adapters with typed error channels. Effect remains a host integration: it does not change the plain-data definition format or become a dependency for form authors and non-Effect consumers.
- The Screeem web application owns the opinionated business-user builder composition, production styling, permissions, API routes, and Supabase adapters.

### Store contracts

- `FormDefinitionStore` is a public interface for creating form records, reading and saving drafts, reading the active published definition, reading an immutable historical version, atomically publishing a draft, and changing availability state.
- Draft saves use optimistic concurrency. A caller supplies the revision it edited, and the store rejects the save if a newer revision exists.
- Publication is one atomic store operation. It verifies the expected draft revision, validates the definition, writes the next immutable publication version, and updates the active published pointer together.
- A failed publication leaves the previously published version active and makes no partial version visible.
- Published versions are immutable. Correcting a published form always creates and publishes a new draft version.
- `FormSubmissionStore` is a separate public interface for persisting normalized submissions and reading submissions for an authorized form. Each submission includes the form identifier and exact publication version.
- Store interfaces use domain values and structured domain errors. They do not expose SQL rows, Supabase query builders, transport responses, or provider-specific error objects.
- Official in-memory implementations are included for unit tests, examples, playgrounds, and consumer prototypes. They reproduce revision conflicts, atomic publication, immutable snapshots, and publication-version behavior rather than acting as permissive mocks.
- Public contract-test suites accept a store factory and exercise the semantics every adapter must provide. Adapter authors can run the same suite against memory, PostgreSQL, DynamoDB, HTTP-backed, or other implementations.
- The Screeem application supplies production Supabase implementations. Infrastructure-specific migrations and queries remain outside the headless package.
- Application services depend only on the public store interfaces. Most service and route behavior can therefore be tested with in-memory stores without starting Supabase.

### Form lifecycle and compatibility

- A newly created structured form begins as a draft with no public respondent form until its first successful publication.
- Form-level operational state distinguishes draft availability from whether an existing published form is active or paused.
- Authors may continue editing a new draft while the current published version serves respondents.
- Publishing returns the new immutable publication version so hosts can invalidate caches and recompile any routing definitions associated with that form.
- Pausing a form prevents new public submissions and hides or disables the hosted respondent experience without deleting definitions or historical submissions.
- Existing forms with no definition are marked as legacy unstructured forms. Their current endpoints continue accepting payloads under the existing behavior until an author creates and publishes a structured definition.
- Publishing the first structured definition is the explicit migration point for a legacy form. From that point onward, new submissions are validated against the active published version.
- Historical legacy submissions remain readable and are clearly identified as having no structured publication version.

### Business-user builder

- The initial production builder supports adding, selecting, editing, duplicating, removing, and reordering fields; configuring form metadata; saving drafts; previewing; publishing; and viewing publication state.
- Adding a field generates a safe suggested submission key from its initial label. The key remains editable before publication and validation explains collisions or unsafe values.
- Changing a key that has previously been published is treated as a contract change and is clearly disclosed before publication. Historical submissions retain their original version context.
- Reordering supports drag-and-drop plus explicit keyboard-accessible movement controls. Drag-and-drop is an enhancement, not the only way to operate the builder.
- Undo and redo cover local definition edits. A successful load or save establishes a clear history boundary, and a publication conflict never silently discards local state.
- The builder shows errors near the affected field and also provides a publication summary when multiple issues exist.
- Live preview renders from the current unsaved draft, not the published definition, and never sends its test values to the production submission endpoint.
- The author can view the normalized plain-data definition in the development playground. A raw schema editor is not part of the business-user production experience.
- The production editor uses the selected Canvas direction: a compact field palette, central form canvas, and focused property inspector.

### Development playground and design gate

- The playground follows the established Yul pattern: isolated development-only routes, a central playground index, lazily loaded option pages, realistic fixtures, and no production navigation. It does not require application services or credentials to render.
- Production builds must not expose a usable playground route. Requests to a development-only URL in production return not found, and experimental controls are not included in customer navigation.
- The form-builder option page presents at least three interaction directions using the same headless controller, field capabilities, fixtures, and validation rules.
- Each direction is fully interactive: authors can add, edit, duplicate, remove, reorder, undo, redo, preview, and attempt publication against an in-memory store.
- The playground includes realistic lead-qualification, contact, and eligibility forms covering all initial field types, optional fields, validation failures, and enum choices.
- Reviewers can switch among builder view, respondent preview, normalized definition, and sample normalized submission output.
- Playground submission and publication actions are visibly marked as development behavior and never call production APIs or persist to Supabase.
- After review, one direction is marked selected and the others are retained as rejected alternatives with short reasons. The chosen components are then integrated into the product rather than recreated separately.

### React respondent runtime

- TanStack Form manages respondent field state, touched state, validation display, and submission state in the React integration.
- TanStack Form is an implementation detail of the React package and is not the canonical schema or a dependency of the headless package.
- Rendering is registry-based: each supported control maps to a host-provided or default React field component.
- Client validation improves responsiveness, but the server always parses and validates independently against the active published definition.
- The hosted form is responsive and keyboard accessible. Labels, descriptions, required indicators, and errors use correct semantic relationships.
- The runtime renders only supported controls from a validated definition. It does not execute arbitrary JavaScript, expressions, HTML, or component names supplied by a form author.
- Public forms use the existing endpoint key as their stable external identity. The application exposes both a hosted respondent experience and the existing programmatic submission endpoint.

### Submission parsing and validation

- The public endpoint loads the active published definition before interpreting the request body.
- JSON submissions are type-strict: strings, finite numbers, booleans, and enum strings must already have the expected JSON types.
- Browser form-data submissions are normalized according to the published field definition. Numeric strings become finite numbers, checkbox presence is normalized to a boolean, and string and enum values remain strings.
- Required fields, field constraints, enum membership, duplicate values, unknown fields, unsafe field names, and unsupported files are rejected with structured field errors.
- Unknown submission keys are rejected after explicitly supported transport fields, such as the honeypot field, are handled. A form cannot become an unbounded arbitrary-object collector after structured publication.
- The existing request-size limit, origin restriction, honeypot behavior, active-state check, and success redirect remain enforced.
- Only successfully normalized and validated values are saved. Stored payloads contain the normalized business fields, not transport-only fields.
- The publication version used for validation is saved with the submission in the same application operation. The store adapter must not associate the submission with a later version that became active during the request.
- Validation failures do not invoke routing actions or persist partial submissions.

### Routing integration

- The canonical published definition remains compatible with `schemaFromForm`. Extra presentation and validation metadata is ignored by routing while names, value types, enum choices, and required state remain authoritative.
- Routing receives the normalized plain submission object and does not depend on React, TanStack Form, the builder controller, or a store implementation.
- Publication makes enough version information available for a host to compile or refresh routing definitions safely.
- This feature does not add business-rule authoring UI. It establishes the stable schema and validated values that a separate rule-authoring experience can inspect and use.
- A published form whose routing definition fails to compile may still collect submissions unless the host product explicitly configures routing as a publication prerequisite. Screeem will surface routing configuration status separately rather than hiding form-definition errors inside routing errors.

### Permissions and API behavior

- Existing team-management permissions remain authoritative. Managers can create, edit, publish, pause, resume, and delete forms. Team members can view forms and submissions according to current policy. Respondents submit anonymously through the public endpoint.
- `team_id` is the application tenant identifier. Forms, published definitions, and submissions carry it directly, and composite foreign keys prevent a child record from being associated with a form in another team.
- Private queries include `team_id` and use tenant-first indexes. Globally unique endpoint keys, invitation tokens, and API-key hashes are the only public lookup paths; each resolves a team before any private child data is read or written.
- APIs distinguish form metadata, editable draft, active published version, historical versions, and submissions rather than returning one ambiguous mutable record.
- Draft-save and publish responses include the current revision or publication version. Revision conflicts are returned distinctly from validation errors and authorization failures.
- Server APIs validate definitions with the headless core even when the client has already validated them.
- Delete behavior remains explicit and destructive. Deleting a form removes its definitions and submissions according to existing product policy and requires confirmation in the UI.

## Testing Decisions

- Tests assert observable contracts and user behavior rather than private functions, component structure, SQL wording, or TanStack Form internals. Each test must justify a distinct behavior, failure mode, boundary, or regression; permutations that do not change behavior are not duplicated.
- The headless definition suite covers every editing operation, immutable input and output behavior, stable identifiers, key generation, validation constraints, format versions, unsafe names, enum rules, and structured errors.
- Stateful model tests exercise sequences of add, update, duplicate, remove, reorder, undo, and redo operations and assert invariants such as unique identifiers, unique safe keys, preserved order, and round-trip serialization.
- Store contract tests are a public test kit. They cover missing records, defensive copies, optimistic draft conflicts, atomic publication, monotonic publication versions, immutable historical reads, active-version switching, pause and resume, and submission-version association.
- The in-memory stores run the complete contract suite and are used by application-service tests. They must be realistic enough that passing tests are meaningful for a production adapter.
- Supabase adapters run the same store contract suite as infrastructure integration tests against an isolated database. These tests are separate from fast core tests and are the only tests that require database infrastructure.
- React integration tests cover registry selection, all initial controls, client validation display, accessible labels and errors, preservation of values after errors, keyboard interaction, and submission-state behavior.
- Builder component tests cover the author-visible effects of adding, editing, duplicating, removing, reordering, undoing, redoing, saving, resolving validation errors, encountering revision conflicts, and publishing. They do not assert internal React state or drag-library implementation details.
- Submission service and endpoint tests cover JSON strictness, form-data coercion, required and optional fields, numeric bounds, email and length validation, enum membership, unknown keys, unsafe payloads, size limits, origins, honeypot handling, paused forms, concurrent publication, redirects, and store failures.
- Routing integration tests prove that a realistic published definition compiles through `schemaFromForm`, that a normalized submission such as age greater than 18 can match a rule, and that invalid submissions never reach routing.
- Browser tests cover the critical business journey: create a draft, add and reorder fields, preview it, publish it, open the hosted form, submit it, and view the versioned submission. A second journey covers editing while an older published version remains live and then publishing the replacement.
- A production-build test verifies that development playground navigation and routes are unavailable. Development smoke tests verify that playground fixtures and each design direction render without external services.
- Existing routing tests provide the prior art for safe schema snapshots, plain-data submissions, type-level behavior, security boundaries, and shuffled execution. Existing form API behavior provides regression cases for request limits, origin checks, honeypots, redirects, and form availability.
- Test fixtures use explicit clocks and deterministic identifier generators. No core test depends on wall-clock time, random UUIDs, network access, or a running database.

## Out of Scope

- A visual business-rule or routing-rule authoring interface.
- Executing custom JavaScript, Effect programs, regex supplied by business users, or arbitrary validation code inside forms.
- Importing or treating general JSON Schema, Zod, or a third-party builder schema as the canonical form format.
- Conditional field visibility, branching questionnaires, calculated fields, or cross-field validation.
- Multi-page forms, sections with workflow semantics, repeating field arrays, and nested object fields.
- File uploads, signatures, payments, rich-text authoring, dates, date ranges, addresses, and multi-select controls.
- Pixel-level themes, customer-authored CSS, arbitrary HTML, or a full white-label theme editor.
- Email campaigns, notifications, CRM synchronization, analytics dashboards, lead scoring, or assignment UI.
- Automatic migration of existing unstructured form payloads into inferred schemas.
- Changing the routing expression language or allowing actions to execute inside conditions.
- A hosted marketplace of field controls or store adapters.

## Further Notes

- The visual interaction research should use Ginkgo's React JSON Schema Form Builder as inspiration for a ready-made toolbox, sortable canvas, and property editor, and Coltor Builder as inspiration for separating typed builder state from UI and rendering. Neither schema becomes a runtime dependency or canonical format.
- The development review workflow follows Yul's established pattern: isolated development-only pages, realistic mock data, live controls, multiple labelled directions, inert writes, and preservation of rejected alternatives after selection.
- The initial scope is intentionally narrow because it covers the go-to-market qualification example: a form can collect name, email, employee count, country, and consent, then routing can evaluate conditions such as employee thresholds and country equality against validated values.
- Headless means the definition model, operations, persistence contracts, and publishing semantics do not choose a UI or infrastructure. It does not mean Screeem avoids delivering a polished visual editor for business users.
- The public store contracts are a first-class product requirement rather than a testing convenience. The in-memory implementation makes tests and prototypes easy; the contract suite makes third-party persistence implementations credible.
- The playground review selected Canvas for its direct field manipulation and persistent inspector. Outline and Focus remain labelled as rejected alternatives for future reference.
