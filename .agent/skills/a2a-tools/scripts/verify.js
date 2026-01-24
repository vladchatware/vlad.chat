#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const AGENT_JSON_PATH = path.resolve(process.cwd(), 'public/.well-known/agent.json');
const A2A_ROUTE_PATH = path.resolve(process.cwd(), 'app/api/a2a/route.ts');

async function verify() {
    console.log('🔍 Verifying A2A Integration...\n');

    // 1. Check Agent Card
    if (fs.existsSync(AGENT_JSON_PATH)) {
        try {
            const card = JSON.parse(fs.readFileSync(AGENT_JSON_PATH, 'utf8'));
            console.log('✅ Found agent.json');
            console.log(`   - Model: ${card.model || 'N/A'}`);
            console.log(`   - Public Key: ${card.publicKey ? card.publicKey.substring(0, 16) + '...' : 'MISSING'}`);
        } catch (e) {
            console.log('❌ Error parsing agent.json:', e.message);
        }
    } else {
        console.log('❌ Missing agent.json at', AGENT_JSON_PATH);
    }

    // 2. Check API Route
    if (fs.existsSync(A2A_ROUTE_PATH)) {
        console.log('✅ Found API route at', A2A_ROUTE_PATH);
    } else {
        console.log('❌ Missing API route at', A2A_ROUTE_PATH);
    }

    console.log('\n🚀 Next Steps:');
    console.log('1. Run `npm run dev` and test with:');
    console.log('   curl -X POST http://localhost:3000/api/a2a -H "Content-Type: application/json" -d \'{"message": "ping"}\'');
}

verify();
