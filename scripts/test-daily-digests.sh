#!/bin/bash

# Test Daily Digest Generators
# Usage: ./scripts/test-daily-digests.sh [am|eod|both]

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Config
BASE_URL="${BASE_URL:-https://profithooks-api.onrender.com}"
JWT="${JWT:-}"
DEV_KEY="${DEV_PUSH_KEY:-}"

if [ -z "$JWT" ]; then
  echo -e "${RED}❌ Error: JWT not set${NC}"
  echo "Usage: JWT=<your_jwt> DEV_PUSH_KEY=<key> ./scripts/test-daily-digests.sh [am|eod|both]"
  exit 1
fi

if [ -z "$DEV_KEY" ]; then
  echo -e "${RED}❌ Error: DEV_PUSH_KEY not set${NC}"
  echo "Usage: JWT=<your_jwt> DEV_PUSH_KEY=<key> ./scripts/test-daily-digests.sh [am|eod|both]"
  exit 1
fi

MODE="${1:-both}"

echo -e "${BLUE}🧪 Testing Daily Digest Generators${NC}"
echo "Base URL: $BASE_URL"
echo "Mode: $MODE"
echo ""

# Test AM Digest
if [ "$MODE" = "am" ] || [ "$MODE" = "both" ]; then
  echo -e "${YELLOW}▶️  Testing Daily Digest AM...${NC}"
  
  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
    "${BASE_URL}/api/v1/dev/notifications/digest/am" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${JWT}" \
    -H "X-DEV-PUSH-KEY: ${DEV_KEY}")
  
  HTTP_BODY=$(echo "$RESPONSE" | sed -e 's/HTTP_STATUS\:.*//g')
  HTTP_STATUS=$(echo "$RESPONSE" | tr -d '\n' | sed -e 's/.*HTTP_STATUS://')
  
  if [ "$HTTP_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ AM Digest triggered successfully${NC}"
    echo "$HTTP_BODY" | jq '.'
  else
    echo -e "${RED}❌ AM Digest failed (HTTP $HTTP_STATUS)${NC}"
    echo "$HTTP_BODY"
  fi
  
  echo ""
fi

# Test EOD Digest
if [ "$MODE" = "eod" ] || [ "$MODE" = "both" ]; then
  echo -e "${YELLOW}▶️  Testing Daily Digest EOD...${NC}"
  
  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
    "${BASE_URL}/api/v1/dev/notifications/digest/eod" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${JWT}" \
    -H "X-DEV-PUSH-KEY: ${DEV_KEY}")
  
  HTTP_BODY=$(echo "$RESPONSE" | sed -e 's/HTTP_STATUS\:.*//g')
  HTTP_STATUS=$(echo "$RESPONSE" | tr -d '\n' | sed -e 's/.*HTTP_STATUS://')
  
  if [ "$HTTP_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ EOD Digest triggered successfully${NC}"
    echo "$HTTP_BODY" | jq '.'
  else
    echo -e "${RED}❌ EOD Digest failed (HTTP $HTTP_STATUS)${NC}"
    echo "$HTTP_BODY"
  fi
  
  echo ""
fi

echo -e "${BLUE}✅ Test complete${NC}"
echo ""
echo "Next steps:"
echo "1. Check server logs for generator execution"
echo "2. Check mobile app for push notifications"
echo "3. Query notifications: GET /api/v1/notifications"
