# LLM integrations

When the code calls a language model (the Anthropic, OpenAI or Gemini SDKs, the Vercel AI SDK,
LangChain, or plain HTTP to such an API). Prompt injection that reaches tools or data is filed
here, with its security consequences spelled out; Security does not repeat it.

Severity: critical when untrusted content can make the model act with the user's or the app's
privileges (call tools that write or send, read another user's data) or leak a secret. High
when model output reaches the database, HTML, a query or code execution unvalidated, or when
anyone can make the app spend without limit. Medium for missing limits, retries and fallbacks.
Low for gaps in logging and evaluation.

## LLM-01 Prompt injection

Untrusted content (users' messages, uploaded documents, web pages, emails, tool results)
placed into prompts that also carry instructions or tools; data and instructions not
separated; defences that rely on the prompt alone ("ignore any instructions in the document").

## LLM-02 Tools and agency

Tools the model can call that write, delete, pay or send; whether each checks the end user's
rights, not only the app's; a human confirmation before irreversible actions; allowlists for
URLs, paths and commands a tool accepts.

## LLM-03 Output handling

Model output rendered as HTML or Markdown without sanitising, or used in SQL, shell commands,
`eval`, file paths or redirects; structured output parsed with regular expressions rather than
validated against a schema; refusals and truncation (`stop_reason`, `max_tokens`) unhandled.

## LLM-04 Cost and abuse limits

Rate limits and quotas per user on endpoints that call a model; `max_tokens` and input size
caps; endpoints that call a model without authentication; no budget alert (often a question).

## LLM-05 Data sent to the provider

Personal or confidential data in prompts, secrets in prompts, full prompts and responses
written to logs; the provider's data retention and training settings (a question).

## LLM-06 Keys and models

API keys kept on the server (never `NEXT_PUBLIC_`, never inside a mobile app); model IDs hard-
coded in many places or retired by the provider; timeouts and retry settings on the SDK client.

## LLM-07 Reliability

Rate-limit and overload errors handled with backoff; a fallback when the model is unavailable;
interrupted streams; idempotency when a generation is retried; caching where prompts repeat.

## LLM-08 Evaluation and observability

Prompts versioned in the code; test cases or evals for the prompts that matter; each call
logged with its model, tokens and cost; a way for users to flag a bad answer.
