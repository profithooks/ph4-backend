#!/bin/bash

echo "═══════════════════════════════════════════════════════════════════"
echo "  🔄 Updating MSG91 Auth Key & Testing"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# New auth key
NEW_AUTHKEY="470072AzDCJHdw696cf020P1"

# Update .env file
echo "📝 Updating MSG91_AUTHKEY in .env..."
if grep -q "MSG91_AUTHKEY=" .env 2>/dev/null; then
    sed -i.bak "s/MSG91_AUTHKEY=.*/MSG91_AUTHKEY=${NEW_AUTHKEY}/" .env
    echo "✅ Auth key updated"
else
    echo "MSG91_AUTHKEY=${NEW_AUTHKEY}" >> .env
    echo "✅ Auth key added"
fi

echo ""
echo "📋 Current configuration:"
echo "─────────────────────────────────────────────────────────────────"
echo "Auth Key: ${NEW_AUTHKEY:0:10}...${NEW_AUTHKEY: -10}"
echo "─────────────────────────────────────────────────────────────────"
echo ""

# Check if server is running
if lsof -i :5055 > /dev/null 2>&1; then
    echo "⚠️  Server is already running on port 5055"
    echo "   Restarting is recommended for new auth key to take effect..."
    echo ""
    echo "   To restart:"
    echo "   1. Find PID: lsof -i :5055"
    echo "   2. Kill: kill <PID>"
    echo "   3. Start: npm run dev"
    echo ""
    read -p "   Press ENTER to continue with test anyway..." 
else
    echo "🚀 Starting backend server..."
    PORT=5055 npm run dev > test-new-authkey.log 2>&1 &
    SERVER_PID=$!
    echo "   Server PID: $SERVER_PID"
    
    echo "⏳ Waiting for server to start..."
    sleep 5
    
    if ! lsof -i :5055 > /dev/null 2>&1; then
        echo "❌ Server failed to start"
        echo "Check logs: cat test-new-authkey.log"
        exit 1
    fi
    echo "✅ Server started"
    echo ""
fi

# Test OTP request
echo "🧪 Testing OTP Request with new auth key..."
echo "─────────────────────────────────────────────────────────────────"
echo "📱 Sending OTP to: +91 9890980947"
echo ""

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST http://localhost:5055/api/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"countryCode": "+91", "phone": "9890980947"}')

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "Response Status: $HTTP_STATUS"
echo "Response Body:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ SUCCESS! OTP request accepted by backend"
    echo ""
    echo "📱 Check phone 9890980947 for OTP SMS"
    echo ""
    echo "If OTP still doesn't arrive:"
    echo "  1. Check MSG91 dashboard: https://control.msg91.com/reports/list.php"
    echo "  2. Add test number: https://control.msg91.com/user/index.php#api"
    echo "  3. Check account credits and DLT template requirement"
    echo ""
    echo "To verify OTP when received:"
    echo "─────────────────────────────────────────────────────────────────"
    echo "curl -X POST http://localhost:5055/api/auth/otp/verify \\"
    echo "  -H \"Content-Type: application/json\" \\"
    echo "  -d '{\"countryCode\": \"+91\", \"phone\": \"9890980947\", \"otp\": \"YOUR_OTP\"}'"
else
    echo "❌ FAILED: HTTP $HTTP_STATUS"
    if [ "$HTTP_STATUS" = "502" ]; then
        echo ""
        echo "Reason: MSG91 provider error"
        echo "Possible causes:"
        echo "  - Invalid auth key"
        echo "  - MSG91 account issue"
        echo "  - Network connectivity"
        echo ""
        echo "Check backend logs for MSG91 error details"
    fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════"
