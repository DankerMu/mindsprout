# Session reading without a cookie must not expose account data.
GET {{base_url}}/api/auth/session

HTTP 401
[Asserts]
body == "{\"error\":\"unauthenticated\"}"
header "Set-Cookie" not exists

# Hurl's cookie jar carries the issued session into subsequent requests.
POST {{base_url}}/api/auth/register
Content-Type: application/json
{
  "username": "smoke-{{newUuid}}",
  "password": "smoke-password"
}

HTTP 201
[Captures]
username: jsonpath "$.username"
is_admin: jsonpath "$.isAdmin"
[Asserts]
jsonpath "$.username" startsWith "smoke-"
jsonpath "$.isAdmin" isBoolean
jsonpath "$.password" not exists
jsonpath "$.token" not exists
header "Set-Cookie" contains "mindsprout_session="
header "Set-Cookie" contains "HttpOnly"
header "Set-Cookie" contains "SameSite=lax"
header "Set-Cookie" contains "Path=/"
header "Set-Cookie" contains "Max-Age=2592000"

GET {{base_url}}/api/auth/session

HTTP 200
[Asserts]
jsonpath "$.username" == "{{username}}"
jsonpath "$.isAdmin" == {{is_admin}}
header "Set-Cookie" not exists

# The registered user's untouched library is empty.
GET {{base_url}}/api/maps

HTTP 200
[Asserts]
body == "[]"
header "Set-Cookie" not exists

GET {{base_url}}/api/maps/absent-{{newUuid}}

HTTP 404
[Asserts]
body == "{\"error\":\"not-found\"}"
header "Set-Cookie" not exists

POST {{base_url}}/api/auth/login
Content-Type: application/json
{
  "username": "{{username}}",
  "password": "smoke-password"
}

HTTP 200
[Captures]
session_token: header "Set-Cookie" regex "mindsprout_session=([^;]+);" redact
[Asserts]
jsonpath "$.username" == "{{username}}"
jsonpath "$.isAdmin" == {{is_admin}}
jsonpath "$.password" not exists
jsonpath "$.token" not exists
header "Set-Cookie" contains "mindsprout_session="
header "Set-Cookie" contains "HttpOnly"
header "Set-Cookie" contains "SameSite=lax"
header "Set-Cookie" contains "Path=/"
header "Set-Cookie" contains "Max-Age=2592000"

GET {{base_url}}/api/auth/session

HTTP 200
[Asserts]
jsonpath "$.username" == "{{username}}"
jsonpath "$.isAdmin" == {{is_admin}}
header "Set-Cookie" not exists

POST {{base_url}}/api/auth/register
Content-Type: application/json
```
{
```

HTTP 400
[Asserts]
body == "{\"error\":\"invalid-input\"}"
header "Set-Cookie" not exists

POST {{base_url}}/api/auth/login
Content-Type: application/json
```
{
```

HTTP 400
[Asserts]
body == "{\"error\":\"invalid-input\"}"
header "Set-Cookie" not exists

POST {{base_url}}/api/auth/register
Content-Type: application/json
[]

HTTP 400
[Asserts]
body == "{\"error\":\"invalid-input\"}"
header "Set-Cookie" not exists

POST {{base_url}}/api/auth/login
Content-Type: application/json
```
null
```

HTTP 400
[Asserts]
body == "{\"error\":\"invalid-input\"}"
header "Set-Cookie" not exists

POST {{base_url}}/api/auth/register
Content-Type: application/json
{"username": null, "password": "smoke-password"}

HTTP 400
[Asserts]
body == "{\"error\":\"invalid-input\"}"
header "Set-Cookie" not exists

POST {{base_url}}/api/auth/login
Content-Type: application/json
{"username": "{{username}}", "password": 42}

HTTP 400
[Asserts]
body == "{\"error\":\"invalid-input\"}"
header "Set-Cookie" not exists

POST {{base_url}}/api/auth/register
[FormParams]
username: smoke-form-{{newUuid}}
password: smoke-password

HTTP 415
[Asserts]
body == "{\"error\":\"unsupported-media-type\"}"
header "Set-Cookie" not exists

POST {{base_url}}/api/auth/login
[FormParams]
username: {{username}}
password: smoke-password

HTTP 415
[Asserts]
body == "{\"error\":\"unsupported-media-type\"}"
header "Set-Cookie" not exists

# A cross-site form must not end the current session.
POST {{base_url}}/api/auth/logout
[FormParams]
logout: true

HTTP 415
[Asserts]
body == "{\"error\":\"unsupported-media-type\"}"
header "Set-Cookie" not exists

GET {{base_url}}/api/auth/session

HTTP 200
[Asserts]
jsonpath "$.username" == "{{username}}"
jsonpath "$.isAdmin" == {{is_admin}}
header "Set-Cookie" not exists

POST {{base_url}}/api/auth/logout
Content-Type: application/json
{}

HTTP 204
[Asserts]
body == ""
header "Set-Cookie" startsWith "mindsprout_session=;"
header "Set-Cookie" contains "Max-Age=0"
header "Set-Cookie" contains "HttpOnly"
header "Set-Cookie" contains "SameSite=lax"
header "Set-Cookie" contains "Path=/"

GET {{base_url}}/api/auth/session

HTTP 401
[Asserts]
body == "{\"error\":\"unauthenticated\"}"
header "Set-Cookie" not exists

# Replaying the issued token proves server deletion, not only cookie-jar clearing.
GET {{base_url}}/api/auth/session
Cookie: mindsprout_session={{session_token}}

HTTP 401
[Asserts]
body == "{\"error\":\"unauthenticated\"}"
header "Set-Cookie" not exists

POST {{base_url}}/api/auth/logout
Content-Type: application/json
{}

HTTP 204
[Asserts]
body == ""
header "Set-Cookie" startsWith "mindsprout_session=;"
header "Set-Cookie" contains "Max-Age=0"
header "Set-Cookie" contains "HttpOnly"
header "Set-Cookie" contains "SameSite=lax"
header "Set-Cookie" contains "Path=/"
