const express = require("express");
const { GoogleGenAI } = require("@google/genai");

const router = express.Router();

const APP_NAME = "TriBoard AI";

// Every model the app can use. The left side is what the dropdown sends.
const modelCatalog = {
  "gemini-3.8-flash": { provider: "gemini", apiName: "gemini-3.8-flash" },
  "groq-gpt-oss": { provider: "groq", apiName: "openai/gpt-oss-120b" },
};

// Order we try when the chosen model cannot answer.
const fallbackOrder = ["gemini-3.8-flash", "groq-gpt-oss"];

const allowedTypes = ["document", "spreadsheet", "drawing"];

// ---------- The rules that make the AI behave ----------
const commonRules = `You are the writing assistant inside ${APP_NAME}, a shared workspace with notes, documents, tables and diagrams.

Follow these rules strictly:
1. Do exactly what the user asks. Add nothing extra.
2. NEVER invent personal or private details: names, emails, phone numbers, dates, deadlines, amounts, marks, company names, or sample / dummy / example data that the user did not give you.
3. If the user asks for a template, format, layout, planner, tracker, or "something I can fill in", give the structure only and leave every fillable part empty.
4. If the user asks for knowledge, an explanation, ideas, steps, or a draft about a topic, write it properly, accurately and clearly. General knowledge is fine. Made-up personal data is not.
5. If the request is too vague to do well, give the simplest useful structure instead of guessing details.`;

const typeRules = {
  document: `${commonRules}

Output format for a plain text box:
- Plain text only. Do not use Markdown symbols such as ** or # or backticks.
- Put each heading on its own line, followed by the content.
- Use "- " at the start of a line for bullet points.
- For a template, write the heading and then a line with a short hint in square brackets, like [write here], and nothing invented.`,

  spreadsheet: `${commonRules}

Output format: return ONLY a JSON object, with no extra words and no code fences:
{"columns": ["Column name", "..."], "rows": [["cell", "..."]]}
- Choose sensible column names from the request (at most 8 columns).
- Only fill in rows when the user gave the row content. Otherwise return exactly 5 rows where every cell is an empty string "".
- Every row must have the same number of cells as there are columns.`,

  drawing: `${commonRules}

Output format: return ONLY a JSON object, with no extra words and no code fences:
{"nodes": [{"id": "n1", "label": "Short label"}], "edges": [{"from": "n1", "to": "n2"}]}
- Use only the steps or items the user described, or the standard, well-known steps of the process they named.
- If the request is too vague, return three nodes labelled "Start", "Step" and "End", connected in order.
- Labels must be under 6 words. At most 15 nodes. Do not include x or y positions.`,
};

// ---------- Cleaning the JSON answers ----------
function extractJson(text) {
  const cleaned = String(text).replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in the answer");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function cleanSpreadsheet(text) {
  const data = extractJson(text);
  if (!Array.isArray(data.columns) || data.columns.length === 0) {
    throw new Error("The table has no columns");
  }

  const columns = data.columns.slice(0, 8).map((name) => String(name).trim() || "Column");
  const givenRows = Array.isArray(data.rows) ? data.rows.slice(0, 50) : [];

  const rows = givenRows.map((row) =>
    columns.map((_, index) => (Array.isArray(row) && row[index] != null ? String(row[index]) : ""))
  );

  while (rows.length < 5) {
    rows.push(columns.map(() => ""));
  }

  return JSON.stringify({ columns, rows });
}

function cleanDrawing(text) {
  const data = extractJson(text);
  if (!Array.isArray(data.nodes) || data.nodes.length === 0) {
    throw new Error("The diagram has no boxes");
  }

  const seen = new Set();
  const nodes = [];
  data.nodes.slice(0, 15).forEach((node, index) => {
    let id = String(node && node.id != null ? node.id : `n${index + 1}`);
    if (seen.has(id)) id = `${id}_${index}`;
    seen.add(id);
    nodes.push({ id, label: String((node && node.label) || "Box").slice(0, 60) });
  });

  const edges = (Array.isArray(data.edges) ? data.edges : [])
    .filter((edge) => edge && seen.has(String(edge.from)) && seen.has(String(edge.to)))
    .map((edge) => ({ from: String(edge.from), to: String(edge.to) }))
    .slice(0, 40);

  return JSON.stringify({ nodes, edges });
}

