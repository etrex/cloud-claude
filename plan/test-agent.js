const { query } = require("@anthropic-ai/claude-agent-sdk");

async function test() {
  try {
    console.log("Testing Agent SDK without explicit API key...");
    console.log("ANTHROPIC_API_KEY env:", process.env.ANTHROPIC_API_KEY ? "SET" : "NOT SET");

    for await (const message of query({ prompt: "Say hello in one word" })) {
      console.log("Message type:", message.type);
      console.log("Message:", JSON.stringify(message, null, 2));
    }
    console.log("\nSuccess! Agent SDK works without explicit API key");
  } catch (error) {
    console.log("Error:", error.message);
  }
}

test();
