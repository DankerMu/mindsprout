# Session reading without a cookie must not expose account data.
GET {{base_url}}/api/auth/session

HTTP 401
[Asserts]
body == "{\"error\":\"unauthenticated\"}"
header "Set-Cookie" not exists

# Native form submission must stay signed out and return a relative Location.
POST {{base_url}}/native-auth/login
[Form]
username: smoke-native
password: smoke-password

HTTP 303
[Asserts]
header "Location" == "/login?native=1"
header "Set-Cookie" not exists

POST {{base_url}}/native-auth/register?next=%2Fmaps%2Fabc%3Fx%3D1
[Form]
username: smoke-native
password: smoke-password

HTTP 303
[Asserts]
header "Location" == "/register?native=1&next=%2Fmaps%2Fabc%3Fx%3D1"
header "Set-Cookie" not exists

POST {{base_url}}/native-auth/other

HTTP 404
[Asserts]
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
header "Set-Cookie" nth 0 contains "mindsprout_session="
header "Set-Cookie" nth 0 contains "HttpOnly"
header "Set-Cookie" nth 0 contains "SameSite=lax"
header "Set-Cookie" nth 0 contains "Path=/"
header "Set-Cookie" nth 0 contains "Max-Age=2592000"
header "Set-Cookie" nth 1 contains "mindsprout_session_binding="
header "Set-Cookie" nth 1 contains "SameSite=lax"
header "Set-Cookie" nth 1 contains "Path=/"
header "Set-Cookie" nth 1 contains "Max-Age=2592000"
header "Set-Cookie" nth 1 not contains "HttpOnly"

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

# A unique id shares the fresh account's UUID; the full envelope must survive storage.
PUT {{base_url}}/api/maps/{{username}}
Content-Type: application/json
{"schemaVersion":1,"map":{"id":"{{username}}","title":"Smoke forest","createdAt":"2026-11-14T00:00:00.000Z","updatedAt":"2026-11-14T01:00:00.000Z","roots":[{"id":"primary","text":"Root","children":[{"id":"child","text":"Child","note":"Note","color":"purple","collapsed":false,"children":[]}]},{"id":"floating","text":"Floating","position":{"x":-10,"y":20},"children":[]}]}}

HTTP 204
[Asserts]
body == ""
header "Set-Cookie" not exists

GET {{base_url}}/api/maps/{{username}}

HTTP 200
[Asserts]
jsonpath "$.*" count == 2
jsonpath "$.schemaVersion" == 1
jsonpath "$.map.*" count == 5
jsonpath "$.map.id" == "{{username}}"
jsonpath "$.map.title" == "Smoke forest"
jsonpath "$.map.createdAt" == "2026-11-14T00:00:00.000Z"
jsonpath "$.map.updatedAt" == "2026-11-14T01:00:00.000Z"
jsonpath "$.map.roots" count == 2
jsonpath "$.map.roots[0].*" count == 3
jsonpath "$.map.roots[0].id" == "primary"
jsonpath "$.map.roots[0].text" == "Root"
jsonpath "$.map.roots[0].children" count == 1
jsonpath "$.map.roots[0].children[0].*" count == 6
jsonpath "$.map.roots[0].children[0].id" == "child"
jsonpath "$.map.roots[0].children[0].text" == "Child"
jsonpath "$.map.roots[0].children[0].note" == "Note"
jsonpath "$.map.roots[0].children[0].color" == "purple"
jsonpath "$.map.roots[0].children[0].collapsed" == false
jsonpath "$.map.roots[0].children[0].children" count == 0
jsonpath "$.map.roots[1].*" count == 4
jsonpath "$.map.roots[1].id" == "floating"
jsonpath "$.map.roots[1].text" == "Floating"
jsonpath "$.map.roots[1].position.*" count == 2
jsonpath "$.map.roots[1].position.x" == -10
jsonpath "$.map.roots[1].position.y" == 20
jsonpath "$.map.roots[1].children" count == 0
header "Set-Cookie" not exists

