# AI Coach

The Coach provides advisory help for seven actions: onboarding analysis, task suggestions, task scope challenges, weekly diagnosis, next action, overbuilding explanation, and evidence topic classification.

## Provider setup

The AI provider is optional. Without `OPENAI_API_KEY`, the API returns deterministic stage guidance and labels the result `STAGE_GUIDANCE`. To enable model responses, configure `OPENAI_API_KEY` and optionally set `OPENAI_MODEL` in `.env`; the default model is `gpt-6-astra`. Restart the API after changing the environment.

The API sends model requests to the OpenAI Responses API using strict JSON Schema output. The request sets `store: false`. See the [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## Data sent

Nothing is sent to an external provider until a signed-in user clicks **Get advice**. The server verifies product ownership and only assembles context needed for the selected action:

| Action | Context that may be sent |
| --- | --- |
| Onboarding analysis | Product stage guidance and ratio, target customer, problem statement, and active goal titles |
| Task generation | The onboarding context plus active task titles, to reduce duplicate suggestions |
| Scope challenge | Product stage guidance, active goal titles, and the selected task title, notes, and estimate |
| Weekly diagnosis | Product stage guidance, active goal titles, numeric user/revenue totals, and a seven-day aggregate event count |
| Next action | Product stage guidance, active goal and task titles, numeric traction, and a seven-day aggregate event count |
| Overbuilding explanation | Product stage guidance and its suggested build/customer-learning ratio |
| Evidence classification | Product stage guidance and the selected evidence type, title, and up to 1,500 characters of its note |

The Coach does not send account IDs, passwords, rule data, raw activity events or attributes, evidence URLs or integration references, or uploaded file contents. Avoid including names, contact details, or secrets in user-entered titles and notes. API logs do not store prompts or responses.

## Limits

AI output is advisory. It cannot edit rules, enforce policy, verify or reject evidence, or issue credits. Suggested tasks are saved only after the user clicks **Add task**, through the existing task API, with a zero-credit reward. Evidence classification describes an apparent topic and never decides authenticity or reward eligibility. The normal evidence review flow remains required.

Weekly event counts describe recorded activity, not customer outcomes. Stage ratios are planning guidance; the product does not measure actual time spent building or talking with customers. OpenAI request storage is disabled in the request, while any other provider data handling follows the account's current API terms and configuration.

## Runtime acceptance

Provider configuration, authenticated browser behavior, ownership isolation, rate limiting, provider error handling, and privacy review remain to be exercised before Phase 15 exit criteria can be accepted.
