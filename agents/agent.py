from strands import Agent, tool
from strands.models import BedrockModel
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

@tool
def get_weather(city: str) -> str:
    """
    Get the current weather for a specified city.

    Args:
        city: The name of the city

    Returns:
        A string describing the weather
    """
    weather_data = {
        "東京": "晴れ、気温25度",
        "大阪": "曇り、気温22度",
    }

    return weather_data.get(city, f"{city}の天気情報は取得できませんでした。")

@app.entrypoint
async def entrypoint(payload):
    """
    Main entrypoint for the agent.
    This function is called when the agent is invoked.

    Args:
        payload: The input payload containing prompt and optional model config

    Yields:
        Streaming messages from the agent
    """
    message = payload.get("prompt", "")
    model_id = "anthropic.claude-3-5-sonnet-20240620-v1:0"

    model = BedrockModel(
        model_id=model_id,
        params={"max_tokens": 2048, "temperature": 0.1},
        region="ap-northeast-1"
    )

    agent = Agent(
        model=model,
        tools=[get_weather],
        system_prompt="""あなたは親切なAIアシスタントです。
ユーザーの質問に丁寧に答えてください。
天気情報が必要な場合は、get_weatherツールを使用してください。"""
    )

    stream_messages = agent.stream_async(message)
    async for msg in stream_messages:
        if "event" in msg:
            yield msg

if __name__ == "__main__":
    app.run()