const cleaners = {
  document: (text) => String(text).trim(),
  spreadsheet: cleanSpreadsheet,
  drawing: cleanDrawing,
};

// ---------- Talking to the AI companies ----------
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorKind(error) {
  const text = String(error && error.message ? error.message : error);
  if (/429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(text)) return "quota";
  if (/503|UNAVAILABLE|overloaded|high demand/i.test(text)) return "busy";
  if (/404|NOT_FOUND|no longer available/i.test(text)) return "missing";
  return "other";
}

async function askGemini(apiName, systemText, userText, wantsJson) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const config = { systemInstruction: systemText };
  if (wantsJson) config.responseMimeType = "application/json";

  const response = await ai.models.generateContent({
    model: apiName,
    contents: userText,
    config,
  });
  return response.text;
}

async function askGroq(apiName, systemText, userText) {
  const reply = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: apiName,
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText },
      ],
    }),
  });

  const data = await reply.json();

  if (!reply.ok) {
    const detail = data && data.error && data.error.message ? data.error.message : "";
    throw new Error(`Groq HTTP ${reply.status}: ${detail}`);
  }

  return data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
}

function providerHasKey(provider) {
  if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  if (provider === "groq") return Boolean(process.env.GROQ_API_KEY);
  return false;
}

async function askOneModel(modelKey, systemText, userText, wantsJson) {
  const { provider, apiName } = modelCatalog[modelKey];
  if (provider === "gemini") return askGemini(apiName, systemText, userText, wantsJson);
  return askGroq(apiName, systemText, userText);
}

// Chosen model first, then the others.
// Quota or missing model: skip at once. Busy: one short retry, then skip.
// A badly formed answer also moves on to the next model.
async function generateWithFallback(chosenKey, canvasType, userText) {
  const order = [chosenKey, ...fallbackOrder.filter((key) => key !== chosenKey)];
  const systemText = typeRules[canvasType];
  const wantsJson = canvasType !== "document";
  const cleanAnswer = cleaners[canvasType];
  let sawQuotaProblem = false;

  for (const modelKey of order) {
    const { provider } = modelCatalog[modelKey];

    if (!providerHasKey(provider)) {
      console.warn(`[AI] Skipping ${modelKey}: no API key set for ${provider}.`);
      continue;
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await askOneModel(modelKey, systemText, userText, wantsJson);
        if (!raw || !raw.trim()) break;
        const cleaned = cleanAnswer(raw);
        return { text: cleaned, usedModel: modelKey };
      } catch (error) {
        const kind = errorKind(error);
        console.warn(`[AI] ${modelKey} (${kind}) attempt ${attempt}: ${String(error.message).slice(0, 200)}`);

        if (kind === "quota") sawQuotaProblem = true;
        if (kind !== "busy") break;
        if (attempt === 1) await wait(1500);
      }
    }
  }

  const failure = new Error("All models failed");
  failure.sawQuotaProblem = sawQuotaProblem;
  throw failure;
}

router.post("/generate", async (req, res) => {
  try {
    const { prompt, canvasType, model } = req.body;

    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "Please enter a prompt." });
    }

    if (!allowedTypes.includes(canvasType)) {
      return res.status(400).json({ error: "Invalid canvas type." });
    }

    const chosenKey = modelCatalog[model] ? model : fallbackOrder[0];

    const { text, usedModel } = await generateWithFallback(
      chosenKey,
      canvasType,
      `User request:\n${prompt.trim()}`
    );

    res.json({
      success: true,
      canvasType,
      requestedModel: chosenKey,
      model: usedModel,
      result: text,
    });
  } catch (error) {
    console.error("AI generation failed:", error.message);

    const message = error.sawQuotaProblem
      ? "The free AI limit is used up for the moment. Please try again in a few minutes."
      : "The AI could not answer right now. Please press Create with AI once more.";

    res.status(503).json({ error: message });
  }
});

module.exports = router;