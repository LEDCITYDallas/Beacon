# AI Co-Working Assistant — Approval Gates (Section 5)

**Document status:** Deliverable required by Section 5: "Ahmed must document,
in writing, exactly which actions require approval and which (if any) execute
without asking."

**Design rule:** the assistant proposes; a human confirms. Nothing
consequential executes silently. This table is implemented in code — these
are not prompt instructions.

## 1. Approval matrix

| # | Assistant action | Approval needed? | Who approves | Implementation |
| --- | --- | --- | --- | --- |
| 1 | Show next-up queue / answer questions about own tasks | **No** — read-only, scoped to the employee's own data | n/a | Read-only DB queries, assignee-filtered |
| 2 | Draft a reply / status update / summary | **No** for generating the draft — it is only text | n/a | Draft returned to the employee, never stored as sent |
| 3 | **Send** a drafted message (WhatsApp/email) | **Yes — always** | The employee (review screen) | `POST /api/assistant/messages/:id/send` requires an explicit confirm; draft is discarded if declined |
| 4 | Mark a task complete | **Yes — always** | The task's assignee (existing `confirm-completion` flow) | Assistant may call `proposeCompletion` only; finalization is the existing human-in-the-loop endpoint |
| 5 | Notify a teammate that a dependency is ready | **Yes — always** | The task's assignee or manager | Proposal row created first; send only on confirm |
| 6 | Create / edit / delete tasks | **Never** — out of scope for the assistant in v1 | n/a | No code path exists; the assistant cannot mutate tasks |
| 7 | Access another employee's tasks or stats | **Never** | n/a | All assistant queries are hard-filtered by the requester's identity and Section 3 role scope |

## 2. Actions that execute without asking

Only two, both non-consequential:
1. **Reading** the employee's own task data to answer questions.
2. **Generating draft text** that is never sent or saved anywhere until the
   employee explicitly approves.

Everything that touches the outside world (send, notify, complete) requires
a human confirm — matrix rows 3–5.

## 3. Hard limits (in addition to the matrix)

- The assistant runs **inside each employee's own permissions** (Section 5) —
  it can never surface data the employee themselves cannot see. This is
  enforced by passing the authenticated user's scope into every assistant
  query, not by trusting the model.
- No tool-call execution, no arbitrary code, no web access in v1.
- All assistant interactions are logged (who asked what, when) for the
  Super Admin's audit view; content of drafts is logged only until
  sent/discarded, then the draft text is dropped per the retention policy.
- Model access goes through one adapter module; the provider key belongs to
  LED City and is added by Omair only (Section 10.3–10.4).

## 4. Failed-approval behavior

If the employee declines a send/notify/complete, the proposal row is marked
`DECLINED`, nothing is transmitted, and the timeline records
`ASSISTANT_ACTION_DECLINED`. A declined action is never retried silently.
