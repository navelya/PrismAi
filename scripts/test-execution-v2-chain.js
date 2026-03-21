/**
 * Test Script for Workflow Engine v2 - STEP 3
 * Tests multi-node sequential execution (A → B → C)
 * 
 * Usage:
 *   node scripts/test-execution-v2-chain.js
 */

// Example test payload for a 3-node chain:
// Node 1: Generate base image with Flux
// Node 2: Upscale with Real-ESRGAN (receives output from Node 1)
// Node 3: Another transform (receives output from Node 2)

const testPayload = {
  session_id: "YOUR_SESSION_ID_HERE", // Replace with a real session ID
  user_id: "YOUR_USER_ID_HERE",        // Replace with a real user ID
  graph_json: {
    nodes: [
      {
        id: "node_generate",
        type: "flux_schnell",
        data: {
          label: "Generate Image",
          model: "black-forest-labs/flux-schnell",
          version: "f2ab8a5569279a9b14b75e3d075e99a236f5bc82f654dc41d2a22fa608c8d5fb",
          prompt: "A cute cat sitting on a table",
          input: {
            prompt: "A cute cat sitting on a table, high quality photo",
            num_outputs: 1,
            aspect_ratio: "1:1",
            output_format: "jpg",
            output_quality: 80,
          }
        }
      },
      {
        id: "node_upscale",
        type: "ai_upscale",
        data: {
          label: "Upscale Image",
          model: "nightmareai/real-esrgan",
          version: "42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
          input: {
            scale: 2,
            face_enhance: false,
          }
        }
      },
      {
        id: "node_final",
        type: "flux_schnell",
        data: {
          label: "Style Transfer",
          model: "black-forest-labs/flux-schnell",
          version: "f2ab8a5569279a9b14b75e3d075e99a236f5bc82f654dc41d2a22fa608c8d5fb",
          prompt: "oil painting style",
          input: {
            prompt: "oil painting style",
            num_outputs: 1,
          }
        }
      }
    ],
    edges: [
      {
        id: "edge_1_2",
        source: "node_generate",
        target: "node_upscale",
        sourceHandle: "output",
        targetHandle: "image"
      },
      {
        id: "edge_2_3",
        source: "node_upscale",
        target: "node_final",
        sourceHandle: "output",
        targetHandle: "image"
      }
    ]
  }
};

console.log("=".repeat(80));
console.log("WORKFLOW ENGINE V2 - STEP 3 TEST: SEQUENTIAL CHAIN");
console.log("=".repeat(80));
console.log("\n📋 Test Payload (3-Node Chain):");
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
console.log("1. POST /api/executions/start creates execution");
console.log("2. check-and-dispatch finds node_generate (root node, no dependencies)");
console.log("3. node_generate dispatched to Replicate");
console.log("4. [Wait ~10-30s] Webhook receives node_generate completion");
console.log("5. check-and-dispatch finds node_upscale (dependency satisfied)");
console.log("6. node_upscale dispatched with image URL from node_generate");
console.log("7. [Wait ~10-30s] Webhook receives node_upscale completion");
console.log("8. check-and-dispatch finds node_final (dependency satisfied)");
console.log("9. node_final dispatched with image URL from node_upscale");
console.log("10. [Wait ~10-30s] Webhook receives node_final completion");
console.log("11. No more pending nodes → execution marked 'completed'");

console.log("\n🔍 Monitor execution progress in Supabase:");
console.log(`
-- Watch execution status in real-time
SELECT 
  id,
  status,
  jsonb_object_keys(node_states) as node_id,
  node_states->jsonb_object_keys(node_states)->>'status' as node_status
FROM executions_v2 
WHERE id = 'YOUR_EXECUTION_ID'
ORDER BY created_at DESC;

-- View event timeline
SELECT 
  node_id,
  event_type,
  created_at,
  payload
FROM execution_events 
WHERE execution_id = 'YOUR_EXECUTION_ID'
ORDER BY created_at ASC;
`);

console.log("\n📊 What's different from STEP 2:");
console.log("✅ Automatic dependency resolution");
console.log("✅ Sequential chaining (A → B → C)");
console.log("✅ Automatic input passing between nodes");
console.log("✅ check-and-dispatch triggers on every completion");
console.log("✅ Atomic node claiming (prevents race conditions)");

console.log("\n⏱️  Expected total time:");
console.log("~30-90 seconds (3 nodes × 10-30s each)");

console.log("\n" + "=".repeat(80));
