const https = require('https');

// Hardcoded values from your request to eliminate .env reading errors
const url = 'https://wyqkbwpybqokmtlghdsr.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5cWtid3B5YnFva210bGdoZHNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxNzAyMDAsImV4cCI6MjA4Mjc0NjIwMH0.ijbswrAfHzNpenCd1cA3CxuIooQIMGzlZCEwbPtDrw4';

console.log('Testing connection to:', url);
console.log('Using Key (checking signature validity)...');

const requestUrl = `${url}/auth/v1/settings`;
console.log(`GET ${requestUrl}`);

const options = {
    headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
    }
};

const req = https.get(requestUrl, options, (res) => {
    console.log(`\nResponse Status: ${res.statusCode} ${res.statusMessage}`);

    let data = '';
    res.on('data', (chunk) => data += chunk);

    res.on('end', () => {
        if (res.statusCode === 200) {
            console.log('✅ SUCCESS: The Key is VALID and working!');
        } else {
            console.log('❌ FAILURE: The Key was REJECTED.');
            console.log('Body:', data);
            console.log('\nDIAGNOSIS:');
            if (res.statusCode === 401) {
                console.log('The "Invalid API Key" means your Supabase Project JWT Secret has likely changed/rotated.');
                console.log('This Key was signed with an OLD secret.');
                console.log('SOLUTION: Go to Supabase Dashboard > Settings > API -> Regenerate Anon Key.');
            }
        }
    });
});

req.on('error', (e) => {
    console.log('Network Error:', e.message);
});
