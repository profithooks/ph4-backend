#!/bin/bash

echo "═══════════════════════════════════════════════════════════════════"
echo "  🔍 MSG91 Diagnostics"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Get authkey from .env
AUTHKEY=$(grep "MSG91_AUTHKEY=" .env | cut -d= -f2)
PHONE="919890980947"

echo "📋 Testing MSG91 API directly..."
echo "─────────────────────────────────────────────────────────────────"
echo ""

# Test 1: Check account status
echo "1️⃣  Checking MSG91 Account Status:"
echo "URL: https://control.msg91.com/api/v5/otp?authkey=${AUTHKEY:0:10}...&mobile=${PHONE}"
echo ""

RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
  "https://control.msg91.com/api/v5/otp?authkey=${AUTHKEY}&mobile=${PHONE}")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE/d')

echo "HTTP Status: $HTTP_CODE"
echo "Response Body:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

# Analyze response
if [ "$HTTP_CODE" = "200" ]; then
    if echo "$BODY" | grep -q "type.*success"; then
        echo "✅ MSG91 API accepted the request"
        echo ""
        echo "⚠️  BUT OTP not received? Common reasons:"
        echo ""
        echo "   1. DLT Template Required (India)"
        echo "      - Go to: https://control.msg91.com/signup/senderotp.php"
        echo "      - Create/Approve a DLT template"
        echo "      - Add template_id to .env: MSG91_TEMPLATE_ID=your_template_id"
        echo ""
        echo "   2. Account in Test Mode"
        echo "      - Check: https://control.msg91.com/user/index.php#api"
        echo "      - Add test numbers in 'Test Phone Numbers' section"
        echo ""
        echo "   3. Sender ID Required"
        echo "      - Get approved sender ID from MSG91 dashboard"
        echo "      - Add to .env: MSG91_SENDER_ID=your_sender_id"
        echo ""
        echo "   4. Credits Exhausted"
        echo "      - Check: https://control.msg91.com/user/index.php#credits"
        echo "      - Add credits if balance is 0"
        echo ""
    elif echo "$BODY" | grep -qi "invalid.*authkey"; then
        echo "❌ Invalid Auth Key"
        echo "   - Check your MSG91_AUTHKEY in .env"
        echo "   - Get it from: https://control.msg91.com/user/index.php#api"
    elif echo "$BODY" | grep -qi "template"; then
        echo "⚠️  Template Required"
        echo "   - For Indian numbers, DLT template is mandatory"
        echo "   - Create template: https://control.msg91.com/signup/senderotp.php"
        echo "   - Add MSG91_TEMPLATE_ID to .env"
    fi
else
    echo "❌ MSG91 API Error (HTTP $HTTP_CODE)"
    echo ""
    if [ "$HTTP_CODE" = "401" ]; then
        echo "   Reason: Authentication failed"
        echo "   - Verify MSG91_AUTHKEY in .env"
    elif [ "$HTTP_CODE" = "403" ]; then
        echo "   Reason: Forbidden / Account restrictions"
        echo "   - Check account status in MSG91 dashboard"
    elif [ "$HTTP_CODE" = "400" ]; then
        echo "   Reason: Bad request"
        echo "   - Template ID might be required"
        echo "   - Phone number format might be wrong"
    fi
fi

echo ""
echo "─────────────────────────────────────────────────────────────────"
echo "📱 IMMEDIATE FIXES TO TRY:"
echo "─────────────────────────────────────────────────────────────────"
echo ""
echo "Option A: Use Test Mode (Quickest)"
echo "   1. Go to: https://control.msg91.com/user/index.php#api"
echo "   2. Scroll to 'Test Phone Numbers'"
echo "   3. Add: 919890980947"
echo "   4. Try sending OTP again"
echo ""
echo "Option B: Get DLT Template (For Production)"
echo "   1. Go to: https://control.msg91.com/signup/senderotp.php"
echo "   2. Create OTP template (e.g., 'Your OTP is ##OTP##')"
echo "   3. Wait for approval (can take 24-48 hours)"
echo "   4. Add template_id to .env"
echo ""
echo "Option C: Check Credits"
echo "   1. Go to: https://control.msg91.com/user/index.php#credits"
echo "   2. Check if balance > 0"
echo "   3. Add credits if needed"
echo ""
echo "─────────────────────────────────────────────────────────────────"
echo "🔗 USEFUL LINKS:"
echo "─────────────────────────────────────────────────────────────────"
echo "MSG91 Dashboard: https://control.msg91.com/user/index.php"
echo "API Settings: https://control.msg91.com/user/index.php#api"
echo "DLT Templates: https://control.msg91.com/signup/senderotp.php"
echo "SMS Logs: https://control.msg91.com/reports/list.php"
echo "─────────────────────────────────────────────────────────────────"
