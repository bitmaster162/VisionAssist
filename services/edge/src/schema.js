export const sceneDescriptionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      maxLength: 120
    },
    details: {
      type: "string"
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    follow_up_prompt: {
      type: "string",
      maxLength: 180
    },
    needs_human_review: {
      type: "boolean"
    },
    hazards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: [
              "ступенька",
              "лужа",
              "порог",
              "ящик",
              "столб",
              "дверь",
              "дверца_открыта",
              "переход",
              "край_платформы",
              "транспорт",
              "человек_близко",
              "животное",
              "инструмент",
              "острое",
              "горячее",
              "скользко",
              "прочее"
            ]
          },
          conf: {
            type: "number",
            minimum: 0,
            maximum: 1
          },
          text: {
            type: "string"
          },
          bearing: {
            type: ["string", "null"],
            enum: ["слева", "справа", "по центру", "сзади", "сверху", "снизу", null]
          },
          distance_m: {
            type: ["number", "null"],
            minimum: 0
          }
        },
        required: ["type", "conf", "text"]
      }
    }
  },
  required: ["summary", "confidence", "follow_up_prompt", "needs_human_review", "hazards"]
};
