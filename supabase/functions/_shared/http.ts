export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  }

  console.error("Unhandled Gmail integration error", {
    error: error instanceof Error ? error.name : "unknown",
  });
  return jsonResponse(
    {
      error: {
        code: "internal_error",
        message: "The request could not be completed.",
      },
    },
    500,
  );
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new HttpError(
      400,
      "invalid_json",
      "A valid JSON request body is required.",
    );
  }
}

export function requireMethod(request: Request, ...allowed: string[]): void {
  if (!allowed.includes(request.method)) {
    throw new HttpError(
      405,
      "method_not_allowed",
      "This HTTP method is not supported.",
    );
  }
}
