import { analyzeUrl } from "@/lib/analyze";
import { AppError, type ErrorCode } from "@/lib/types";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  BLOCKED_URL: 400,
  NOT_HTML: 422,
  INSUFFICIENT_TEXT: 422,
  TIMEOUT: 504,
  FETCH_FAILED: 502,
  BOT_BLOCKED: 502,
  INTERNAL: 500,
};

export async function POST(request: Request) {
  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return Response.json(
      { error: { code: "INVALID_URL", message: "Request body must be JSON with a `url` field." } },
      { status: 400 },
    );
  }

  if (typeof url !== "string" || url.length === 0) {
    return Response.json(
      { error: { code: "INVALID_URL", message: "`url` must be a non-empty string." } },
      { status: 400 },
    );
  }

  try {
    const report = await analyzeUrl(url);
    return Response.json(report);
  } catch (err) {
    if (err instanceof AppError) {
      return Response.json(
        { error: { code: err.code, message: err.message } },
        { status: STATUS_BY_CODE[err.code] },
      );
    }
    console.error("analyze failed:", err);
    return Response.json(
      { error: { code: "INTERNAL", message: "Something went wrong while analyzing the page." } },
      { status: 500 },
    );
  }
}
