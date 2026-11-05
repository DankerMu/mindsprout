# smoke/health.hurl — liveness probe (AGENTS.md ## Verification Matrix).
GET {{base_url}}/api/healthz

HTTP 200
[Asserts]
jsonpath "$.status" == "ok"
