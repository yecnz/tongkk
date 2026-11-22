from fastapi import HTTPException


def fail(code: str, message: str, status: int = 409, **extra):
    raise HTTPException(status, detail={"error_code": code, "message": message,
                                        "retryable": status in {429, 503}, **extra})
