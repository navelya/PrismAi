/**
 * Test Script for Workflow Engine v2 - STEP 2
 * Tests a single node execution end-to-end
 * 
 * Usage:
 *   node --loader ts-node/esm scripts/test-execution-v2.ts
 *   OR
 *   npm run test:execution-v2
 */

// Example test payload for a simple Flux image generation
const testPayload = {
  session_id: "YOUR_SESSION_ID_HERE", // Replace with a real session ID from your database
  user_id: "YOUR_USER_ID_HERE",        // Replace with a real user ID
  graph_json: {
    nodes: [
      {
        id: "node_1",
        type: "flux_schnell",
        data: {
          label: "Generate Image",
          model: "black-forest-labs/flux-schnell",
          version: "f2ab8a5569279a9b14b75e3d075e99a236f5bc82f654dc41d2a22fa608c8d5fb",
          prompt: "A beautiful sunset over mountains",
          input: {
            prompt: "A beautiful sunset over mountains",
            num_outputs: 1,
            aspect_ratio: "1:1",
            output_format: "jpg",
            output_quality: 80,
          }
        }
      }
    ],
    edges: []
  }
};

console.log("=".repeat(80));
console.log("WORKFLOW ENGINE V2 - STEP 2 TEST");
console.log("=".repeat(80));
console.log("\n📋 Test Payload:");
console.log(JSON.stringify(testPayload, null, 2));

console.log("\n🔧 To test manually:");
console.log("1. Replace YOUR_SESSION_ID_HERE and YOUR_USER_ID_HERE with real values");
console.log("2. Make a POST request to: http://localhost:3000/api/executions/start");
console.log("3. Include the payload above as JSON body");
console.log("\n📝 Example using curl:");
console.log(`
curl -X POST http://localhost:3000/api/executions/start \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(testPayload)}'
`);

console.log("\n✅ Expected flow:");
console.log("1. POST /api/executions/start creates execution record");
console.log("2. Dispatches node to Replicate with webhook URL");
console.log("3. Replicate calls back to /api/webhooks/replicate-v2");
console.log("4. Webhook updates execution status to 'completed'");

console.log("\n🔍 Monitor in Supabase:");
console.log("SELECT * FROM executions_v2 ORDER BY created_at DESC LIMIT 1;");
console.log("SELECT * FROM execution_events ORDER BY created_at DESC LIMIT 10;");

console.log("\n" + "=".repeat(80));
