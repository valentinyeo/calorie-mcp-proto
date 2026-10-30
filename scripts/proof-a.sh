#!/bin/bash
# Proof a: discovery documents and the 401 challenge, plain curl.
B=${BASE:-https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev}
show() { echo "\$ curl -si $1 $2"; curl -si $2 "$B$1" | grep -v -i -E '^(report-to|nel|alt-svc|cf-ray|date|server|reporting-endpoints):' ; echo; echo; }
show /.well-known/oauth-protected-resource
show /.well-known/oauth-protected-resource/mcp
show /.well-known/oauth-authorization-server
echo '$ curl -si -X POST /mcp (no Authorization header)'
curl -si -X POST "$B/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -v -i -E '^(report-to|nel|alt-svc|cf-ray|date|server|reporting-endpoints):'
echo; echo
echo '$ curl -si -X POST /mcp (garbage bearer token)'
curl -si -X POST "$B/mcp" -H 'authorization: Bearer not-a-token' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -v -i -E '^(report-to|nel|alt-svc|cf-ray|date|server|reporting-endpoints):'
echo
