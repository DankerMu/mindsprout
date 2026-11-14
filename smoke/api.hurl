# Session reading without a cookie must not expose account data.
GET {{base_url}}/api/auth/session

HTTP 401
[Asserts]
body == "{\"error\":\"unauthenticated\"}"
