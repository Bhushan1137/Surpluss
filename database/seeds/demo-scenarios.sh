#!/usr/bin/env bash
# Demonstration scenario scripts for the Surpluss webhook processor
# Run these after: docker compose up -d

API="http://localhost:3000"

echo "=== Scenario 1: Duplicate Delivery ==="
EVENT_ID="demo-duplicate-$(date +%s)"
for i in 1 2 3; do
  echo "  Sending duplicate $i..."
  curl -s -X POST "$API/webhooks" \
    -H "Content-Type: application/json" \
    -d "{\"eventId\":\"$EVENT_ID\",\"type\":\"order.created\",\"data\":{\"orderId\":\"123\",\"simulate\":\"ok\"}}" | \
    python3 -m json.tool 2>/dev/null || cat
done

echo ""
echo "=== Scenario 2: Temporary Failure (fail_then_succeed:2) ==="
curl -s -X POST "$API/webhooks" \
  -H "Content-Type: application/json" \
  -d "{\"eventId\":\"demo-retry-$(date +%s)\",\"type\":\"order.payment\",\"data\":{\"simulate\":\"fail_then_succeed:2\"}}" | \
  python3 -m json.tool 2>/dev/null || cat

echo ""
echo "=== Scenario 3: Permanent Failure (always_fail) ==="
curl -s -X POST "$API/webhooks" \
  -H "Content-Type: application/json" \
  -d "{\"eventId\":\"demo-fail-$(date +%s)\",\"type\":\"order.payment\",\"data\":{\"simulate\":\"always_fail\"}}" | \
  python3 -m json.tool 2>/dev/null || cat

echo ""
echo "=== Scenario 4: Parallel Processing (slow:8) ==="
for i in 1 2 3 4; do
  curl -s -X POST "$API/webhooks" \
    -H "Content-Type: application/json" \
    -d "{\"eventId\":\"demo-slow-$i-$(date +%s)\",\"type\":\"order.slow\",\"data\":{\"simulate\":\"slow:8\"}}" | \
    python3 -m json.tool 2>/dev/null || cat
  echo ""
done

echo "=== Scenario 5: Worker Crash ==="
echo "Submit a slow event, then kill worker1:"
curl -s -X POST "$API/webhooks" \
  -H "Content-Type: application/json" \
  -d "{\"eventId\":\"demo-crash-$(date +%s)\",\"type\":\"order.crash\",\"data\":{\"simulate\":\"slow:60\"}}" | \
  python3 -m json.tool 2>/dev/null || cat
echo ""
echo "Kill worker1 with: docker kill surpluss-worker1"
echo "worker2 will recover the event after lease expiry (~30s)"

echo ""
echo "=== Scenario 6: Burst Test (500 events) ==="
echo "Running burst test..."
for i in $(seq 1 500); do
  curl -s -X POST "$API/webhooks" \
    -H "Content-Type: application/json" \
    -d "{\"eventId\":\"burst-$i-$(date +%s%N)\",\"type\":\"order.burst\",\"data\":{\"simulate\":\"ok\"}}" > /dev/null &
  if [ $((i % 50)) -eq 0 ]; then
    wait
    echo "  Sent $i events..."
  fi
done
wait
echo "✅ Burst test complete. Check dashboard for processing status."
