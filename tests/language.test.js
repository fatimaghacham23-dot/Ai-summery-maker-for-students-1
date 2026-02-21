process.env.NODE_ENV = "test";
process.env.SUMMARIZER_PROVIDER = "mock";

const request = require("supertest");
const app = require("../src/app");

describe("Language detection and enforcement", () => {
  const spanishText = `
    Esta es una lección sobre cómo organizar ideas para repasar antes de un examen final.
    Habla sobre la importancia de resumir los capítulos, crear tarjetas y repasar con compañeros.
    Incluye números, fechas y referencias directas a los capítulos del libro.
  `;

  const arabicText = `
    هذه ملاحظات دراسة حول الأثر البيئي للطاقة الشمسية.
    تتحدث الجملة عن تقنيات جمع الطاقة واستخدامها في المنازل.
    تتضمن حوارات وبيانات مرتبطة بالقرارات التنظيمية الحديثة.
  `;

  it("detects Spanish input and flags the language in metadata", async () => {
    const response = await request(app)
      .post("/api/summarize")
      .send({ text: spanishText.trim(), length: "short", format: "paragraph" })
      .expect(200);

    expect(response.body?.meta?.language?.iso6391).toBe("es");
    expect(response.body?.meta?.language?.name).toBe("Spanish");
    expect(response.body.summary).toBeDefined();
    expect(/Language:/i.test(String(response.body.summary))).toBe(false);
  });

  it("detects Arabic input and records the language context", async () => {
    const response = await request(app)
      .post("/api/summarize")
      .send({ text: arabicText.trim(), length: "short", format: "paragraph" })
      .expect(200);

    expect(response.body?.meta?.language?.iso6391).toBe("ar");
    expect(response.body?.meta?.language?.name).toBe("Arabic");
    expect(/Language:/i.test(String(response.body.summary))).toBe(false);
  });

  it("respects explicit target language over detected language", async () => {
    const response = await request(app)
      .post("/api/summarize")
      .send({
        text: spanishText.trim(),
        length: "short",
        format: "paragraph",
        targetLanguage: "French",
      })
      .expect(200);

    expect(response.body?.meta?.language?.iso6391).toBe("fr");
    expect(response.body?.meta?.language?.name).toBe("French");
  });
});
