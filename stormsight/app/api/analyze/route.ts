import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, notes } = await req.json();

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are a disaster response AI. Look at this photo and the reporter's notes below, then respond ONLY in this exact format, nothing else:
hazard_type: [flood/fire/downed_tree/damaged_building/blocked_road/none]
severity: [low/medium/high]
description: [one short sentence, combining what you see AND what the reporter said]
estimated_cost: [a rough repair cost RANGE in USD, like "$5,000 - $15,000". This is a rough visual estimate only, not a professional appraisal]

Reporter's notes: "${notes || "No additional notes provided."}"`,
            },
            {
              type: "image_url",
              image_url: { url: imageBase64 },
            },
          ],
        },
      ],
    });

    const result = response.choices[0].message.content;
    return NextResponse.json({ result });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "AI analysis failed" }, { status: 500 });
  }
}