GET {{base_url}}/api/maps

HTTP 200
[Asserts]
jsonpath "$[0].*" count == 3
jsonpath "$[0].id" == "{{username}}"
jsonpath "$[0].title" == "Smoke forest"
jsonpath "$[0].updatedAt" == "2026-11-14T01:00:00.000Z"
jsonpath "$" count == 1

DELETE {{base_url}}/api/maps/{{username}}
Content-Type: application/json
{}

HTTP 204
[Asserts]
body == ""
header "Set-Cookie" not exists

GET {{base_url}}/api/maps/{{username}}

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
session_token: header "Set-Cookie" nth 0 regex "mindsprout_session=([^;]+);" redact
[Asserts]
jsonpath "$.username" == "{{username}}"
jsonpath "$.isAdmin" == {{is_admin}}
jsonpath "$.password" not exists
jsonpath "$.token" not exists
header "Set-Cookie" nth 0 contains "mindsprout_session="
header "Set-Cookie" nth 0 contains "HttpOnly"
header "Set-Cookie" nth 0 contains "SameSite=lax"
header "Set-Cookie" nth 0 contains "Path=/"
header "Set-Cookie" nth 0 contains "Max-Age=2592000"
header "Set-Cookie" nth 1 contains "mindsprout_session_binding="
header "Set-Cookie" nth 1 contains "SameSite=lax"
header "Set-Cookie" nth 1 contains "Path=/"
header "Set-Cookie" nth 1 contains "Max-Age=2592000"
header "Set-Cookie" nth 1 not contains "HttpOnly"

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
header "Set-Cookie" nth 0 startsWith "mindsprout_session=;"
header "Set-Cookie" nth 0 contains "Max-Age=0"
header "Set-Cookie" nth 0 contains "HttpOnly"
header "Set-Cookie" nth 0 contains "SameSite=lax"
header "Set-Cookie" nth 0 contains "Path=/"
header "Set-Cookie" nth 1 startsWith "mindsprout_session_binding=;"
header "Set-Cookie" nth 1 contains "Max-Age=0"
header "Set-Cookie" nth 1 contains "SameSite=lax"
header "Set-Cookie" nth 1 contains "Path=/"
header "Set-Cookie" nth 1 not contains "HttpOnly"

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
header "Set-Cookie" nth 0 startsWith "mindsprout_session=;"
header "Set-Cookie" nth 0 contains "Max-Age=0"
header "Set-Cookie" nth 0 contains "HttpOnly"
header "Set-Cookie" nth 0 contains "SameSite=lax"
header "Set-Cookie" nth 0 contains "Path=/"
header "Set-Cookie" nth 1 startsWith "mindsprout_session_binding=;"
header "Set-Cookie" nth 1 contains "Max-Age=0"
header "Set-Cookie" nth 1 contains "SameSite=lax"
header "Set-Cookie" nth 1 contains "Path=/"
header "Set-Cookie" nth 1 not contains "HttpOnly"

# The second fresh account cannot be the first registrant, regardless of database contents.
POST {{base_url}}/api/auth/register
Content-Type: application/json
{
  "username": "smoke-second-{{newUuid}}",
  "password": "smoke-password"
}

HTTP 201
[Captures]
second_username: jsonpath "$.username"
[Asserts]
jsonpath "$.username" startsWith "smoke-second-"
jsonpath "$.isAdmin" == false
header "Set-Cookie" nth 0 contains "mindsprout_session="

GET {{base_url}}/api/auth/session

HTTP 200
[Asserts]
jsonpath "$.username" == "{{second_username}}"
jsonpath "$.isAdmin" == false

GET {{base_url}}/api/admin/users

HTTP 403
[Asserts]
body == "{\"error\":\"forbidden\"}"
header "Set-Cookie" not exists

POST {{base_url}}/api/admin/users/{{newUuid}}/password-reset
Content-Type: application/json
{}

HTTP 403
[Asserts]
body == "{\"error\":\"forbidden\"}"
header "Set-Cookie" not exists
