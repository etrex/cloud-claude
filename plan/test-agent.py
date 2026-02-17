import asyncio
import os
import json

async def test():
    from claude_agent_sdk import query

    print("Testing Python Agent SDK...")
    print(f"CLAUDE_CODE_OAUTH_TOKEN: {'SET' if os.environ.get('CLAUDE_CODE_OAUTH_TOKEN') else 'NOT SET'}")

    try:
        async for message in query(prompt="Say hello in one word"):
            # 印出物件類型和所有屬性
            print(f"Message class: {message.__class__.__name__}")
            if hasattr(message, '__dict__'):
                print(f"Message attrs: {list(message.__dict__.keys())}")
                for key, value in message.__dict__.items():
                    print(f"  {key}: {str(value)[:200]}")
            print("---")
        print("\nSuccess! Python Agent SDK works!")
    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
